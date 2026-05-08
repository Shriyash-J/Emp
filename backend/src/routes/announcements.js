const express = require('express');
const db = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Get all announcements
router.get('/', authenticateToken, (req, res) => {
  const announcements = db.prepare(`
    SELECT a.*, u.name as created_by_name FROM announcements a
    JOIN users u ON a.created_by = u.id
    ORDER BY a.created_at DESC
  `).all();
  res.json(announcements);
});

// Create announcement (admin/hr)
router.post('/', authenticateToken, authorizeRoles('admin', 'hr'), (req, res) => {
  const { title, content, priority } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content are required.' });

  db.prepare('INSERT INTO announcements (title, content, created_by, priority) VALUES (?, ?, ?, ?)').run(
    title, content, req.user.id, priority || 'normal'
  );

  db.prepare('INSERT INTO activity_log (user_id, action, description, module) VALUES (?, ?, ?, ?)').run(
    req.user.id, 'ANNOUNCEMENT', `${req.user.name} posted announcement: ${title}`, 'admin'
  );

  res.status(201).json({ message: 'Announcement posted.' });
});

module.exports = router;
