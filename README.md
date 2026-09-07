# EduPulse Backend

Node.js + Express REST API for the EduPulse school management platform.

## Setup

```bash
npm install
cp .env.example .env   # fill in your values
npm run dev
```

## Production

```bash
npm start
```

Runs on port 3001 by default (configurable via `PORT` in `.env`).

## Environment Variables

See `.env.example` for all required variables:
- Database (PostgreSQL on RDS)
- JWT secret + expiry
- AWS credentials (SES email, SNS SMS)
- Firebase service account (FCM push notifications)

## API Routes

| Prefix | Module |
|--------|--------|
| `/api/auth` | Authentication |
| `/api/password` | Password setup/reset |
| `/api/admin` | School admin operations |
| `/api/enterprise` | Enterprise admin operations |
| `/api/student` | Student data |
| `/api/teacher` | Teacher data |
| `/api/announcements` | Announcements |
| `/api/timetable` | Timetable |
| `/api/subjects` | Subjects |
| `/api/exams` | Exams |
| `/api/academic` | Academic calendar |
| `/api/fees-mgmt` | Fees management |
| `/api/permissions` | Teacher permissions |
| `/api/reports` | Reports |
| `/api/excel` | Excel import/export |
| `/api/homework` | Homework |
| `/api/leave` | Leave management |
| `/api/chat` | Chat |
| `/api/marks` | Marks/grades |
| `/api/device` | Device token management |
| `/api/schools/list` | Public school list (used by mobile app) |

## Security Note

The hardcoded `admin`/`admin` enterprise admin backdoor has been **removed** from
`src/routes/auth.js`. All logins now go through bcrypt password verification.

## Related Repos

- **edupulse-mobile** — Flutter mobile app
- **edupulse-admin** — Enterprise admin portal (Next.js)
- **edupulse-schools** — School admin portal (Next.js)
