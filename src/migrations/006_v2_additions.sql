-- ══════════════════════════════════════════════════════════════════
-- Migration 006 — Academic Years, Subjects, Exams, Calendar
-- Source: schema-v2-additions.sql
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS academic_years (
  id         SERIAL PRIMARY KEY,
  school_id  INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  name       VARCHAR(20) NOT NULL,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  is_current BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_year_current
  ON academic_years(school_id) WHERE is_current = true;

CREATE TABLE IF NOT EXISTS subjects (
  id         SERIAL PRIMARY KEY,
  school_id  INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  name       VARCHAR(50) NOT NULL,
  code       VARCHAR(10),
  department VARCHAR(50),
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(school_id, name)
);

CREATE TABLE IF NOT EXISTS class_subjects (
  id         SERIAL PRIMARY KEY,
  school_id  INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  class      VARCHAR(10) NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE(school_id, class, subject_id)
);

CREATE TABLE IF NOT EXISTS teacher_subject_classes (
  id         SERIAL PRIMARY KEY,
  teacher_id VARCHAR(20) REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
  class      VARCHAR(10) NOT NULL,
  section    VARCHAR(5),
  UNIQUE(teacher_id, subject_id, class, section)
);

CREATE TABLE IF NOT EXISTS exam_types (
  id               SERIAL PRIMARY KEY,
  school_id        INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  name             VARCHAR(50) NOT NULL,
  academic_year_id INTEGER REFERENCES academic_years(id),
  max_marks        INTEGER DEFAULT 100,
  weightage        NUMERIC(5,2) DEFAULT 100,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(school_id, name, academic_year_id)
);

CREATE TABLE IF NOT EXISTS exam_schedule (
  id           SERIAL PRIMARY KEY,
  school_id    INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  exam_type_id INTEGER REFERENCES exam_types(id) ON DELETE CASCADE,
  subject_id   INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
  class        VARCHAR(10) NOT NULL,
  exam_date    DATE,
  start_time   TIME,
  end_time     TIME,
  room         VARCHAR(20),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_calendar (
  id               SERIAL PRIMARY KEY,
  school_id        INTEGER REFERENCES schools(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  type             VARCHAR(20) NOT NULL CHECK (type IN ('holiday','event','exam','half_day')),
  title            VARCHAR(200) NOT NULL,
  description      TEXT,
  academic_year_id INTEGER REFERENCES academic_years(id),
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE(school_id, date, type)
);

-- Attendance: add period column and update constraint
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS period INTEGER;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_student_id_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique
  ON attendance(student_id, date, COALESCE(period, 0));

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('present','absent','late','leave'));
