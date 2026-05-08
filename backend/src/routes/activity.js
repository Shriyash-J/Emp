const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get all activity logs (admin)
router.get('/', authenticateToken, authorizeRoles('admin'), (req, res) => {
  const { module, action, limit = 50, offset = 0 } = req.query;
  let query = `
    SELECT a.*, u.name as user_name, u.role as user_role
    FROM activity_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (module) { query += ' AND a.module = ?'; params.push(module); }
  if (action) { query += ' AND a.action = ?'; params.push(action); }

  query += ' ORDER BY a.timestamp DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const logs = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM activity_log').get().count;

  res.json({ logs, total });
});

// Get activity stats (admin dashboard)
router.get('/stats', authenticateToken, authorizeRoles('admin'), (req, res) => {
  const totalEmployees = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const activeEmployees = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get().count;
  const todayActivities = db.prepare("SELECT COUNT(*) as count FROM activity_log WHERE date(timestamp) = date('now')").get().count;
  const pendingLeaves = db.prepare("SELECT COUNT(*) as count FROM leave_requests WHERE status = 'pending'").get().count;
  const departments = db.prepare('SELECT DISTINCT department FROM users WHERE department != ""').all();

  const recentActivities = db.prepare(`
    SELECT a.*, u.name as user_name FROM activity_log a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.timestamp DESC LIMIT 10
  `).all();

  const departmentCounts = db.prepare(`
    SELECT department, COUNT(*) as count FROM users
    WHERE department != '' GROUP BY department ORDER BY count DESC
  `).all();

  res.json({
    totalEmployees,
    activeEmployees,
    todayActivities,
    pendingLeaves,
    departments: departments.length,
    recentActivities,
    departmentCounts
  });
});

module.exports = router;
