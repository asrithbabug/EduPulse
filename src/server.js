require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');

// Route imports
const authRoutes         = require('./routes/auth');
const passwordRoutes     = require('./routes/password');
const studentRoutes      = require('./routes/student');
const teacherRoutes      = require('./routes/teacher');
const announcementRoutes = require('./routes/announcements');
const homeworkRoutes     = require('./routes/homework');
const timetableRoutes    = require('./routes/timetable');
const leaveRoutes        = require('./routes/leave');
const chatRoutes         = require('./routes/chat');
const marksRoutes        = require('./routes/marks');
const adminRoutes        = require('./routes/admin');
const enterpriseRoutes   = require('./routes/enterprise');
const reportsRoutes      = require('./routes/reports');
const excelRoutes        = require('./routes/excel');
const permissionsRoutes  = require('./routes/permissions');
const subjectsRoutes     = require('./routes/subjects');
const examsRoutes        = require('./routes/exams');
const academicRoutes     = require('./routes/academic');
const feesManagementRoutes = require('./routes/fees-management');
const deviceRoutes         = require('./routes/device');

const app  = express();
const PORT = process.env.PORT || 3001;

// Behind Nginx/ALB, trust proxy so rate-limit can read client IP safely.
app.set('trust proxy', 1);

// ── Initialize Firebase Cloud Messaging ──────────────────────────
const { initFirebase } = require('./services/push-notifications');
initFirebase();

// ── Auto-apply critical schema additions (defensive) ─────────────
const db = require('./db');
(async () => {
  try {
    // Ensure school_calendar table exists (from schema-v2-additions)
    await db.query(`
      CREATE TABLE IF NOT EXISTS school_calendar (
        id           SERIAL PRIMARY KEY,
        school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
        date         DATE NOT NULL,
        type         VARCHAR(20) NOT NULL CHECK (type IN ('holiday','event','exam','half_day')),
        title        VARCHAR(200) NOT NULL,
        description  TEXT,
        academic_year_id INTEGER,
        created_at   TIMESTAMP DEFAULT NOW(),
        UNIQUE(school_id, date, type)
      )
    `);
    // Ensure attendance has period column and updated constraint
    await db.query(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS period INTEGER`);
    // Ensure password_tokens table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_tokens (
        id           SERIAL PRIMARY KEY,
        user_id      VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
        token        VARCHAR(64) NOT NULL UNIQUE,
        type         VARCHAR(20) NOT NULL DEFAULT 'set_password',
        used         BOOLEAN DEFAULT FALSE,
        expires_at   TIMESTAMP NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    // Ensure device_tokens table exists (for FCM push notifications)
    await db.query(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id           SERIAL PRIMARY KEY,
        user_id      VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
        fcm_token    TEXT NOT NULL,
        device_type  VARCHAR(10) CHECK (device_type IN ('android','ios','web')),
        device_id    VARCHAR(100),
        is_active    BOOLEAN DEFAULT TRUE,
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, fcm_token)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id)`);

    // Ensure admission numbers can be stored as YYYYMMDDNNN.
    await db.query(`
      ALTER TABLE students
      ALTER COLUMN roll_no TYPE VARCHAR(20) USING roll_no::text
    `);

    // Create uniqueness index only when existing data has no duplicates.
    const dupRollRes = await db.query(`
      SELECT school_id, roll_no, COUNT(*)::int AS cnt
      FROM students
      WHERE roll_no IS NOT NULL
      GROUP BY school_id, roll_no
      HAVING COUNT(*) > 1
      LIMIT 1
    `);

    if (dupRollRes.rows.length === 0) {
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_students_school_roll_no
        ON students(school_id, roll_no)
        WHERE roll_no IS NOT NULL
      `);
    } else {
      const d = dupRollRes.rows[0];
      console.warn(`  ⚠ Skipping uq_students_school_roll_no due to duplicate roll_no data (school_id=${d.school_id}, roll_no=${d.roll_no}, count=${d.cnt})`);
    }

    // Ensure teacher identity columns exist for employee ID + Aadhaar handling.
    await db.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS employee_id VARCHAR(20)`);
    await db.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS aadhaar VARCHAR(12)`);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_teachers_employee_id
      ON teachers(employee_id)
      WHERE employee_id IS NOT NULL
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_teachers_aadhaar
      ON teachers(aadhaar)
      WHERE aadhaar IS NOT NULL
    `);
    console.log('  ✓ Schema checks passed');
  } catch (err) {
    console.warn('  ⚠ Schema auto-check warning:', err.message);
  }
})();

// ── Performance middleware ────────────────────────────────────────
app.use(compression());

// ── Security middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ── Cache-Control for static assets ─────────────────────────────
app.use('/static', express.static('public', {
  maxAge: '7d',
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

// Rate limiting
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
}));

app.use('/api/', rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 100,
  message: { error: 'Too many requests. Please slow down.' },
}));

// ── Routes ───────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/password',      passwordRoutes);
app.use('/api/student',       studentRoutes);
app.use('/api/teacher',       teacherRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/homework',      homeworkRoutes);
app.use('/api/timetable',     timetableRoutes);
app.use('/api/leave',         leaveRoutes);
app.use('/api/chat',          chatRoutes);
app.use('/api/marks',         marksRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/enterprise',    enterpriseRoutes);
app.use('/api/reports',       reportsRoutes);
app.use('/api/excel',         excelRoutes);
app.use('/api/permissions',   permissionsRoutes);
app.use('/api/subjects',      subjectsRoutes);
app.use('/api/exams',         examsRoutes);
app.use('/api/academic',      academicRoutes);
app.use('/api/fees-mgmt',     feesManagementRoutes);
app.use('/api/device',        deviceRoutes);

// API root check
app.get('/api', (req, res) => res.json({
  status: 'ok',
  service: 'EduPulse API',
  version: '2.0.0',
  timestamp: new Date().toISOString(),
}));

app.get('/api/', (req, res) => res.json({
  status: 'ok',
  service: 'EduPulse API',
  version: '2.0.0',
  timestamp: new Date().toISOString(),
}));

// Public: List schools (no auth needed — used by mobile app school selection)
app.get('/api/schools/list', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, code, city, state FROM schools WHERE is_active = true AND is_locked = false ORDER BY name`
    );
    res.json({ data: rows });
  } catch (err) {
    console.error('Public schools list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Health check
app.get('/health', (req, res) => res.json({
  status: 'ok',
  service: 'EduPulse API',
  version: '2.0.0',
  timestamp: new Date().toISOString(),
}));

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n✅ EduPulse API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});
