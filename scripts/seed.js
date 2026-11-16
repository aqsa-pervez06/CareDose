const { db } = require("../db/database");
const { hashPassword } = require("../auth");

const users = [
  {
    name: "Dr. Avery Chen",
    email: "doctor@caredose.test",
    password: "doctor123",
    role: "doctor",
  },
  {
    name: "Nurse Jordan Lee",
    email: "nurse@caredose.test",
    password: "nurse123",
    role: "nurse",
  },
];

const residents = [
  { name: "Marlene Brooks", age: 81, room: "101", allergy: "Penicillin" },
  { name: "Elias Turner", age: 74, room: "102", allergy: null },
  { name: "Priya Nair", age: 89, room: "103", allergy: "Latex" },
  { name: "Walter Hayes", age: 77, room: "104", allergy: null },
];

const medicines = [
  { resident: "Marlene Brooks", drug: "Lisinopril", time: "morning", stock: 28, active: 1 },
  { resident: "Marlene Brooks", drug: "Vitamin D", time: "evening", stock: 30, active: 1 },
  { resident: "Elias Turner", drug: "Metformin", time: "morning", stock: 42, active: 1 },
  { resident: "Elias Turner", drug: "Atorvastatin", time: "evening", stock: 26, active: 1 },
  { resident: "Priya Nair", drug: "Amlodipine", time: "morning", stock: 21, active: 1 },
  { resident: "Priya Nair", drug: "Calcium carbonate", time: "afternoon", stock: 35, active: 1 },
  { resident: "Walter Hayes", drug: "Omeprazole", time: "morning", stock: 18, active: 1 },
];

const insertUser = db.prepare(
  `INSERT OR IGNORE INTO users (name, email, password_hash, role)
   VALUES (?, ?, ?, ?)`
);
const insertResident = db.prepare(
  `INSERT OR IGNORE INTO residents (name, age, room, allergy)
   VALUES (?, ?, ?, ?)`
);
const findResident = db.prepare(
  "SELECT id FROM residents WHERE name = ? AND room = ?"
);
const insertMedicine = db.prepare(
  `INSERT OR IGNORE INTO medicines
   (resident_id, drug_name, time_of_day, stock_left, active)
   VALUES (?, ?, ?, ?, ?)`
);
const residentRooms = new Map(residents.map((resident) => [resident.name, resident.room]));

try {
  db.exec("BEGIN IMMEDIATE");

  for (const user of users) {
    insertUser.run(user.name, user.email, hashPassword(user.password), user.role);
  }

  for (const resident of residents) {
    insertResident.run(
      resident.name,
      resident.age,
      resident.room,
      resident.allergy
    );
  }

  for (const medicine of medicines) {
    const resident = findResident.get(
      medicine.resident,
      residentRooms.get(medicine.resident)
    );
    if (!resident) {
      throw new Error(`Seed resident not found: ${medicine.resident}`);
    }

    insertMedicine.run(
      resident.id,
      medicine.drug,
      medicine.time,
      medicine.stock,
      medicine.active
    );
  }

  db.exec("COMMIT");
  console.log("CareDose seed data is ready.");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
