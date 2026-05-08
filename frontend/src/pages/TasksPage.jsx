import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMyTasks, getAllTasks, createTask, updateTask, getEmployees, getMyTeamTasks } from '../services/api';

export default function TasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', assigned_to: '', priority: 'medium', due_date: '' });
  const [msg, setMsg] = useState('');
  // HR no longer has task-assignment capability — only Manager/Admin can assign.
  const isManager = ['admin', 'manager'].includes(user.role);

  const fetchTasks = () => {
    if (isManager) {
      getAllTasks().then(({ data }) => setTasks(data)).catch(() => {});
    } else {
      // Employees see individual tasks AND team tasks they are a member of.
      // Both endpoints filter by the logged-in user's id (JWT identity).
      Promise.all([
        getMyTasks().then(r => r.data).catch(() => []),
        getMyTeamTasks().then(r => r.data).catch(() => []),
      ]).then(([mine, teamTasks]) => {
        const normalizedMine = mine.map(t => ({ ...t, _source: 'task', _key: `task-${t.id}` }));
        const normalizedTeam = teamTasks.map(t => ({
          id: t.id,
          _source: 'team',
          _key: `team-${t.id}`,
          title: t.title,
          description: t.description,
          assigned_by_name: t.assigned_by_name,
          priority: t.priority,
          status: t.status,
          due_date: t.deadline,
          team_name: t.team_name,
        }));
        setTasks([...normalizedMine, ...normalizedTeam]);
      });
    }
  };

  useEffect(() => {
    fetchTasks();
    if (isManager) {
      getEmployees({}).then(({ data }) => setEmployees(data)).catch(() => {});
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createTask(form);
      setMsg('Task created successfully!');
      setShowModal(false);
      setForm({ title: '', description: '', assigned_to: '', priority: 'medium', due_date: '' });
      fetchTasks();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed to create task'); }
  };

  const handleStatusUpdate = async (id, status) => {
    try {
      await updateTask(id, { status });
      setMsg(`Task marked as ${status.replace('_', ' ')}`);
      fetchTasks();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed to update task'); }
  };

  const pendingCount = tasks.filter(t => t.status === 'pending').length;
  const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;

  return (
    <div>
      {msg && (
        <div className={`att-msg ${msg.includes('success') || msg.includes('marked') ? 'success' : 'error'}`}>
          {msg}
          <button className="att-msg-close" onClick={() => setMsg('')}>✕</button>
        </div>
      )}

      {/* Task Stats */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-info"><h3>{tasks.length}</h3><p>Total Tasks</p></div>
          <div className="stat-icon blue">📝</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{pendingCount}</h3><p>Pending</p></div>
          <div className="stat-icon yellow">⏳</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{inProgressCount}</h3><p>In Progress</p></div>
          <div className="stat-icon purple">🔄</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{completedCount}</h3><p>Completed</p></div>
          <div className="stat-icon green">✅</div>
        </div>
      </div>

      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          {isManager ? 'All Tasks' : 'My Tasks'}
        </h2>
        {isManager && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Assign Task</button>}
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Title</th><th>Description</th>
              {isManager && <th>Assigned To</th>}
              <th>Assigned By</th><th>Priority</th><th>Due Date</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t._key || t.id}>
                <td>
                  <strong>{t.title}</strong>
                  {t._source === 'team' && t.team_name && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>
                      · Team: {t.team_name}
                    </span>
                  )}
                </td>
                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '-'}</td>
                {isManager && <td>{t.assigned_to_name}</td>}
                <td>{t.assigned_by_name}</td>
                <td><span className={`badge ${t.priority}`}>{t.priority}</span></td>
                <td>{t.due_date || '-'}</td>
                <td><span className={`badge ${t.status}`}>{t.status.replace('_', ' ')}</span></td>
                <td>
                  {t._source === 'team' ? (
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Track in Teams</span>
                  ) : (
                    <>
                      {t.status === 'pending' && <button className="btn btn-primary btn-sm" onClick={() => handleStatusUpdate(t.id, 'in_progress')}>Start</button>}
                      {t.status === 'in_progress' && <button className="btn btn-secondary btn-sm" onClick={() => handleStatusUpdate(t.id, 'completed')}>Complete</button>}
                      {t.status === 'completed' && <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Done</span>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tasks.length === 0 && <div className="empty-state"><h3>No tasks found</h3><p>Tasks assigned to you will appear here</p></div>}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Assign New Task</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Title *</label>
                <input value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea rows="3" value={form.description} onChange={(e) => setForm({...form, description: e.target.value})}></textarea>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Assign To *</label>
                  <select value={form.assigned_to} onChange={(e) => setForm({...form, assigned_to: e.target.value})} required>
                    <option value="">Select Employee</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.department})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Priority</label>
                  <select value={form.priority} onChange={(e) => setForm({...form, priority: e.target.value})}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Due Date</label>
                <input type="date" value={form.due_date} onChange={(e) => setForm({...form, due_date: e.target.value})} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Task</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
