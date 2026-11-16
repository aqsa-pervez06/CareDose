const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const databasePath = path.resolve(
  process.env.CAREDOSE_DB_PATH || path.join(__dirname, "..", "caredose.sqlite")
);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

const medicineColumns = db.prepare("PRAGMA table_info(medicines)").all();
if (!medicineColumns.some((column) => column.name === "strength")) {
  db.exec("ALTER TABLE medicines ADD COLUMN strength TEXT NOT NULL DEFAULT ''");
}

const doseColumns = db.prepare("PRAGMA table_info(doses)").all();
if (!doseColumns.some((column) => column.name === "scheduled_time")) {
  const unsupportedDoseTime = db.prepare(
    `SELECT medicines.id, medicines.time_of_day
     FROM medicines
     JOIN doses ON doses.medicine_id = medicines.id
     WHERE medicines.time_of_day NOT IN ('morning', 'afternoon', 'evening', 'bedtime')
     LIMIT 1`
  ).get();
  if (unsupportedDoseTime) {
    throw new Error(
      `Cannot migrate dose schedule for medicine ${unsupportedDoseTime.id}: unsupported time of day "${unsupportedDoseTime.time_of_day}".`
    );
  }

  db.exec(
    "ALTER TABLE doses ADD COLUMN scheduled_time TEXT NOT NULL DEFAULT '08:00'"
  );
  db.exec(
    `UPDATE doses
     SET scheduled_time = (
       SELECT CASE medicines.time_of_day
         WHEN 'morning' THEN '08:00'
         WHEN 'afternoon' THEN '12:00'
         WHEN 'evening' THEN '18:00'
         WHEN 'bedtime' THEN '21:00'
         ELSE '08:00'
       END
       FROM medicines
       WHERE medicines.id = doses.medicine_id
     )`
  );
}

const duplicateDoses = db.prepare(
  `SELECT medicine_id, dose_date, COUNT(*) AS count
   FROM doses
   GROUP BY medicine_id, dose_date
   HAVING COUNT(*) > 1
   LIMIT 1`
).get();
if (duplicateDoses) {
  throw new Error(
    `Cannot enforce one dose per medicine per day: medicine ${duplicateDoses.medicine_id} has ${duplicateDoses.count} entries for ${duplicateDoses.dose_date}.`
  );
}
db.exec(
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_doses_medicine_date
   ON doses (medicine_id, dose_date)`
);

module.exports = { db };
