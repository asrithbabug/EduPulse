const router   = require('express').Router();
const crypto   = require('crypto');
const db       = require('../db');
const bcrypt   = require('bcryptjs');
const adminAuth = require('../middleware/adminAuth');
const { sendSetPasswordEmail } = require('../services/email');

const APP_URL = process.env.APP_URL || 'http://13.126.4.16';

/**
 * Helper: Generate token and send setup email for a new user
 */
async function sendSetupLink(userId, userEmail, userName, schoolName) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

  await db.query(
    `INSERT INTO password_tokens (user_id, token, type, expires_at)
     VALUES ($1, $2, 'set_password', $3)`,
    [userId, token, expiresAt]
  );

  const setupLink = `${APP_URL}/set-password?token=${token}`;

  let emailResult = { success: false, error: 'No email provided' };
  if (userEmail) {
    emailResult = await sendSetPasswordEmail(userEmail, userName, token, schoolName);
  }

  return { setupLink, emailResult };
}

async function generateUniqueStudentId(client, schoolName, aadhaarDigits) {
  const compactSchool = (schoolName || 'SCH')
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
  const prefix = (compactSchool.slice(0, 3) || 'SCH').padEnd(3, 'X');
  const baseId = `${prefix}${aadhaarDigits.slice(-4)}`;

  const { rows } = await client.query(
    `SELECT id FROM users WHERE id = $1 OR id LIKE $2 ORDER BY id`,
    [baseId, `${baseId}-%`]
  );

  const used = new Set(rows.map((r) => r.id));
  if (!used.has(baseId)) return baseId;

  let seq = 1;
  while (used.has(`${baseId}-${String(seq).padStart(2, '0')}`)) {
    seq += 1;
  }

  return `${baseId}-${String(seq).padStart(2, '0')}`;
}

async function generateAdmissionNo(client, schoolId, admissionDateISO) {
  const datePrefix = admissionDateISO.replace(/-/g, '');

  const columnCheck = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'admission_date'
     LIMIT 1`
  );

  const hasAdmissionDateColumn = columnCheck.rows.length > 0;

  const { rows } = hasAdmissionDateColumn
    ? await client.query(
      `SELECT roll_no::text AS roll_no
       FROM students
       WHERE school_id = $1 AND admission_date = $2 AND roll_no IS NOT NULL`,
      [schoolId, admissionDateISO]
    )
    : await client.query(
      `SELECT roll_no::text AS roll_no
       FROM students
       WHERE school_id = $1
         AND roll_no::text LIKE $2
         AND roll_no IS NOT NULL`,
      [schoolId, `${datePrefix}%`]
    );

  let maxSerial = 0;
  for (const row of rows) {
    const value = row.roll_no || '';
    if (/^\d+$/.test(value) && value.startsWith(datePrefix) && value.length === 11) {
      const serial = parseInt(value.slice(-3), 10);
      if (serial > maxSerial) maxSerial = serial;
    }
  }

  const nextSerial = maxSerial + 1;
  if (nextSerial > 999) {
    throw new Error('Admission serial limit reached for this date');
  }

  return `${datePrefix}${String(nextSerial).padStart(3, '0')}`;
}

async function generateUniqueEmployeeId(client, aadhaarDigits) {
  const baseId = `EMP${aadhaarDigits.slice(-4)}`;
  const { rows } = await client.query(
    `SELECT id FROM users WHERE id = $1 OR id LIKE $2 ORDER BY id`,
    [baseId, `${baseId}-%`]
  );

  const used = new Set(rows.map((r) => r.id));
  if (!used.has(baseId)) return baseId;

  let seq = 1;
  while (used.has(`${baseId}-${String(seq).padStart(2, '0')}`)) {
    seq += 1;
  }

  return `${baseId}-${String(seq).padStart(2, '0')}`;
}

// All routes require admin authentication
router.use(adminAuth);

// ══════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/dashboard — KPIs
router.get('/dashboard', async (req, res) => {
  try {
    const schoolId = req.user.school_id;

    const [studentsCount, teachersCount, attendanceStats, feesStats] = await Promise.all([
      db.query('SELECT COUNT(*) FROM students WHERE school_id = $1', [schoolId]),
      db.query('SELECT COUNT(*) FROM teachers WHERE school_id = $1', [schoolId]),
      db.query(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'present') as present
         FROM attendance
         WHERE school_id = $1 AND date = CURRENT_DATE`,
        [schoolId]
      ),
      db.query(
        `SELECT
          COALESCE(SUM(amount), 0) as total_fees,
          COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as collected,
          COALESCE(SUM(amount) FILTER (WHERE status IN ('due','overdue')), 0) as pending
         FROM fees WHERE school_id = $1`,
        [schoolId]
      ),
    ]);

    const totalStudents = parseInt(studentsCount.rows[0].count);
    const totalTeachers = parseInt(teachersCount.rows[0].count);
    const attTotal = parseInt(attendanceStats.rows[0].total);
    const attPresent = parseInt(attendanceStats.rows[0].present);
    const attendancePercentage = attTotal > 0 ? Math.round((attPresent / attTotal) * 100 * 10) / 10 : 0;

    res.json({
      total_students: totalStudents,
      total_teachers: totalTeachers,
      attendance_today: {
        total: attTotal,
        present: attPresent,
        percentage: attendancePercentage,
      },
      fees: {
        total: parseFloat(feesStats.rows[0].total_fees),
        collected: parseFloat(feesStats.rows[0].collected),
        pending: parseFloat(feesStats.rows[0].pending),
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// ATTENDANCE (Student attendance for admin view)
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/attendance — View student attendance records
router.get('/attendance', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { date, class: cls, search } = req.query;
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    let query = `
      SELECT a.id, a.date, a.status, a.period,
             u.name as student_name, u.id as student_id,
             s.class, s.section, s.roll_no
      FROM attendance a
      JOIN students s ON s.id = a.student_id
      JOIN users u ON u.id = a.student_id
      WHERE a.school_id = $1`;
    const params = [schoolId];
    let idx = 2;

    if (date) { query += ` AND a.date = $${idx}`; params.push(date); idx++; }
    if (cls) { query += ` AND s.class = $${idx}`; params.push(cls); idx++; }
    if (search) { query += ` AND (u.name ILIKE $${idx} OR u.id ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    query += ` ORDER BY a.date DESC, s.class, s.roll_no LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);

    // Count
    let countQuery = `SELECT COUNT(*) FROM attendance a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = a.student_id WHERE a.school_id = $1`;
    const countParams = [schoolId];
    let cIdx = 2;
    if (date) { countQuery += ` AND a.date = $${cIdx}`; countParams.push(date); cIdx++; }
    if (cls) { countQuery += ` AND s.class = $${cIdx}`; countParams.push(cls); cIdx++; }
    if (search) { countQuery += ` AND (u.name ILIKE $${cIdx} OR u.id ILIKE $${cIdx})`; countParams.push(`%${search}%`); cIdx++; }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('Admin attendance list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// STUDENTS MANAGEMENT
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/students — List all students with filters
router.get('/students', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { class: cls, section, search } = req.query;
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

    let query = `
      SELECT u.id, u.name, u.email, u.phone, u.is_active,
             s.class, s.section, s.roll_no, s.parent_name, s.date_of_birth, s.gender
      FROM users u
      JOIN students s ON s.id = u.id
      WHERE s.school_id = $1`;
    const params = [schoolId];
    let idx = 2;

    if (cls) { query += ` AND s.class = $${idx}`; params.push(cls); idx++; }
    if (section) { query += ` AND s.section = $${idx}`; params.push(section); idx++; }
    if (search) { query += ` AND (u.name ILIKE $${idx} OR u.id ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    query += ` ORDER BY s.class, s.roll_no LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);

    // Count
    let countQuery = 'SELECT COUNT(*) FROM students s JOIN users u ON u.id = s.id WHERE s.school_id = $1';
    const countParams = [schoolId];
    let cIdx = 2;
    if (cls) { countQuery += ` AND s.class = $${cIdx}`; countParams.push(cls); cIdx++; }
    if (section) { countQuery += ` AND s.section = $${cIdx}`; countParams.push(section); cIdx++; }
    if (search) { countQuery += ` AND (u.name ILIKE $${cIdx} OR u.id ILIKE $${cIdx})`; countParams.push(`%${search}%`); cIdx++; }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('List students error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/students — Add student
router.post('/students', async (req, res) => {
  const {
    name,
    email,
    phone,
    parent_type,
    parent_mobile,
    parent_email,
    parent_aadhaar,
    occupation,
    class: cls,
    section,
    medium,
    first_language,
    previous_class,
    previous_school,
    qualified_for_promotion,
    tc_no,
    tc_date,
    parent_name,
    date_of_birth,
    gender,
    aadhaar,
    admission_date,
    state,
    district,
    mandal,
    village,
    pin,
    mother_tongue,
    nationality,
    religion,
    caste,
    vaccinated,
    conduct,
    identification_marks,
  } = req.body;
  const schoolId = req.user.school_id;
  const contactEmail = parent_email || email;
  const contactPhone = parent_mobile || phone;

  if (!name || !cls) {
    return res.status(400).json({ error: 'name and class are required' });
  }

  if (!parent_type || !parent_name || !contactPhone || !occupation) {
    return res.status(400).json({ error: 'parent_type, parent_name, parent_mobile, and occupation are required' });
  }

  if (!/^\d{10}$/.test(String(contactPhone).replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'parent_mobile must be a valid 10-digit number' });
  }

  const parentAadhaarDigits = String(parent_aadhaar || '').replace(/\D/g, '');
  if (parentAadhaarDigits.length !== 12) {
    return res.status(400).json({ error: 'Valid 12-digit parent_aadhaar is required' });
  }

  const aadhaarDigits = String(aadhaar || '').replace(/\D/g, '');
  if (aadhaarDigits.length !== 12) {
    return res.status(400).json({ error: 'Valid 12-digit aadhaar is required' });
  }

  const parsedAdmissionDate = admission_date ? new Date(admission_date) : new Date();
  if (Number.isNaN(parsedAdmissionDate.getTime())) {
    return res.status(400).json({ error: 'Invalid admission_date' });
  }
  const admissionDateISO = parsedAdmissionDate.toISOString().slice(0, 10);

  try {
    // Check if email already exists (if provided)
    if (contactEmail) {
      const existingEmail = await db.query(
        'SELECT id FROM users WHERE email = $1',
        [contactEmail]
      );
      if (existingEmail.rows.length) {
        return res.status(409).json({ error: `A user with email ${contactEmail} already exists` });
      }
    }

    // Generate a random unguessable password placeholder (user must set via email)
    const placeholder = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(placeholder, 10);

    const schoolRes = await db.query('SELECT name FROM schools WHERE id = $1', [schoolId]);
    const schoolName = schoolRes.rows[0]?.name || '';

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Lock generation scopes to avoid race conditions on concurrent admissions.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `student-id-${schoolId}-${aadhaarDigits.slice(-4)}`,
      ]);
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `admission-no-${schoolId}-${admissionDateISO}`,
      ]);

      const generatedId = await generateUniqueStudentId(client, schoolName, aadhaarDigits);
      const generatedAdmissionNo = await generateAdmissionNo(client, schoolId, admissionDateISO);
      const admissionSerialNo = parseInt(generatedAdmissionNo.slice(-3), 10);
      const admissionYear = parseInt(generatedAdmissionNo.slice(0, 4), 10);
      const admissionMonth = parseInt(generatedAdmissionNo.slice(4, 6), 10);

      const admissionDateColumnCheck = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'admission_date'
         LIMIT 1`
      );
      const hasLegacyAdmissionDateColumn = admissionDateColumnCheck.rows.length > 0;

      await client.query(
        `INSERT INTO users (id, school_id, password, role, name, email, phone, password_set)
         VALUES ($1, $2, $3, 'parent', $4, $5, $6, false)`,
        [generatedId, schoolId, hashedPassword, name, contactEmail || null, contactPhone || null]
      );

      const { rows } = hasLegacyAdmissionDateColumn
        ? await client.query(
          `INSERT INTO students (id, school_id, parent_name, class, roll_no, section, date_of_birth, gender, admission_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            generatedId,
            schoolId,
            parent_name || null,
            cls,
            generatedAdmissionNo,
            section || null,
            date_of_birth || null,
            gender || null,
            admissionDateISO,
          ]
        )
        : await client.query(
          `INSERT INTO students (id, school_id, parent_name, class, roll_no, section, date_of_birth, gender)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            generatedId,
            schoolId,
            parent_name || null,
            cls,
            generatedAdmissionNo,
            section || null,
            date_of_birth || null,
            gender || null,
          ]
        );

      // Dual-write: normalized admissions schema.
      const coreRes = await client.query(
        `INSERT INTO admission_v2.students (student_id, full_name, date_of_birth, gender)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [generatedId, name, date_of_birth, gender]
      );
      const normalizedStudentId = coreRes.rows[0].id;

      await client.query(
        `INSERT INTO admission_v2.student_academic
          (student_id, class, section, medium, first_language, previous_class, previous_school, qualified_for_promotion, tc_no, tc_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          normalizedStudentId,
          cls,
          section || null,
          medium || null,
          first_language || null,
          previous_class || null,
          previous_school || null,
          typeof qualified_for_promotion === 'string'
            ? qualified_for_promotion.toLowerCase() === 'yes'
            : (qualified_for_promotion ?? null),
          tc_no || null,
          tc_date || null,
        ]
      );

      await client.query(
        `INSERT INTO admission_v2.student_family
          (student_id, relation_type, name, mobile, email, aadhaar, occupation)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          normalizedStudentId,
          parent_type,
          parent_name,
          contactPhone,
          contactEmail || null,
          parentAadhaarDigits,
          occupation,
        ]
      );

      await client.query(
        `INSERT INTO admission_v2.student_address
          (student_id, state, district, mandal, village, pin_code)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          normalizedStudentId,
          state,
          district,
          mandal,
          village,
          pin || null,
        ]
      );

      await client.query(
        `INSERT INTO admission_v2.student_admission
          (student_id, admission_no, admission_date, admission_type, serial_no, admission_year, admission_month)
         VALUES ($1, $2, $3, 'NEW', $4, $5, $6)`,
        [
          normalizedStudentId,
          generatedAdmissionNo,
          admissionDateISO,
          admissionSerialNo,
          admissionYear,
          admissionMonth,
        ]
      );

      const markParts = String(identification_marks || '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);

      await client.query(
        `INSERT INTO admission_v2.student_additional
          (student_id, aadhaar, mother_tongue, nationality, religion, caste, vaccinated, conduct, identification_mark_1, identification_mark_2)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          normalizedStudentId,
          aadhaarDigits,
          mother_tongue || null,
          nationality || null,
          religion || null,
          caste || null,
          typeof vaccinated === 'string'
            ? vaccinated.toLowerCase() === 'yes'
            : (vaccinated ?? null),
          conduct || null,
          markParts[0] || null,
          markParts[1] || null,
        ]
      );

      await client.query('COMMIT');

      // Send setup email after successful creation
      let emailInfo = {};

      if (contactEmail) {
        emailInfo = await sendSetupLink(generatedId, contactEmail, name, schoolName);
      } else {
        // Generate link even without email so admin can share manually
        emailInfo = await sendSetupLink(generatedId, null, name, schoolName);
      }

      res.status(201).json({
        ...rows[0],
        password_setup: {
          email_sent: emailInfo.emailResult?.success || false,
          setup_link: emailInfo.setupLink,
          message: contactEmail
            ? (emailInfo.emailResult?.success
              ? `Password setup email sent to ${contactEmail}`
              : `Email failed — share this link manually with the student/parent`)
            : 'No email provided — share the setup link manually with the student/parent',
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Add student error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Generated student or admission number already exists. Please retry.' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/students/:id — Update student
router.put('/students/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, class: cls, section, roll_no, parent_name, is_active } = req.body;

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE users SET
          name = COALESCE($1, name),
          email = COALESCE($2, email),
          phone = COALESCE($3, phone),
          is_active = COALESCE($4, is_active),
          updated_at = NOW()
         WHERE id = $5`,
        [name, email, phone, is_active, id]
      );

      const { rows } = await client.query(
        `UPDATE students SET
          class = COALESCE($1, class),
          section = COALESCE($2, section),
          roll_no = COALESCE($3, roll_no),
          parent_name = COALESCE($4, parent_name)
         WHERE id = $5 RETURNING *`,
        [cls, section, roll_no, parent_name, id]
      );

      await client.query('COMMIT');

      if (!rows.length) return res.status(404).json({ error: 'Student not found' });
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Update student error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/students/:id — Remove student (soft delete)
router.delete('/students/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Student not found' });
    res.json({ success: true, message: 'Student deactivated' });
  } catch (err) {
    console.error('Delete student error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/students/bulk — CSV bulk import
router.post('/students/bulk', async (req, res) => {
  const { students } = req.body;
  // students = [{ id, name, class, section, roll_no, parent_name, email, phone }]

  if (!students?.length) {
    return res.status(400).json({ error: 'students array is required' });
  }

  const schoolId = req.user.school_id;
  const results = { success: 0, failed: 0, errors: [], setup_links: [] };

  const schoolRes = await db.query('SELECT name FROM schools WHERE id = $1', [schoolId]);
  const schoolName = schoolRes.rows[0]?.name || '';

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const s of students) {
      try {
        if (!s.id || !s.name || !s.class) {
          results.failed++;
          results.errors.push({ id: s.id, error: 'Missing required fields (id, name, class)' });
          continue;
        }

        const placeholder = crypto.randomUUID();
        const hashedPassword = await bcrypt.hash(placeholder, 10);

        await client.query(
          `INSERT INTO users (id, school_id, password, role, name, email, phone, password_set)
           VALUES ($1, $2, $3, 'parent', $4, $5, $6, false)
           ON CONFLICT (id) DO UPDATE SET name = $4, email = $5, phone = $6`,
          [s.id, schoolId, hashedPassword, s.name, s.email || null, s.phone || null]
        );

        await client.query(
          `INSERT INTO students (id, school_id, parent_name, class, roll_no, section)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET parent_name = $3, class = $4, roll_no = $5, section = $6`,
          [s.id, schoolId, s.parent_name || null, s.class, s.roll_no || null, s.section || null]
        );

        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ id: s.id, error: err.message });
      }
    }

    await client.query('COMMIT');

    // Send setup emails after commit (don't block on failures)
    for (const s of students) {
      if (s.email && !results.errors.find(e => e.id === s.id)) {
        try {
          const linkInfo = await sendSetupLink(s.id, s.email, s.name, schoolName);
          results.setup_links.push({ id: s.id, link: linkInfo.setupLink, email_sent: linkInfo.emailResult?.success });
        } catch (err) {
          // Non-critical — just log
          console.error(`Failed to send setup email for ${s.id}:`, err.message);
        }
      }
    }

    res.json(results);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk import error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════
// TEACHERS MANAGEMENT
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/teachers — List all teachers
router.get('/teachers', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;

    const { rows } = await db.query(
          `SELECT u.id,
            COALESCE(t.employee_id, u.id) AS employee_id,
            t.aadhaar,
            u.name, u.email, u.phone, u.is_active,
            t.subject, t.experience, t.qualification, t.department,
              ARRAY_AGG(tc.class) FILTER (WHERE tc.class IS NOT NULL) as classes
       FROM users u
       JOIN teachers t ON t.id = u.id
       LEFT JOIN teacher_classes tc ON tc.teacher_id = t.id
       WHERE t.school_id = $1
       GROUP BY u.id, t.id
       ORDER BY u.name
       LIMIT $2 OFFSET $3`,
      [schoolId, limit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) FROM teachers WHERE school_id = $1',
      [schoolId]
    );
    const total = parseInt(countResult.rows[0].count);

    res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('List teachers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/teachers — Add teacher
router.post('/teachers', async (req, res) => {
  const { name, email, phone, subject, experience, qualification, department, classes, aadhaar } = req.body;
  const schoolId = req.user.school_id;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const aadhaarDigits = String(aadhaar || '').replace(/\D/g, '');
  if (!/^\d{12}$/.test(aadhaarDigits)) {
    return res.status(400).json({ error: 'Aadhaar must contain 12 digits' });
  }

  try {
    // Check if email already exists (if provided)
    if (email) {
      const existingEmail = await db.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
      if (existingEmail.rows.length) {
        return res.status(409).json({ error: `A user with email ${email} already exists` });
      }
    }

    // Generate a random unguessable password placeholder (user must set via email)
    const placeholder = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(placeholder, 10);
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const generatedEmployeeId = await generateUniqueEmployeeId(client, aadhaarDigits);

      await client.query(
        `INSERT INTO users (id, school_id, password, role, name, email, phone, password_set)
         VALUES ($1, $2, $3, 'teacher', $4, $5, $6, false)`,
        [generatedEmployeeId, schoolId, hashedPassword, name, email || null, phone || null]
      );

      await client.query(
        `INSERT INTO teachers (id, school_id, employee_id, aadhaar, subject, experience, qualification, department)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          generatedEmployeeId,
          schoolId,
          generatedEmployeeId,
          aadhaarDigits,
          subject || null,
          experience || null,
          qualification || null,
          department || null,
        ]
      );

      // Assign classes
      if (classes?.length) {
        for (const cls of classes) {
          await client.query(
            'INSERT INTO teacher_classes (teacher_id, class) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [generatedEmployeeId, cls]
          );
        }
      }

      await client.query('COMMIT');

      // Send setup email after successful creation
      let emailInfo = {};
      const schoolRes = await db.query('SELECT name FROM schools WHERE id = $1', [schoolId]);
      const schoolName = schoolRes.rows[0]?.name || '';

      if (email) {
        emailInfo = await sendSetupLink(generatedEmployeeId, email, name, schoolName);
      } else {
        emailInfo = await sendSetupLink(generatedEmployeeId, null, name, schoolName);
      }

      res.status(201).json({
        id: generatedEmployeeId,
        employee_id: generatedEmployeeId,
        aadhaar: aadhaarDigits,
        name,
        subject,
        classes,
        password_setup: {
          email_sent: emailInfo.emailResult?.success || false,
          setup_link: emailInfo.setupLink,
          message: email
            ? (emailInfo.emailResult?.success
              ? `Password setup email sent to ${email}`
              : `Email failed — share this link manually with the teacher`)
            : 'No email provided — share the setup link manually with the teacher',
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Add teacher error:', err);
    if (err.code === '23505') {
      if (String(err.constraint || '').includes('aadhaar')) {
        return res.status(409).json({ error: 'Aadhaar already exists' });
      }
      return res.status(409).json({ error: 'Employee ID already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/teachers/:id — Update teacher
router.put('/teachers/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, subject, experience, qualification, department, classes, is_active } = req.body;

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE users SET
          name = COALESCE($1, name),
          email = COALESCE($2, email),
          phone = COALESCE($3, phone),
          is_active = COALESCE($4, is_active),
          updated_at = NOW()
         WHERE id = $5`,
        [name, email, phone, is_active, id]
      );

      await client.query(
        `UPDATE teachers SET
          subject = COALESCE($1, subject),
          experience = COALESCE($2, experience),
          qualification = COALESCE($3, qualification),
          department = COALESCE($4, department)
         WHERE id = $5`,
        [subject, experience, qualification, department, id]
      );

      // Update classes if provided
      if (classes) {
        await client.query('DELETE FROM teacher_classes WHERE teacher_id = $1', [id]);
        for (const cls of classes) {
          await client.query(
            'INSERT INTO teacher_classes (teacher_id, class) VALUES ($1, $2)',
            [id, cls]
          );
        }
      }

      await client.query('COMMIT');
      res.json({ success: true, id });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Update teacher error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/teachers/:id — Remove teacher (soft delete)
router.delete('/teachers/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Teacher not found' });
    res.json({ success: true, message: 'Teacher deactivated' });
  } catch (err) {
    console.error('Delete teacher error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// CLASSES
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/classes — List classes/sections
router.get('/classes', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { rows } = await db.query(
      `SELECT c.*, u.name as class_teacher_name,
       (SELECT COUNT(*) FROM students s WHERE s.class = c.name || '-' || c.section AND s.school_id = c.school_id) as student_count
       FROM classes c
       LEFT JOIN users u ON u.id = c.class_teacher_id
       WHERE c.school_id = $1
       ORDER BY c.name, c.section`,
      [schoolId]
    );
    res.json(rows);
  } catch (err) {
    console.error('List classes error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/classes — Create class
router.post('/classes', async (req, res) => {
  const { name, section, class_teacher_id, room_number, capacity } = req.body;
  const schoolId = req.user.school_id;

  if (!name) {
    return res.status(400).json({ error: 'Class name is required' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO classes (school_id, name, section, class_teacher_id, room_number, capacity)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [schoolId, name, section || null, class_teacher_id || null, room_number || null, capacity || 40]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create class error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/reports/attendance — Attendance reports
router.get('/reports/attendance', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { class: cls, start_date, end_date } = req.query;

    let query = `
      SELECT s.class, a.date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE a.status = 'present') as present,
        COUNT(*) FILTER (WHERE a.status = 'absent') as absent,
        COUNT(*) FILTER (WHERE a.status = 'late') as late
      FROM attendance a
      JOIN students s ON s.id = a.student_id
      WHERE a.school_id = $1`;
    const params = [schoolId];
    let idx = 2;

    if (cls) { query += ` AND s.class = $${idx}`; params.push(cls); idx++; }
    if (start_date) { query += ` AND a.date >= $${idx}`; params.push(start_date); idx++; }
    if (end_date) { query += ` AND a.date <= $${idx}`; params.push(end_date); idx++; }

    query += ' GROUP BY s.class, a.date ORDER BY a.date DESC, s.class';

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Attendance report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/reports/marks — Marks reports
router.get('/reports/marks', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { class: cls, subject, exam_type } = req.query;

    let query = `
      SELECT s.class, m.subject, m.exam_type,
        COUNT(*) as total_students,
        ROUND(AVG(m.marks), 1) as avg_marks,
        MAX(m.marks) as highest,
        MIN(m.marks) as lowest,
        COUNT(*) FILTER (WHERE m.marks >= (m.total_marks * 0.4)) as passed,
        COUNT(*) FILTER (WHERE m.marks < (m.total_marks * 0.4)) as failed
      FROM marks m
      JOIN students s ON s.id = m.student_id
      WHERE m.school_id = $1`;
    const params = [schoolId];
    let idx = 2;

    if (cls) { query += ` AND s.class = $${idx}`; params.push(cls); idx++; }
    if (subject) { query += ` AND m.subject = $${idx}`; params.push(subject); idx++; }
    if (exam_type) { query += ` AND m.exam_type = $${idx}`; params.push(exam_type); idx++; }

    query += ' GROUP BY s.class, m.subject, m.exam_type ORDER BY s.class, m.subject';

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Marks report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/reports/fees — Fee reports
router.get('/reports/fees', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { class: cls, status } = req.query;

    let query = `
      SELECT s.class,
        COUNT(DISTINCT f.student_id) as total_students,
        COALESCE(SUM(f.amount), 0) as total_amount,
        COALESCE(SUM(f.amount) FILTER (WHERE f.status = 'paid'), 0) as paid,
        COALESCE(SUM(f.amount) FILTER (WHERE f.status = 'due'), 0) as due,
        COALESCE(SUM(f.amount) FILTER (WHERE f.status = 'overdue'), 0) as overdue
      FROM fees f
      JOIN students s ON s.id = f.student_id
      WHERE f.school_id = $1`;
    const params = [schoolId];
    let idx = 2;

    if (cls) { query += ` AND s.class = $${idx}`; params.push(cls); idx++; }
    if (status) { query += ` AND f.status = $${idx}`; params.push(status); idx++; }

    query += ' GROUP BY s.class ORDER BY s.class';

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Fees report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// FEE STRUCTURE & REMINDERS
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/fees — Per-student fee summaries for the fees page
router.get('/fees', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { class: cls, status } = req.query;

    let query = `
      SELECT
        u.id as student_id, u.name as student_name, s.class,
        COALESCE(SUM(f.amount), 0) as total_fee,
        COALESCE(SUM(f.amount) FILTER (WHERE f.status = 'paid'), 0) as paid,
        COALESCE(SUM(f.amount) FILTER (WHERE f.status IN ('due','overdue','pending')), 0) as due,
        CASE
          WHEN SUM(f.amount) IS NULL THEN 'no_fees'
          WHEN SUM(f.amount) FILTER (WHERE f.status IN ('overdue')) > 0 THEN 'overdue'
          WHEN SUM(f.amount) FILTER (WHERE f.status IN ('due','pending')) > 0 THEN 'partial'
          ELSE 'paid'
        END as status,
        MAX(f.updated_at) FILTER (WHERE f.status = 'paid') as last_payment
      FROM students s
      JOIN users u ON u.id = s.id
      LEFT JOIN fees f ON f.student_id = s.id
      WHERE s.school_id = $1`;
    const params = [schoolId];
    let idx = 2;

    if (cls) { query += ` AND s.class = $${idx}`; params.push(cls); idx++; }

    query += ` GROUP BY u.id, u.name, s.class ORDER BY s.class, u.name`;

    const { rows } = await db.query(query, params);

    // Apply status filter after aggregation
    let filtered = rows;
    if (status && status !== 'all') {
      filtered = rows.filter(r => r.status === status);
    }

    res.json({
      data: filtered.map(r => ({
        ...r,
        total_fee: parseFloat(r.total_fee),
        paid: parseFloat(r.paid),
        due: parseFloat(r.due),
      }))
    });
  } catch (err) {
    console.error('Admin fees list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/fees/structure — Fee structure
router.get('/fees/structure', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { rows } = await db.query(
      'SELECT * FROM fee_structure WHERE school_id = $1 ORDER BY class, description',
      [schoolId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get fee structure error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/fees/structure — Set fee structure
router.post('/fees/structure', async (req, res) => {
  const { class: cls, description, amount, frequency, academic_year } = req.body;
  const schoolId = req.user.school_id;

  if (!description || !amount) {
    return res.status(400).json({ error: 'description and amount are required' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO fee_structure (school_id, class, description, amount, frequency, academic_year)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [schoolId, cls || null, description, amount, frequency || 'annually', academic_year || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Set fee structure error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/fees/remind — Send fee reminders
router.post('/fees/remind', async (req, res) => {
  const { class: cls, student_ids } = req.body;
  const schoolId = req.user.school_id;

  try {
    let query = `
      SELECT u.id, u.name, u.phone, u.email, SUM(f.amount) as due_amount
      FROM fees f
      JOIN users u ON u.id = f.student_id
      JOIN students s ON s.id = f.student_id
      WHERE f.school_id = $1 AND f.status IN ('due','overdue')`;
    const params = [schoolId];
    let idx = 2;

    if (cls) { query += ` AND s.class = $${idx}`; params.push(cls); idx++; }
    if (student_ids?.length) { query += ` AND f.student_id = ANY($${idx})`; params.push(student_ids); idx++; }

    query += ' GROUP BY u.id, u.name, u.phone, u.email';

    const { rows } = await db.query(query, params);

    // In production, trigger SMS/email notifications here
    // For now, return the list of reminders that would be sent
    res.json({
      success: true,
      reminders_sent: rows.length,
      recipients: rows.map(r => ({ id: r.id, name: r.name, due_amount: parseFloat(r.due_amount) }))
    });
  } catch (err) {
    console.error('Fee reminder error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/settings — School settings
router.get('/settings', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const hasSettingsRes = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_name = 'schools' AND column_name = 'settings'
       ) AS has_settings`
    );

    const hasSettings = hasSettingsRes.rows[0]?.has_settings === true;
    const query = hasSettings
      ? 'SELECT id, name, code, address, city, state, phone, email, logo_url, settings FROM schools WHERE id = $1'
      : `SELECT id, name, code, address, city, state, phone, email, logo_url, '{}'::jsonb AS settings
         FROM schools WHERE id = $1`;

    const { rows } = await db.query(query, [schoolId]);
    if (!rows.length) return res.status(404).json({ error: 'School not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/settings — Update settings
router.put('/settings', async (req, res) => {
  const schoolId = req.user.school_id;
  const { name, address, city, state, phone, email, logo_url, settings } = req.body;

  try {
    const hasSettingsRes = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_name = 'schools' AND column_name = 'settings'
       ) AS has_settings`
    );

    const hasSettings = hasSettingsRes.rows[0]?.has_settings === true;
    const updateSql = hasSettings
      ? `UPDATE schools SET
          name = COALESCE($1, name),
          address = COALESCE($2, address),
          city = COALESCE($3, city),
          state = COALESCE($4, state),
          phone = COALESCE($5, phone),
          email = COALESCE($6, email),
          logo_url = COALESCE($7, logo_url),
          settings = COALESCE($8, settings),
          updated_at = NOW()
         WHERE id = $9 RETURNING *`
      : `UPDATE schools SET
          name = COALESCE($1, name),
          address = COALESCE($2, address),
          city = COALESCE($3, city),
          state = COALESCE($4, state),
          phone = COALESCE($5, phone),
          email = COALESCE($6, email),
          logo_url = COALESCE($7, logo_url),
          updated_at = NOW()
         WHERE id = $8
         RETURNING id, name, code, address, city, state, phone, email, logo_url, '{}'::jsonb AS settings`;

    const params = hasSettings
      ? [name, address, city, state, phone, email, logo_url, settings ? JSON.stringify(settings) : null, schoolId]
      : [name, address, city, state, phone, email, logo_url, schoolId];

    const { rows } = await db.query(
      updateSql,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════════════
// TEACHER ATTENDANCE TRACKING (Admin view)
// ══════════════════════════════════════════════════════════════════

// GET /api/admin/teacher-attendance — View all teachers' attendance
router.get('/teacher-attendance', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { date, start_date, end_date, teacher_id } = req.query;
    const page  = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    let query = `
      SELECT ta.*, u.name as teacher_name, t.subject
      FROM teacher_attendance ta
      JOIN users u ON u.id = ta.teacher_id
      JOIN teachers t ON t.id = ta.teacher_id
      WHERE t.school_id = $1`;
    const params = [schoolId];
    let idx = 2;

    if (date) { query += ` AND ta.date = $${idx}`; params.push(date); idx++; }
    if (start_date) { query += ` AND ta.date >= $${idx}`; params.push(start_date); idx++; }
    if (end_date) { query += ` AND ta.date <= $${idx}`; params.push(end_date); idx++; }
    if (teacher_id) { query += ` AND ta.teacher_id = $${idx}`; params.push(teacher_id); idx++; }

    query += ` ORDER BY ta.date DESC, u.name LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const { rows } = await db.query(query, params);

    // Summary for today
    const today = new Date().toISOString().split('T')[0];
    const summaryRes = await db.query(
      `SELECT
        COUNT(*) as total_teachers,
        COUNT(ta.id) as marked,
        COUNT(ta.id) FILTER (WHERE ta.status = 'present') as present,
        COUNT(ta.id) FILTER (WHERE ta.status = 'leave') as on_leave,
        COUNT(ta.id) FILTER (WHERE ta.status = 'absent') as absent,
        COUNT(ta.id) FILTER (WHERE ta.status = 'half_day') as half_day
       FROM teachers t
       LEFT JOIN teacher_attendance ta ON ta.teacher_id = t.id AND ta.date = $2
       WHERE t.school_id = $1`,
      [schoolId, date || today]
    );

    res.json({
      summary: summaryRes.rows[0],
      data: rows,
      pagination: { page, limit }
    });
  } catch (err) {
    console.error('Admin teacher attendance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/teacher-attendance/report — Monthly report for all teachers
router.get('/teacher-attendance/report', async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const { rows } = await db.query(
      `SELECT u.name as teacher_name, t.id as teacher_id, t.subject,
        COUNT(ta.id) as total_days,
        COUNT(ta.id) FILTER (WHERE ta.status = 'present') as present,
        COUNT(ta.id) FILTER (WHERE ta.status = 'leave') as leaves,
        COUNT(ta.id) FILTER (WHERE ta.status = 'absent') as absent,
        COUNT(ta.id) FILTER (WHERE ta.status = 'half_day') as half_days
       FROM teachers t
       JOIN users u ON u.id = t.id
       LEFT JOIN teacher_attendance ta ON ta.teacher_id = t.id
         AND EXTRACT(MONTH FROM ta.date) = $2
         AND EXTRACT(YEAR FROM ta.date) = $3
       WHERE t.school_id = $1
       GROUP BY u.name, t.id, t.subject
       ORDER BY u.name`,
      [schoolId, month, year]
    );

    res.json({ month, year, data: rows });
  } catch (err) {
    console.error('Teacher attendance report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
