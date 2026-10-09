# Msongola Attendance System

A school attendance app with full-class attendance submissions to the Academic Master office, guardian SMS contacts, monthly reports, and automatic monthly attendance SMS through Africa's Talking.

## Requirements

- Node.js 20 or newer
- MySQL 8 or a compatible MariaDB server (XAMPP's MySQL/MariaDB is suitable)
- An Africa's Talking account/API key for live SMS delivery

## Setup on Windows/XAMPP

1. Start MySQL in the XAMPP Control Panel and import `Database/schema.sql` using phpMyAdmin. This creates the `msongola_attendance` database and its tables.
2. In PowerShell, enter the backend directory and install dependencies:

   ```powershell
   cd C:\xampp1\htdocs\msongola-Attendance-system\Backend
   npm install
   Copy-Item .env.example .env
   ```

3. Edit `Backend/.env` with the MySQL connection details and set `JWT_SECRET` to a private random value of at least 32 characters. For example, generate one with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Set `FRONTEND_ORIGIN` to the browser origin serving the `Frontend` folder (`http://localhost` for the default XAMPP setup). The browser API URL is `http://localhost:3000/api` in `Frontend/js/api.js`.

4. Create the first administrator. Admins and teachers sign in with a unique username and password; the phone number is used for contact details. Set the initial password only for this PowerShell session:

   ```powershell
   $env:ADMIN_PASSWORD = "Admin6!"
   npm run create-admin -- "School Administrator" schooladmin "+255712345678"
   Remove-Item Env:ADMIN_PASSWORD
   ```

   Usernames must be 3-50 letters, numbers, dots, underscores, or hyphens. Phone numbers must use international format, for example `+255...`. Passwords need at least 6 characters (not 12) and must fit bcrypt's 72-byte limit. The example password is for demonstration only; choose your own.

5. Start the API:

   ```powershell
   npm start
   ```

6. Open `http://localhost/msongola-Attendance-system/Frontend/` in a browser when using XAMPP Apache. The API health check is at `http://localhost:3000/api/health`.

## Monthly parent SMS

- The system aggregates each guardian's linked students' recorded attendance for the previous calendar month into one plain-text Swahili SMS per family.
- The job starts once when the API starts (to catch up if it was offline) and runs daily at 08:00 using `SMS_TIMEZONE`. Successfully sent guardian/month pairs are recorded uniquely, so restarts do not resend them. Failed messages are retried on a later daily run or restart.
- Keep the API process running for scheduled sends. For unattended Windows installations, configure the API to start at boot with a service manager or Windows Task Scheduler; startup recovery will process any missed previous-month send.
- Only students with attendance records in that month are included. Counts include `present`, `absent`, and `sick`; older `late` and `excused` records remain in summaries for history.
- Configure `SMS_USERNAME`, `SMS_API_KEY`, and, if approved for your account, `SMS_SENDER_ID` in `Backend/.env`. For live delivery use your Africa's Talking production credentials; sandbox credentials do not deliver normal production messages. The default timezone is `Africa/Dar_es_Salaam`; change it to the school's IANA timezone if needed.
- Administrators can check monthly delivery status and retry counts in the browser UI, and manually retry a failed message from its log entry.
- Guardians do not sign in and do not need system accounts. During enrollment, save a guardian's name and international-format phone number. The API sends one plain-text SMS per guardian each month, summarizing each linked student's attendance.
- For an existing installation, back up the database and run `Database/migrations/2026-10-staff-usernames-and-guardian-contacts.sql` once in phpMyAdmin before starting the updated API. Existing staff usernames are migrated to `admin<ID>` or `teacher<ID>` (where `<ID>` is their database user ID); give those usernames to staff. Existing parent accounts are converted to guardian contacts while preserving their linked students and SMS logs, then removed as login accounts. Do not run this migration more than once.
- For an existing installation that already completed the staff/guardian migration, back up the database and run `Database/migrations/2026-10-academic-master-role.sql` once to enable academic master accounts. Do not run it more than once.
- For an existing installation, back up the database and run `Database/migrations/2026-10-attendance-submissions.sql` once after the other applicable migrations. It enables illness status and complete-class submission receipts for the Academic Master office.
- For an existing installation, then run `Database/migrations/2026-10-attendance-review-and-reminders.sql` once to add Academic Office approval tracking and in-system notifications. Apply it only after the attendance-submissions migration.
- `ATTENDANCE_REMINDER_TIME` sets the daily teacher reminder deadline in 24-hour `HH:MM` format and defaults to `16:00` in `SMS_TIMEZONE`. On weekdays, teachers assigned to a class with active students receive an account notification if that day's complete register has not been submitted. If the API was offline at the deadline, it checks for missed submissions when it next starts. The reminder is marked read when a register for that class and date is submitted.
- For public deployment, serve the frontend and API over HTTPS, set `COOKIE_SECURE=true`, and set `FRONTEND_ORIGIN` to the exact frontend origin.

## Initial workflows

- All staff can view and update their own profile details. Administrators can additionally create classes, enroll students and save guardian contact details, create teacher and academic master accounts, update staff account details, reset staff passwords, assign teachers to classes, and review attendance reports. Administrators cannot submit a daily class register.
- Teachers can only view and submit attendance for assigned classes. A register must include every active student in the class; each student is marked present, absent, or sick. Illness details are required for sick students. The complete register and submission receipt are saved together and displayed to the Academic Master office. A saved date can be submitted again if a correction is needed. Teachers receive notifications when the Academic Office approves or returns a submission, and weekday reminders for registers still missing at the configured deadline.
- Academic masters have a separate account created by an administrator. They can review complete submitted daily registers and attendance notes, approve submissions for reports, or return them with a required correction note. Only approved submissions are included in reports and guardian SMS; historical attendance records without a submission receipt remain reportable. Academic masters can also view/download/print school monthly attendance reports. They cannot record attendance, create accounts, or access administrator controls.
- Guardians have no login account; they receive monthly attendance summaries by ordinary SMS. Admins and teachers can change their passwords after signing in.

Run `npm test` and `npm run check` from `Backend` for the focused date/syntax checks.