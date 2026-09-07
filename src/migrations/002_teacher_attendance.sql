-- ══════════════════════════════════════════════════════════════════
-- Migration 002 — Teacher Self-Attendance
-- Source: schema-teacher-attendance.sql
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS teacher_attendance (
  id           SERIAL PRIMARY KEY,
  teacher_id   VARCHAR(20) REFERENCES teachers(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  status       VARCHAR(20) NOT NULL CHECK (status IN ('present','absent','leave','half_day')),
  remarks      TEXT,
  marked_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(teacher_id, date)
);

CREATE INDEX IF NOT EXISTS idx_teacher_att_date    ON teacher_attendance(date);
CREATE INDEX IF NOT EXISTS idx_teacher_att_teacher ON teacher_attendance(teacher_id, date DESC);
