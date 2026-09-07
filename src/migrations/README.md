# EduPulse — Database Migrations

Migrations are numbered and run in order. Each file is idempotent (`IF NOT EXISTS`, `IF NOT EXISTS` constraints).

| File | Description |
|---|---|
| `001_initial_schema.sql` | All core tables — schools, users, students, teachers, attendance, marks, fees, etc. |
| `002_teacher_attendance.sql` | Teacher self-attendance table |
| `003_password_tokens.sql` | Password set/reset token management |
| `004_permissions.sql` | Per-module teacher permissions |
| `005_device_tokens.sql` | FCM push notification device tokens |
| `006_v2_additions.sql` | Academic years, subjects master, exam types, school calendar |
| `007_fees_fix.sql` | Fees table additional columns and status fix |
| `008_student_admission_normalized_design.sql` | Non-breaking normalized student admission schema in admission_v2 |
| `009_teacher_employee_identity.sql` | Adds teacher employee_id and aadhaar constraints/indexes on legacy schema |
| `010_teacher_normalized_design.sql` | Non-breaking normalized teacher schema in teacher_v2 |

## Running Migrations

### On a fresh database
```bash
psql -h <RDS_HOST> -U edupulse_admin -d edupulse -f src/migrations/001_initial_schema.sql
psql -h <RDS_HOST> -U edupulse_admin -d edupulse -f src/migrations/002_teacher_attendance.sql
# ... run in order up to latest migration
```

### On an existing database
All migrations use `IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` — safe to re-run.
```bash
for f in src/migrations/*.sql; do
  echo "Running $f..."
  psql -h <RDS_HOST> -U edupulse_admin -d edupulse -f "$f"
done
```

## Adding a new migration
1. Create next-numbered migration file (for example `011_your_description.sql`)
2. Use `IF NOT EXISTS` everywhere
3. Add an entry to this README
