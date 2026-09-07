-- ══════════════════════════════════════════════════════════════════
-- Migration 001 — Initial Schema
-- Source: schema.sql
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS schools (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  code         VARCHAR(20) UNIQUE NOT NULL,
  address      TEXT,
  city         VARCHAR(100),
  state        VARCHAR(100),
  phone        VARCHAR(20),
  email        VARCHAR(100),
  logo_url     VARCHAR(500),
  is_active    BOOLEAN DEFAULT TRUE,
  is_locked    BOOLEAN DEFAULT FALSE,
  settings     JSONB DEFAULT '{}',
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  plan         VARCHAR(30) NOT NULL CHECK (plan IN ('basic','standard','premium','enterprise')),
  status       VARCHAR(20) NOT NULL CHECK (status IN ('active','expired','cancelled','trial')),
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  amount       NUMERIC(10,2),
  max_students INTEGER DEFAULT 500,
  max_teachers INTEGER DEFAULT 50,
  features     JSONB DEFAULT '[]',
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id           VARCHAR(20) PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE SET NULL,
  password     VARCHAR(255) NOT NULL,
  role         VARCHAR(20) NOT NULL CHECK (role IN ('parent','teacher','admin','enterprise_admin')),
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(100),
  phone        VARCHAR(20),
  is_active    BOOLEAN DEFAULT TRUE,
  password_set BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
  id           VARCHAR(20) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  parent_name  VARCHAR(100),
  class        VARCHAR(10) NOT NULL,
  roll_no      VARCHAR(20),
  section      VARCHAR(5),
  date_of_birth DATE,
  gender       VARCHAR(10),
  address      TEXT,
  admission_date DATE DEFAULT CURRENT_DATE,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_students_school_roll_no
  ON students(school_id, roll_no)
  WHERE roll_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS teachers (
  id           VARCHAR(20) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  subject      VARCHAR(50),
  experience   VARCHAR(20),
  qualification VARCHAR(100),
  department   VARCHAR(50),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_classes (
  teacher_id   VARCHAR(20) REFERENCES teachers(id) ON DELETE CASCADE,
  class        VARCHAR(10),
  PRIMARY KEY (teacher_id, class)
);

CREATE TABLE IF NOT EXISTS classes (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  name         VARCHAR(20) NOT NULL,
  section      VARCHAR(5),
  class_teacher_id VARCHAR(20) REFERENCES teachers(id),
  room_number  VARCHAR(20),
  capacity     INTEGER DEFAULT 40,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  student_id   VARCHAR(20) REFERENCES students(id) ON DELETE CASCADE,
  teacher_id   VARCHAR(20) REFERENCES teachers(id),
  class        VARCHAR(10),
  date         DATE NOT NULL,
  status       VARCHAR(10) CHECK (status IN ('present','absent','late')),
  created_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, date)
);

CREATE TABLE IF NOT EXISTS marks (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  student_id   VARCHAR(20) REFERENCES students(id) ON DELETE CASCADE,
  teacher_id   VARCHAR(20) REFERENCES teachers(id),
  subject      VARCHAR(50) NOT NULL,
  exam_type    VARCHAR(20) NOT NULL,
  marks        INTEGER,
  total_marks  INTEGER DEFAULT 100,
  grade        VARCHAR(5),
  academic_year VARCHAR(10),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fees (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  student_id   VARCHAR(20) REFERENCES students(id) ON DELETE CASCADE,
  description  VARCHAR(100),
  amount       NUMERIC(10,2),
  status       VARCHAR(10) CHECK (status IN ('paid','due','overdue')),
  due_date     DATE,
  paid_date    DATE,
  academic_year VARCHAR(10),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fee_structure (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  class        VARCHAR(10),
  description  VARCHAR(100) NOT NULL,
  amount       NUMERIC(10,2) NOT NULL,
  frequency    VARCHAR(20) CHECK (frequency IN ('monthly','quarterly','annually','one-time')),
  academic_year VARCHAR(10),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  title        VARCHAR(200) NOT NULL,
  body         TEXT NOT NULL,
  category     VARCHAR(30),
  important    BOOLEAN DEFAULT FALSE,
  target_class VARCHAR(10),
  posted_by    VARCHAR(20) REFERENCES users(id),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS materials (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  title        VARCHAR(200) NOT NULL,
  subject      VARCHAR(50),
  class        VARCHAR(10),
  type         VARCHAR(30),
  file_url     VARCHAR(500),
  uploaded_by  VARCHAR(20) REFERENCES teachers(id),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS timetable (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  class        VARCHAR(10) NOT NULL,
  section      VARCHAR(5),
  day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period       INTEGER NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  subject      VARCHAR(50) NOT NULL,
  teacher_id   VARCHAR(20) REFERENCES teachers(id),
  room         VARCHAR(20),
  created_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE(school_id, class, section, day_of_week, period)
);

CREATE TABLE IF NOT EXISTS homework (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  class        VARCHAR(10) NOT NULL,
  section      VARCHAR(5),
  subject      VARCHAR(50) NOT NULL,
  title        VARCHAR(200) NOT NULL,
  description  TEXT,
  due_date     DATE,
  assigned_by  VARCHAR(20) REFERENCES teachers(id),
  attachment_url VARCHAR(500),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS homework_submissions (
  id           SERIAL PRIMARY KEY,
  homework_id  INTEGER REFERENCES homework(id) ON DELETE CASCADE,
  student_id   VARCHAR(20) REFERENCES students(id) ON DELETE CASCADE,
  status       VARCHAR(20) CHECK (status IN ('pending','completed','late','graded')),
  submitted_at TIMESTAMP,
  remarks      TEXT,
  grade        VARCHAR(5),
  UNIQUE(homework_id, student_id)
);

CREATE TABLE IF NOT EXISTS leave_applications (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  student_id   VARCHAR(20) REFERENCES students(id) ON DELETE CASCADE,
  applied_by   VARCHAR(20) REFERENCES users(id),
  reason       TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  status       VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by  VARCHAR(20) REFERENCES teachers(id),
  remarks      TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  sender_id    VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
  receiver_id  VARCHAR(20) REFERENCES users(id) ON DELETE CASCADE,
  message      TEXT NOT NULL,
  is_read      BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS class_logs (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  class        VARCHAR(10) NOT NULL,
  teacher_id   VARCHAR(20) REFERENCES teachers(id),
  subject      VARCHAR(50),
  topic        VARCHAR(200),
  notes        TEXT,
  date         DATE NOT NULL,
  period       INTEGER,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS achievements (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  student_id   VARCHAR(20) REFERENCES students(id) ON DELETE CASCADE,
  title        VARCHAR(200) NOT NULL,
  description  TEXT,
  category     VARCHAR(50),
  date         DATE,
  awarded_by   VARCHAR(20) REFERENCES users(id),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  raised_by    VARCHAR(20) REFERENCES users(id),
  subject      VARCHAR(200) NOT NULL,
  description  TEXT NOT NULL,
  category     VARCHAR(50),
  priority     VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status       VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to  VARCHAR(20),
  resolution   TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE SET NULL,
  user_id      VARCHAR(20),
  action       VARCHAR(50) NOT NULL,
  entity       VARCHAR(50),
  entity_id    VARCHAR(50),
  details      JSONB,
  ip_address   VARCHAR(50),
  created_at   TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chat_sender      ON chat_messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_receiver    ON chat_messages(receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_date  ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_marks_student    ON marks(student_id);
CREATE INDEX IF NOT EXISTS idx_fees_student     ON fees(student_id);
CREATE INDEX IF NOT EXISTS idx_homework_class   ON homework(class, due_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_student    ON leave_applications(student_id);
CREATE INDEX IF NOT EXISTS idx_timetable_class  ON timetable(class, day_of_week);
CREATE INDEX IF NOT EXISTS idx_audit_school     ON audit_log(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_log(user_id, created_at DESC);

-- Seed data
INSERT INTO schools (name, code, city, state, email) VALUES
  ('Demo International School', 'DEMO001', 'Bangalore', 'Karnataka', 'admin@demoschool.com')
ON CONFLICT DO NOTHING;

INSERT INTO users (id, school_id, password, role, name, email, phone, password_set) VALUES
  ('ENT001', NULL, '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'enterprise_admin', 'Super Admin', 'superadmin@edupulse.com', '+919000000000', true)
ON CONFLICT DO NOTHING;

INSERT INTO classes (school_id, name, section, capacity) VALUES
  (1,'10','A',40),(1,'10','B',40),(1,'9','A',35),(1,'9','B',35),(1,'8','A',38)
ON CONFLICT DO NOTHING;

INSERT INTO subscriptions (school_id, plan, status, start_date, end_date, amount, max_students, max_teachers) VALUES
  (1, 'premium', 'active', '2025-01-01', '2025-12-31', 50000.00, 1000, 100)
ON CONFLICT DO NOTHING;
