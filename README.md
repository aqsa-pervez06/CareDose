# CareDose — Care Home Medication Management System

CareDose is a role-based web application built for care homes to manage residents, prescriptions, allergy alerts, and daily medication logs safely across nursing and medical staff.

## Key Features

- *Role-Based Access Control:* Separate dashboards and server-side route protection for *Nurses* (Today, Residents, Log) and *Doctors* (Overview, Residents, Prescribe, Staff, Log).
- *Secure Authentication:* Uses hashed passwords, 8-hour JWT login sessions storing user roles, and rate limiting (maximum 10 login attempts per 15 minutes).
- *Resident & Allergy Tracking:* Displays resident profiles (name, age, room, allergies, and active medicines) with prominent yellow warning boxes for allergies.
- *Medication Prescribing & Logging:* Allows doctors to prescribe medications and nurses to record daily dose administration logs.

## Tech Stack

- *Backend:* Node.js, Express
- *Database:* SQLite
- *Frontend:* HTML, CSS, Vanilla JavaScript
- *Security:* Password hashing (bcrypt), JWT authentication (jsonwebtoken), and login rate limiting

## Project Structure

text
CareDose/
├── db/             # Database schema and initialization scripts
├── public/         # Frontend HTML, CSS, and client-side JavaScript
├── scripts/        # Sample data and database seeding scripts
├── auth.js         # Authentication, JWT tokens, rate limiting, and role middleware
├── server.js       # Express server and REST API endpoints
└── package.json    # Dependencies and start scripts


## Getting Started

1. *Clone the repository:*
   bash
   git clone https://github.com
   cd CareDose
   

2. *Install dependencies:*
   bash
   npm install
   

3. *Start the server:*
   bash
   npm start
   

4. *Open in your browser:*
   Visit http://localhost:3000

## Demo Login Credentials

| Role | Email | Password |
| :--- | :--- | :--- |
| *Nurse* | nurse@caredose.test | nurse123 |
| *Doctor* | doctor@caredose.test | doctor123 |