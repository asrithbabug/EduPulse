const router = require('express').Router();
const ExcelJS = require('exceljs');
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// Multer config — store in memory for processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
  },
});

// ── Student template columns ────────────────────────────────────
const studentColumns = [
  { header: 'ID', key: 'id', width: 15 },
  { header: 'Name', key: 'name', width: 25 },
  { header: 'Class', key: 'class', width: 10 },
  { header: 'Section', key: 'section', width: 10 },
  { header: 'Roll No', key: 'roll_no', width: 10 },
  { header: 'Parent Name', key: 'parent_name', width: 25 },
  { header: 'Email', key: 'email', width: 25 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Gender', key: 'gender', width: 10 },
  { header: 'DOB', key: 'dob', width: 15 },
];

// ── Teacher template columns ────────────────────────────────────
const teacherColumns = [
  { header: 'ID', key: 'id', width: 15 },
  { header: 'Name', key: 'name', width: 25 },
  { header: 'Subject', key: 'subject', width: 20 },
  { header: 'Department', key: 'department', width: 20 },
  { header: 'Experience', key: 'experience', width: 12 },
  { header: 'Qualification', key: 'qualification', width: 20 },
  { header: 'Email', key: 'email', width: 25 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Classes', key: 'classes', width: 30 },
];

// ── Helper: style header row ────────────────────────────────────
function styleHeaderRow(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A90D9' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;
}

// ══════════════════════════════════════════════════════════════════
// STUDENTS
// ══════════════════════════════════════════════════════════════════

// GET /api/excel/students/template — Download blank student template
router.get('/students/template', auth, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EduPulse';
    const ws = workbook.addWorksheet('Students');
    ws.columns = studentColumns;
    styleHeaderRow(ws);

    // Add a sample row
    ws.addRow({ id: 'STU001', name: 'John Doe', class: '10', section: 'A', roll_no: '1', parent_name: 'Jane Doe', email: 'john@example.com', phone: '9876543210', gender: 'Male', dob: '2008-05-15' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="student_template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Student template error:', err);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// POST /api/excel/students/import — Import students from Excel
router.post('/students/import', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const ws = workbook.getWorksheet(1);

    if (!ws || ws.rowCount < 2) {
      return res.status(400).json({ error: 'Empty or invalid spreadsheet' });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const data = {
        id: String(row.getCell(1).value || '').trim(),
        name: String(row.getCell(2).value || '').trim(),
        class: String(row.getCell(3).value || '').trim(),
        section: String(row.getCell(4).value || '').trim(),
        roll_no: String(row.getCell(5).value || '').trim(),
        parent_name: String(row.getCell(6).value || '').trim(),
        email: String(row.getCell(7).value || '').trim(),
        phone: String(row.getCell(8).value || '').trim(),
        gender: String(row.getCell(9).value || '').trim(),
        dob: row.getCell(10).value ? String(row.getCell(10).value).trim() : null,
      };

      // Validate required fields
      if (!data.id || !data.name || !data.class) {
        results.failed++;
        results.errors.push({ row: i, message: 'Missing required fields (ID, Name, Class)' });
        continue;
      }

      // Validate phone format
      if (data.phone && !/^\d{10,15}$/.test(data.phone.replace(/[+\-\s]/g, ''))) {
        results.failed++;
        results.errors.push({ row: i, message: `Invalid phone number for ${data.name}` });
        continue;
      }

      // Validate email format
      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        results.failed++;
        results.errors.push({ row: i, message: `Invalid email for ${data.name}` });
        continue;
      }

      try {
        await db.query(
          `INSERT INTO students (id, name, class, section, roll_no, parent_name, email, phone, gender, dob)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             name=$2, class=$3, section=$4, roll_no=$5, parent_name=$6, email=$7, phone=$8, gender=$9, dob=$10`,
          [data.id, data.name, data.class, data.section, data.roll_no, data.parent_name, data.email, data.phone, data.gender, data.dob]
        );
        results.success++;
      } catch (dbErr) {
        results.failed++;
        results.errors.push({ row: i, message: `DB error: ${dbErr.message}` });
      }
    }

    res.json(results);
  } catch (err) {
    console.error('Student import error:', err);
    res.status(500).json({ error: 'Failed to import students' });
  }
});

// GET /api/excel/students/export — Export all students to Excel
router.get('/students/export', auth, async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { rows } = await db.query(
      `SELECT s.id, u.name, s.class, s.section, s.roll_no, s.parent_name, u.email, u.phone, s.gender, s.date_of_birth as dob
       FROM students s JOIN users u ON u.id = s.id
       WHERE s.school_id = $1
       ORDER BY s.class, s.roll_no`,
      [schoolId]
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EduPulse';
    const ws = workbook.addWorksheet('Students');
    ws.columns = studentColumns;
    styleHeaderRow(ws);

    rows.forEach(r => {
      ws.addRow({
        id: r.id,
        name: r.name,
        class: r.class,
        section: r.section,
        roll_no: r.roll_no,
        parent_name: r.parent_name,
        email: r.email,
        phone: r.phone,
        gender: r.gender,
        dob: r.dob ? new Date(r.dob).toISOString().split('T')[0] : '',
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="students_export.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Student export error:', err);
    res.status(500).json({ error: 'Failed to export students' });
  }
});

// ══════════════════════════════════════════════════════════════════
// TEACHERS
// ══════════════════════════════════════════════════════════════════

// GET /api/excel/teachers/template — Download blank teacher template
router.get('/teachers/template', auth, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EduPulse';
    const ws = workbook.addWorksheet('Teachers');
    ws.columns = teacherColumns;
    styleHeaderRow(ws);

    // Sample row
    ws.addRow({ id: 'TCH001', name: 'Jane Smith', subject: 'Mathematics', department: 'Science', experience: '5', qualification: 'M.Sc', email: 'jane@school.com', phone: '9876543210', classes: '10-A, 10-B, 9-A' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="teacher_template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Teacher template error:', err);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// POST /api/excel/teachers/import — Import teachers from Excel
router.post('/teachers/import', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const ws = workbook.getWorksheet(1);

    if (!ws || ws.rowCount < 2) {
      return res.status(400).json({ error: 'Empty or invalid spreadsheet' });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const data = {
        id: String(row.getCell(1).value || '').trim(),
        name: String(row.getCell(2).value || '').trim(),
        subject: String(row.getCell(3).value || '').trim(),
        department: String(row.getCell(4).value || '').trim(),
        experience: String(row.getCell(5).value || '').trim(),
        qualification: String(row.getCell(6).value || '').trim(),
        email: String(row.getCell(7).value || '').trim(),
        phone: String(row.getCell(8).value || '').trim(),
        classes: String(row.getCell(9).value || '').trim(),
      };

      // Validate required fields
      if (!data.id || !data.name) {
        results.failed++;
        results.errors.push({ row: i, message: 'Missing required fields (ID, Name)' });
        continue;
      }

      // Validate email
      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        results.failed++;
        results.errors.push({ row: i, message: `Invalid email for ${data.name}` });
        continue;
      }

      try {
        await db.query(
          `INSERT INTO teachers (id, name, subject, department, experience, qualification, email, phone, classes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             name=$2, subject=$3, department=$4, experience=$5, qualification=$6, email=$7, phone=$8, classes=$9`,
          [data.id, data.name, data.subject, data.department, data.experience, data.qualification, data.email, data.phone, data.classes]
        );
        results.success++;
      } catch (dbErr) {
        results.failed++;
        results.errors.push({ row: i, message: `DB error: ${dbErr.message}` });
      }
    }

    res.json(results);
  } catch (err) {
    console.error('Teacher import error:', err);
    res.status(500).json({ error: 'Failed to import teachers' });
  }
});

// GET /api/excel/teachers/export — Export all teachers to Excel
router.get('/teachers/export', auth, async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { rows } = await db.query(
      `SELECT t.id, u.name, t.subject, t.department, t.experience, t.qualification, u.email, u.phone,
              ARRAY_TO_STRING(ARRAY_AGG(tc.class) FILTER (WHERE tc.class IS NOT NULL), ', ') as classes
       FROM teachers t
       JOIN users u ON u.id = t.id
       LEFT JOIN teacher_classes tc ON tc.teacher_id = t.id
       WHERE t.school_id = $1
       GROUP BY t.id, u.name, t.subject, t.department, t.experience, t.qualification, u.email, u.phone
       ORDER BY u.name`,
      [schoolId]
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EduPulse';
    const ws = workbook.addWorksheet('Teachers');
    ws.columns = teacherColumns;
    styleHeaderRow(ws);

    rows.forEach(r => {
      ws.addRow({
        id: r.id,
        name: r.name,
        subject: r.subject,
        department: r.department,
        experience: r.experience,
        qualification: r.qualification,
        email: r.email,
        phone: r.phone,
        classes: r.classes,
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="teachers_export.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Teacher export error:', err);
    res.status(500).json({ error: 'Failed to export teachers' });
  }
});

module.exports = router;
