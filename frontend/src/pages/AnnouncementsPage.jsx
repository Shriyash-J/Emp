import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getAnnouncements, createAnnouncement } from '../services/api';

export default function AnnouncementsPage() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', priority: 'normal', target_audience: 'all' });
  const [msg, setMsg] = useState('');
  const canCreate = ['admin', 'hr'].includes(user.role);

  useEffect(() => {
    getAnnouncements().then(({ data }) => setAnnouncements(data)).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createAnnouncement(form);
      setMsg('Announcement posted!');
      setShowModal(false);
      setForm({ title: '', content: '', priority: 'normal', target_audience: 'all' });
      getAnnouncements().then(({ data }) => setAnnouncements(data));
    } catch (err) { setMsg(err.response?.data?.error || 'Failed'); }
  };

  return (
    <div>
      {msg && (
        <div className={`att-msg ${msg.includes('posted') ? 'success' : 'error'}`}>
          {msg}
          <button className="att-msg-close" onClick={() => setMsg('')}>✕</button>
        </div>
      )}

      {canCreate && (
        <div style={{ marginBottom: 20 }}>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Announcement</button>
        </div>
      )}

      {announcements.map((a) => (
        <div key={a.id} className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div>
              <h2>{a.title}</h2>
              <small style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>By {a.created_by_name} &middot; {new Date(a.created_at).toLocaleDateString()}</small>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {a.target_audience && a.target_audience !== 'all' && (
                <span className="badge" style={{ background: '#e3f2fd', color: '#1565c0', fontSize: 11 }}>
                  {a.target_audience.toUpperCase()} only
                </span>
              )}
              <span className={`badge ${a.priority}`}>{a.priority}</span>
            </div>
          </div>
          <div className="card-body">
            <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-secondary)' }}>{a.content}</p>
          </div>
        </div>
      ))}

      {announcements.length === 0 && <div className="empty-state"><h3>No announcements yet</h3></div>}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New Announcement</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Title *</label>
                <input value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Content *</label>
                <textarea rows="5" value={form.content} onChange={(e) => setForm({...form, content: e.target.value})} required></textarea>
              </div>
              <div className="form-group">
                <label>Priority</label>
                <select value={form.priority} onChange={(e) => setForm({...form, priority: e.target.value})}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="form-group">
                <label>Visible To</label>
                <select value={form.target_audience} onChange={(e) => setForm({...form, target_audience: e.target.value})}>
                  <option value="all">All Roles</option>
                  <option value="admin">Admin Only</option>
                  <option value="hr">HR Only</option>
                  <option value="manager">Managers Only</option>
                  <option value="employee">Employees Only</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Post Announcement</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
