const express = require("express");
const path = require("path");
const { db } = require("./db/database");
const {
  createLoginToken,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyLoginToken,
  verifyPassword,
} = require("./auth");

const app = express();
const port = process.env.PORT || 3000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();
const DOSE_SCHEDULE_TIMES = {
  morning: "08:00",
  afternoon: "12:00",
  evening: "18:00",
  bedtime: "21:00",
};
const insertAuditLog = db.prepare(
  "INSERT INTO audit_log (user_id, action) VALUES (?, ?)"
);

function authenticate(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  const user = match ? verifyLoginToken(match[1]) : null;
  if (!user) {
    return res.status(401).json({ error: "Please sign in to continue." });
  }

  req.authenticatedUser = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.authenticatedUser.role !== role) {
      return res.status(403).json({
        error: `This action is only available to ${role}s.`,
      });
    }
    next();
  };
}

function isUniqueConstraintError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "errcode" in error &&
      error.errcode === 2067
  );
}

function getLocalDateTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  };
}

function getDoseDisplayStatus(status, doseDate, scheduledTime, now = new Date()) {
  if (status !== "pending") {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  const scheduledAt = new Date(`${doseDate}T${scheduledTime}`);
  const minutesUntilScheduled = (scheduledAt.getTime() - now.getTime()) / 60_000;
  if (minutesUntilScheduled > 0) {
    return "Upcoming";
  }
  if (minutesUntilScheduled >= -30) {
    return "Due now";
  }
  return "Overdue";
}

function getTodayDoseReport(today, now = new Date()) {
  const doses = db.prepare(
    `SELECT doses.id AS dose_id, doses.medicine_id, doses.dose_date,
            doses.scheduled_time, doses.dose_time, doses.status,
            doses.recorded_at, medicines.drug_name, medicines.strength,
            medicines.time_of_day, medicines.stock_left,
            residents.id AS resident_id, residents.name AS resident_name,
            residents.room, residents.allergy
     FROM medicines
     JOIN residents ON residents.id = medicines.resident_id
     JOIN doses ON doses.medicine_id = medicines.id AND doses.dose_date = ?
     WHERE medicines.active = 1
     ORDER BY doses.scheduled_time, residents.room, residents.name`
  ).all(today);
  const counts = {
    given: 0,
    stillToGive: 0,
    overdue: 0,
    missed: 0,
    refused: 0,
  };
  const residents = db.prepare(
    "SELECT id, name, room FROM residents ORDER BY room, name"
  ).all().map((resident) => ({
    ...resident,
    dose_count: 0,
    given_count: 0,
  }));
  const residentsById = new Map(
    residents.map((resident) => [resident.id, resident])
  );
  const todayDoses = doses.map((dose) => {
    const statusLabel = getDoseDisplayStatus(
      dose.status,
      dose.dose_date,
      dose.scheduled_time,
      now
    );
    if (statusLabel === "Given") {
      counts.given += 1;
    } else if (statusLabel === "Upcoming" || statusLabel === "Due now") {
      counts.stillToGive += 1;
    } else if (statusLabel === "Overdue") {
      counts.overdue += 1;
    } else if (statusLabel === "Missed") {
      counts.missed += 1;
    } else if (statusLabel === "Refused") {
      counts.refused += 1;
    }

    const resident = residentsById.get(dose.resident_id);
    if (resident) {
      resident.dose_count += 1;
      if (statusLabel === "Given") {
        resident.given_count += 1;
      }
    }
    return { ...dose, status_label: statusLabel };
  });

  return {
    doses: todayDoses,
    counts,
    residents: residents.map((resident) => ({
      ...resident,
      progress_percent: resident.dose_count
        ? Math.round((resident.given_count / resident.dose_count) * 100)
        : null,
    })),
  };
}

function ensureDailyDoses(today) {
  const activeMedicines = db.prepare(
    `SELECT id, time_of_day
     FROM medicines
     WHERE active = 1`
  ).all();
  const insertDailyDose = db.prepare(
    `INSERT INTO doses
     (medicine_id, dose_date, dose_time, scheduled_time, status)
     VALUES (?, ?, ?, ?, 'pending')
     ON CONFLICT (medicine_id, dose_date) DO NOTHING`
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const medicine of activeMedicines) {
      const scheduledTime = DOSE_SCHEDULE_TIMES[medicine.time_of_day];
      if (!scheduledTime) {
        throw new Error(
          `Unsupported time of day "${medicine.time_of_day}" for medicine ${medicine.id}.`
        );
      }
      insertDailyDose.run(medicine.id, today, scheduledTime, scheduledTime);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getAuditEntries() {
  return db.prepare(
    `SELECT audit_log.id, users.name AS user_name, users.role AS user_role,
            audit_log.action, audit_log.occurred_at
     FROM audit_log
     LEFT JOIN users ON users.id = audit_log.user_id
     ORDER BY audit_log.occurred_at DESC, audit_log.id DESC
     LIMIT 100`
  ).all();
}

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/login", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const now = Date.now();
  for (const [ip, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) {
      loginAttempts.delete(ip);
    }
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  let attempt = loginAttempts.get(ip);
  if (!attempt || attempt.resetAt <= now) {
    attempt = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  }
  if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
    res.set("Retry-After", String(Math.ceil((attempt.resetAt - now) / 1000)));
    return res.status(429).json({
      error: "Too many sign-in attempts. Please try again in 15 minutes.",
    });
  }
  attempt.count += 1;
  loginAttempts.set(ip, attempt);

  next();
}, (req, res) => {
  const { email, password, role } = req.body || {};
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !["doctor", "nurse"].includes(role)
  ) {
    return res.status(400).json({
      error: "Choose a role and enter your email and password.",
    });
  }

  const user = db.prepare(
    `SELECT id, name, email, password_hash, role
     FROM users WHERE email = ? COLLATE NOCASE`
  ).get(email.trim());
  const passwordMatches = verifyPassword(
    password,
    user ? user.password_hash : DUMMY_PASSWORD_HASH
  );

  if (
    !user ||
    user.role !== role ||
    !passwordMatches
  ) {
    return res.status(401).json({
      error: "The selected role, email, or password is incorrect.",
    });
  }

  const login = createLoginToken(user);
  res.json({
    token: login.token,
    tokenType: "Bearer",
    expiresAt: login.expiresAt,
    expiresIn: login.expiresIn,
    user: { name: user.name, role: user.role },
  });
});

app.get("/api/me", authenticate, (req, res) => {
  res.json({ user: req.authenticatedUser });
});

app.get("/api/residents", authenticate, (req, res) => {
  const residents = db.prepare(
    `SELECT id, name, age, room, allergy
     FROM residents
     ORDER BY room`
  ).all();
  const medicines = db.prepare(
    `SELECT id, resident_id, drug_name, strength, time_of_day, stock_left, active
     FROM medicines
     ORDER BY time_of_day, drug_name`
  ).all();
  const medicinesByResident = new Map();
  for (const medicine of medicines) {
    const residentMedicines = medicinesByResident.get(medicine.resident_id) || [];
    residentMedicines.push({
      id: medicine.id,
      drug_name: medicine.drug_name,
      strength: medicine.strength,
      time_of_day: medicine.time_of_day,
      stock_left: medicine.stock_left,
      active: Boolean(medicine.active),
    });
    medicinesByResident.set(medicine.resident_id, residentMedicines);
  }

  for (const resident of residents) {
    resident.medicines = medicinesByResident.get(resident.id) || [];
  }
  res.json({ residents });
});

app.get("/api/log", authenticate, (req, res) => {
  res.json({ entries: getAuditEntries() });
});

app.use("/api/nurse", authenticate, requireRole("nurse"));

app.get("/api/nurse/today", (req, res) => {
  const now = new Date();
  const { date: today } = getLocalDateTime(now);
  ensureDailyDoses(today);

  const report = getTodayDoseReport(today, now);
  res.json({ doses: report.doses, counts: report.counts, date: today });
});

app.post("/api/nurse/doses", (req, res) => {
  const medicineId = Number(req.body?.medicineId);
  const status = req.body?.status;
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) {
    return res.status(400).json({ error: "Choose a valid medicine." });
  }
  if (!["given", "refused", "missed"].includes(status)) {
    return res.status(400).json({
      error: "Choose whether the dose was given, refused, or missed.",
    });
  }

  const medicine = db.prepare(
    `SELECT medicines.id, medicines.drug_name, residents.name AS resident_name
     FROM medicines
     JOIN residents ON residents.id = medicines.resident_id
     WHERE medicines.id = ? AND medicines.active = 1`
  ).get(medicineId);
  if (!medicine) {
    return res.status(404).json({ error: "Active medicine not found." });
  }

  const { date } = getLocalDateTime();
  const recordedAt = new Date().toISOString();
  const { time: recordedTime } = getLocalDateTime();
  db.exec("BEGIN IMMEDIATE");
  try {
    const dose = db.prepare(
      `SELECT id FROM doses
       WHERE medicine_id = ? AND dose_date = ? AND status = 'pending'`
    ).get(medicineId, date);
    if (!dose) {
      db.exec("ROLLBACK");
      return res.status(409).json({
        error: "This dose has already been recorded or has not been scheduled for today.",
      });
    }

    const update = db.prepare(
      `UPDATE doses
       SET status = ?, dose_time = ?, recorded_by = ?, recorded_at = ?
       WHERE id = ? AND status = 'pending'`
    ).run(status, recordedTime, req.authenticatedUser.id, recordedAt, dose.id);
    if (update.changes !== 1) {
      db.exec("ROLLBACK");
      return res.status(409).json({ error: "This dose has already been recorded." });
    }

    if (status === "given") {
      db.prepare(
        "UPDATE medicines SET stock_left = MAX(stock_left - 1, 0) WHERE id = ?"
      ).run(medicineId);
    }

    const action = status.charAt(0).toUpperCase() + status.slice(1);
    insertAuditLog.run(
      req.authenticatedUser.id,
      `Marked dose ${action}: ${medicine.drug_name} for ${medicine.resident_name}`
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  res.status(200).json({ message: `Dose marked ${status}.` });
});

app.use("/api/doctor", authenticate, requireRole("doctor"));

app.get("/api/doctor/overview", (req, res) => {
  const now = new Date();
  const { date: today } = getLocalDateTime(now);
  ensureDailyDoses(today);
  const report = getTodayDoseReport(today, now);

  const overviewCounts = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM medicines WHERE active = 1) AS active_medicine_count,
       (SELECT COUNT(*) FROM medicines WHERE active = 1 AND stock_left <= 5)
         AS low_stock_count`
  ).get();
  const overdueDoses = report.doses.filter(
    (dose) => dose.status_label === "Overdue"
  );
  const lowStockMedicines = db.prepare(
    `SELECT medicines.drug_name, medicines.strength, medicines.stock_left,
            residents.name AS resident_name, residents.room
     FROM medicines
     JOIN residents ON residents.id = medicines.resident_id
     WHERE medicines.active = 1 AND medicines.stock_left <= 5
     ORDER BY medicines.stock_left, residents.room, medicines.drug_name`
  ).all();
  const alerts = [
    ...overdueDoses.map((dose) => ({
      type: "overdue",
      severity: "critical",
      message: `${dose.drug_name}${dose.strength ? ` ${dose.strength}` : ""} for ${dose.resident_name} (Room ${dose.room}) was due at ${dose.scheduled_time.slice(0, 5)}.`,
    })),
    ...lowStockMedicines.map((medicine) => ({
      type: "low-stock",
      severity: "warning",
      message: `${medicine.drug_name}${medicine.strength ? ` ${medicine.strength}` : ""} for ${medicine.resident_name} (Room ${medicine.room}) has ${medicine.stock_left} tablets left.`,
    })),
  ];
  res.json({
    ...overviewCounts,
    resident_count: report.residents.length,
    counts: report.counts,
    residents: report.residents,
    overdue_count: overdueDoses.length,
    alerts,
  });
});

app.get("/api/doctor/staff", (req, res) => {
  const staff = db.prepare(
    "SELECT id, name, email, role FROM users ORDER BY role, name"
  ).all();
  res.json({ staff });
});

app.post("/api/doctor/staff", (req, res) => {
  const { name, email, password } = req.body || {};
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (
    !trimmedName ||
    trimmedName.length > 120 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) ||
    trimmedEmail.length > 254 ||
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 128
  ) {
    return res.status(400).json({
      error: "Enter a name, valid email, and password between 8 and 128 characters.",
    });
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'nurse')"
    ).run(trimmedName, trimmedEmail, hashPassword(password));
    insertAuditLog.run(
      req.authenticatedUser.id,
      `Created nurse ${trimmedName}`
    );
    db.exec("COMMIT");
    res.status(201).json({
      id: Number(result.lastInsertRowid),
      message: "Nurse created.",
    });
  } catch (error) {
    db.exec("ROLLBACK");
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    throw error;
  }
});

app.post("/api/doctor/medicines", (req, res) => {
  const { drugName, strength, timeOfDay } = req.body || {};
  const residentId = Number(req.body?.residentId);
  const stockLeft = Number(req.body?.stockLeft);
  if (
    !Number.isSafeInteger(residentId) ||
    residentId < 1 ||
    typeof drugName !== "string" ||
    !drugName.trim() ||
    drugName.trim().length > 120 ||
    typeof strength !== "string" ||
    !strength.trim() ||
    strength.trim().length > 80 ||
    !["morning", "afternoon", "evening", "bedtime"].includes(timeOfDay) ||
    !Number.isSafeInteger(stockLeft) ||
    stockLeft < 0
  ) {
    return res.status(400).json({
      error: "Enter a resident, medicine, strength, time of day, and valid stock amount.",
    });
  }

  const resident = db.prepare(
    "SELECT id, name, allergy FROM residents WHERE id = ?"
  ).get(residentId);
  if (!resident) {
    return res.status(404).json({ error: "Resident not found." });
  }

  const allergyTerms = (resident.allergy || "")
    .split(/[,;/]+/)
    .map((term) => term.trim().toLocaleLowerCase())
    .filter(Boolean);
  const matchedAllergy = allergyTerms.find((term) =>
    drugName.trim().toLocaleLowerCase().includes(term)
  );
  if (matchedAllergy) {
    return res.status(422).json({
      error: `Cannot prescribe ${drugName.trim()}: it contains the resident's allergy (${matchedAllergy}).`,
    });
  }

  try {
    db.prepare(
      `INSERT INTO medicines
       (resident_id, drug_name, strength, time_of_day, stock_left, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).run(residentId, drugName.trim(), strength.trim(), timeOfDay, stockLeft);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({
        error: "That medicine is already scheduled for this resident at that time.",
      });
    }
    throw error;
  }

  insertAuditLog.run(
    req.authenticatedUser.id,
    `Prescribed ${drugName.trim()} ${strength.trim()} for ${resident.name}`
  );
  res.status(201).json({ message: "Medicine prescribed." });
});

app.post("/api/doctor/residents", (req, res) => {
  const { name, room, allergy } = req.body || {};
  const age = req.body?.age;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 120 ||
    typeof room !== "string" ||
    !room.trim() ||
    room.trim().length > 40 ||
    !Number.isInteger(age) ||
    age < 0 ||
    age > 120 ||
    (allergy !== undefined &&
      allergy !== null &&
      (typeof allergy !== "string" || allergy.trim().length > 500))
  ) {
    return res.status(400).json({
      error: "Enter a resident name, room, and a whole-number age from 0 to 120. Allergy is optional.",
    });
  }

  try {
    const result = db.prepare(
      `INSERT INTO residents (name, age, room, allergy)
       VALUES (?, ?, ?, ?)`
    ).run(
      name.trim(),
      age,
      room.trim(),
      typeof allergy === "string" && allergy.trim() ? allergy.trim() : null
    );
    insertAuditLog.run(
      req.authenticatedUser.id,
      `Added resident ${name.trim()} in room ${room.trim()}`
    );
    res.status(201).json({ id: Number(result.lastInsertRowid), message: "Resident added." });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({
        error: "A resident with that name and room already exists.",
      });
    }
    throw error;
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`CareDose server is running at http://localhost:${port}`);
});
