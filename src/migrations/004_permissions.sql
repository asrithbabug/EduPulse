-- ══════════════════════════════════════════════════════════════════
-- Migration 004 — Teacher Permissions
-- Source: schema-permissions.sql
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS teacher_permissions (
  id         SERIAL PRIMARY KEY,
  teacher_id VARCHAR(20) REFERENCES teachers(id) ON DELETE CASCADE,
  module_id  VARCHAR(30) NOT NULL,
  can_view   BOOLEAN DEFAULT TRUE,
  can_edit   BOOLEAN DEFAULT FALSE,
  granted_by VARCHAR(20) REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(teacher_id, module_id)
);

-- Grant all teachers full access by default
INSERT INTO teacher_permissions (teacher_id, module_id, can_view, can_edit)
SELECT t.id, m.module_id, true, true
FROM teachers t
CROSS JOIN (VALUES
  ('attendance'),('marks'),('homework'),('announcements'),
  ('materials'),('leave'),('chat'),('class_log'),('timetable'),('reports')
) AS m(module_id)
ON CONFLICT DO NOTHING;
