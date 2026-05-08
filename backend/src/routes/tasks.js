const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get my tasks — filter by the logged-in user's id from the JWT.
// LEFT JOIN so the task still surfaces even if the assigner row is missing.
router.get('/my', authenticateToken, (req, res) => {
  const userId = Number(req.user.id);
  const tasks = db.prepare(`
    SELECT t.*, u.name as assigned_by_name FROM tasks t
    LEFT JOIN users u ON t.assigned_by = u.id
    WHERE t.assigned_to = ? ORDER BY t.created_at DESC
  `).all(userId);
  res.json(tasks);
});

// Get all tasks (admin/hr/manager)
router.get('/', authenticateToken, authorizeRoles('admin', 'hr', 'manager'), (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, a.name as assigned_to_name, b.name as assigned_by_name
    FROM tasks t
    LEFT JOIN users a ON t.assigned_to = a.id
    LEFT JOIN users b ON t.assigned_by = b.id
    ORDER BY t.created_at DESC
  `).all();
  res.json(tasks);
});

// Create task (manager/hr/admin)
router.post('/', authenticateToken, authorizeRoles('admin', 'hr', 'manager'), (req, res) => {
  const { title, description, assigned_to, priority, due_date } = req.body;
  if (!title || !assigned_to) {
    return res.status(400).json({ error: 'Title and assigned_to are required.' });
  }

  // Coerce ids to integers — <select> submits string values, but the
  // assigned_to column is INTEGER. Matching types keeps the employee-side
  // filter (WHERE assigned_to = ?) reliable.
  const assigneeId = Number(assigned_to);
  const assignerId = Number(req.user.id);
  if (!Number.isInteger(assigneeId) || assigneeId <= 0) {
    return res.status(400).json({ error: 'assigned_to must be a valid employee id.' });
  }

  // Verify the assignee actually exists before inserting so the task never
  // becomes orphaned (and the employee can reliably fetch it on /my).
  const assignee = db.prepare('SELECT id, name FROM users WHERE id = ?').get(assigneeId);
  if (!assignee) {
    return res.status(404).json({ error: 'Assigned employee not found.' });
  }

  const result = db.prepare(
    'INSERT INTO tasks (title, description, assigned_to, assigned_by, priority, due_date) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(title, description || '', assigneeId, assignerId, priority || 'medium', due_date || null);

  db.prepare('INSERT INTO activity_log (user_id, action, description, module) VALUES (?, ?, ?, ?)').run(
    assignerId, 'ASSIGN_TASK', `Assigned task "${title}" to ${assignee.name}`, 'employee'
  );

  res.status(201).json({ id: result.lastInsertRowid, message: 'Task created.' });
});

// Update task status
router.put('/:id', authenticateToken, (req, res) => {
  const { status, title, description, priority, due_date } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  if (req.user.role === 'employee' && task.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'You can only update your own tasks.' });
  }

  db.prepare(`
    UPDATE tasks SET status = COALESCE(?, status), title = COALESCE(?, title),
    description = COALESCE(?, description), priority = COALESCE(?, priority),
    due_date = COALESCE(?, due_date), updated_at = datetime('now') WHERE id = ?
  `).run(status, title, description, priority, due_date, req.params.id);

  if (status) {
    db.prepare('INSERT INTO activity_log (user_id, action, description, module) VALUES (?, ?, ?, ?)').run(
      req.user.id, 'TASK_UPDATE', `${req.user.name} updated task "${task.title}" to ${status}`, 'employee'
    );
  }

  res.json({ message: 'Task updated.' });
});

module.exports = router;
