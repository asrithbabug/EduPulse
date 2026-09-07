const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// ── Available modules ───────────────────────────────────────────
const MODULES = [
  { id: 'attendance', name: 'Mark Attendance', description: 'Mark and view attendance' },
  { id: 'marks', name: 'Marks Entry', description: 'Enter and manage marks' },
  { id: 'homework', name: 'Homework', description: 'Assign homework' },
  { id: 'announcements', name: 'Announcements', description: 'Post announcements' },
  { id: 'materials', name: 'Materials', description: 'Upload study materials' },
  { id: 'leave', name: 'Leave Management', description: 'Approve/reject leave' },
  { id: 'chat', name: 'Chat', description: 'Message parents' },
  { id: 'class_log', name: 'Class Log', description: 'Record class activities' },
  { id: 'timetable', name: 'Timetable', description: 'View and manage timetable' },
  { id: 'reports', name: 'Reports', description: 'Generate and download reports' },
];

// GET /api/permissions/modules — List all available modules
router.get('/modules', auth, (req, res) => {
  res.json(MODULES);
});

// GET /api/permissions/:teacherId — Get teacher's permissions
router.get('/:teacherId', auth, async (req, res) => {
  try {
    const { teacherId } = req.params;

    // Verify teacher exists
    const teacherRes = await db.query(`SELECT id, name FROM teachers WHERE id = $1`, [teacherId]);
    if (!teacherRes.rows.length) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const { rows } = await db.query(
      `SELECT module_id, can_view, can_edit FROM teacher_permissions WHERE teacher_id = $1`,
      [teacherId]
    );

    // Build permission map: include all modules with defaults
    const permissions = MODULES.map(mod => {
      const perm = rows.find(r => r.module_id === mod.id);
      return {
        module_id: mod.id,
        module_name: mod.name,
        description: mod.description,
        can_view: perm ? perm.can_view : false,
        can_edit: perm ? perm.can_edit : false,
      };
    });

    res.json({
      teacher: teacherRes.rows[0],
      permissions,
    });
  } catch (err) {
    console.error('Get permissions error:', err);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// PUT /api/permissions/:teacherId — Update teacher permissions (admin only)
router.put('/:teacherId', adminAuth, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { permissions } = req.body;

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'permissions must be an array' });
    }

    // Verify teacher exists
    const teacherRes = await db.query(`SELECT id FROM teachers WHERE id = $1`, [teacherId]);
    if (!teacherRes.rows.length) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Validate module IDs
    const validModuleIds = MODULES.map(m => m.id);
    for (const perm of permissions) {
      if (!validModuleIds.includes(perm.module_id)) {
        return res.status(400).json({ error: `Invalid module: ${perm.module_id}` });
      }
    }

    // Upsert each permission
    for (const perm of permissions) {
      await db.query(
        `INSERT INTO teacher_permissions (teacher_id, module_id, can_view, can_edit, granted_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (teacher_id, module_id)
         DO UPDATE SET can_view = $3, can_edit = $4, granted_by = $5`,
        [teacherId, perm.module_id, perm.can_view ?? true, perm.can_edit ?? false, req.user.id]
      );
    }

    res.json({ message: 'Permissions updated successfully' });
  } catch (err) {
    console.error('Update permissions error:', err);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

module.exports = router;
