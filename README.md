# CareDose

CareDose requires Node.js 22.13 or newer. Starting the app initializes the SQLite
schema and creates `caredose.sqlite` in the project root. Set `CAREDOSE_DB_PATH` to
use a different database file.

Run `npm run db:seed` to add the demo accounts, residents, and medicines. The seed
can be run repeatedly without adding duplicate records. Demo credentials are
`doctor@caredose.test` / `doctor123` and `nurse@caredose.test` / `nurse123`;
use them only for local development.

The sign-in form posts to `POST /api/login` and returns a signed bearer token
containing the user's name and role. Tokens expire after eight hours. Configure
`CAREDOSE_TOKEN_SECRET` to a strong, private value so tokens remain verifiable
after server restarts; without it, a fresh signing key is generated on each
server start. Login attempts are limited to 10 per client IP in a 15-minute window.

After signing in, nurses can view today's medicines, residents, and the action
log, and record doses. The Today view creates one daily dose for each active
medicine when opened. Morning, afternoon, evening, and bedtime doses are
scheduled for 08:00, 12:00, 18:00, and 21:00 in the server's local time zone.
Nurses can mark doses Given, Refused, or Missed; pending doses are shown as
Upcoming, Due now, or Overdue based on their scheduled time. Each recorded
action stores the nurse and recording time in the dose and audit log. Given
doses decrement stock without allowing it below zero. Doctors can view the
overview, which reports today's dose counts and each resident's given-dose
percentage, collects overdue-dose and low-stock alerts, and view the staff
list, browse residents and the log, and add prescriptions and residents. The
overview report is calculated by the server using the same status rules as the
Today view. The Log shows the 100 most recent actions, newest first, and is the
record used for checking mistakes; doctors can review the full log.
Doctors can create nurse accounts from the Staff view; the initial password is
stored as a salted scrypt hash, and account creation is recorded in the log.
Overdue doses are highlighted in red; medicines with five or fewer tablets
trigger a low-stock warning. The doctor-only Prescribe view records medicine
name, strength, time of day, and stock. The server refuses a prescription when
its medicine name contains a resident's recorded allergy. The Residents view
shows each resident's details, allergies, and medicines. Only doctors can add
residents, and the server validates required name and room fields and an age
between 0 and 120. Protected API routes require the login bearer token; every
`/api/doctor` route is restricted to doctor accounts, and every `/api/nurse`
route is restricted to nurse accounts.

The interface uses a high-contrast teal-and-white palette, large text and touch
targets, and distinct colors for given, warning, and overdue states. Tables
reflow into labeled cards on small screens; the dashboard is designed to fit
360-pixel-wide phones without horizontal page scrolling.
