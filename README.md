Go to: https://github.com/Amin-haddad/appointment-booking-app

Click the "Add a README" button (or the pencil icon on the main page).

Delete everything that's there and paste the following:

# Appointment Booking Application

A full-stack appointment booking system built from an SRS document. Patients browse available slots, book appointments, and receive email notifications. Admins manage schedules, view bookings, and track utilisation.

## Features

**Client (Patient):** Register & verify email | Browse slots | Book & cancel appointments | View history with filters | Email notifications (confirmation, cancellation, reminders)

**Admin (Doctor):** Create & manage slots | View all bookings | Cancel bookings | Schedule overview with fill rate stats | Configure reminders

**Security:** JWT RS256 auth | bcrypt (cost 12+) | Rate limiting (5/15min) | XSS & SQL injection protection | Role-based access

## Tech Stack

React 18 + Vite | Node.js 20 + Express 4.18 | MySQL 8.0 (Docker) | JWT RS256 + bcrypt | Nodemailer + Gmail SMTP

## SRS Compliance (v1.0, April 2026)

FR-01 ✅ | FR-02 ✅ | FR-03 ✅ | FR-04 ✅ | FR-05 ✅ | FR-06 ✅ | FR-07 ✅ | FR-08 ✅ | FR-09 ✅ | FR-10 ✅

## Quick Start

### 1. Clone & Setup Database
git clone https://github.com/Amin-haddad/appointment-booking-app.git
cd appointment-booking-app
docker run --name mysql-project -e MYSQL_ROOT_PASSWORD=NewPassword123! -p 3306:3306 -d mysql:8.0
docker exec -i mysql-project mysql -uroot -pNewPassword123! -e "CREATE DATABASE IF NOT EXISTS appointment_db;"
cd backend
Get-Content database/schema.sql | docker exec -i mysql-project mysql -uroot -pNewPassword123! appointment_db

### 2. Create backend/.env
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=appointment_db
DB_USER=root
DB_PASSWORD=NewPassword123!
JWT_PRIVATE_KEY=your_rsa_private_key
JWT_PUBLIC_KEY=your_rsa_public_key
JWT_ACCESS_EXPIRY=1h
JWT_REFRESH_EXPIRY=7d
BCRYPT_COST_FACTOR=12
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your_app_password
EMAIL_FROM_ADDRESS=your-email@gmail.com
RATE_LIMIT_LOGIN_MAX=5
RATE_LIMIT_LOGIN_WINDOW_MS=900000

### 3. Install & Run
cd backend && npm install
cd ../frontend && npm install

Terminal 1: docker start mysql-project
Terminal 2: cd backend && node server.js
Terminal 3: cd frontend && npm run dev

Open: http://localhost:3000

## Test Accounts

Register a new client at /register or create admin:
docker exec -i mysql-project mysql -uroot -pNewPassword123! appointment_db -e "INSERT INTO users (full_name, email, password_hash, role, is_verified, is_active) SELECT 'Admin', 'admin@example.com', password_hash, 'admin', 1, 1 FROM users LIMIT 1;"

Then login: admin@example.com / Password123!

## Troubleshooting

MySQL not running: docker start mysql-project
Rate limited: docker exec -i mysql-project mysql -uroot -pNewPassword123! -e "TRUNCATE TABLE appointment_db.login_attempts;"
Email fails: Use Gmail App Password (not regular password) from https://myaccount.google.com/apppasswords

## Author

Amine Haddad - Educational SRS-based project

---

Then scroll down and click the green "Commit changes" button.
