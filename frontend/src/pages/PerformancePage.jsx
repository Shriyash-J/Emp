import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getPerformanceRecords, createPerformanceReview, addHRComment,
  acknowledgeReview, getPerformanceStats, getEmployees
} from '../services/api';

const RATING_LABELS = { 1: 'Needs Improvement', 2: 'Below Expectations', 3: 'Meets Expectations', 4: 'Exceeds Expectations', 5: 'Outstanding' };
const RATING_COLORS = { 1: '#f44336', 2: '#ff9800', 3: '#2196f3', 4: '#4caf50', 5: '#1a237e' };

export default function PerformancePage() {
  const { user } = useAuth();
  const isManager = ['admin', 'manager'].includes(user?.role);
  const isHROrAdmin = ['admin', 'hr'].includes(user?.role);

  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showCommentFor, setShowCommentFor] = useState(null);
  const [msg, setMsg] = useState({ text: '', type: '' });

  const [form, setForm] = useState({
    user_id: '', review_period: '', rating: 3, goals_met: 70,
    strengths: '', improvements: '', manager_comments: '',
  });
  const [hrComment, setHrComment] = useState('');

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const promises = [getPerformanceRecords()];
      if (isManager) promises.push(getEmployees());
      if (isHROrAdmin) promises.push(getPerformanceStats());

      const results = await Promise.all(promises);
      setRecords(results[0].data);
      if (isManager && results[1]) setEmployees(results[1].data);
      if (isHROrAdmin && results[results.length - 1]) setStats(results[results.length - 1].data);
    } catch { setMsg({ text: 'Failed to load data.', type: 'error' }); }
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ text: '', type: '' });
    try {
      await createPerformanceReview(form);
      setMsg({ text: 'Performance review submitted.', type: 'success' });
      setShowForm(false);
      setForm({ user_id: '', review_period: '', rating: 3, goals_met: 70, strengths: '', improvements: '', manager_comments: '' });
      fetchAll();
    } catch (err) {
      setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' });
    }
  }

  async function handleHRComment(recordId) {
    try {
      await addHRComment(recordId, { hr_comments: hrComment, status: 'reviewed' });
      setMsg({ text: 'HR comments added.', type: 'success' });
      setShowCommentFor(null);
      setHrComment('');
      fetchAll();
    } catch (err) {
      setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' });
    }
  }

  async function handleAcknowledge(recordId) {
    try {
      await acknowledgeReview(recordId);
      setMsg({ text: 'Review acknowledged.', type: 'success' });
      fetchAll();
    } catch (err) {
      setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' });
    }
  }

  const sty = {
    label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary, #555)' },
    input: { width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--border, #ddd)', background: 'var(--input-bg, #fff)', color: 'var(--text, #333)', boxSizing: 'border-box' },
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
            {user?.role === 'employee' ? 'My Performance' : 'Performance Management'}
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary, #666)', fontSize: 14 }}>
            {isManager ? 'Submit and track employee performance reviews' : isHROrAdmin ? 'View and comment on performance records' : 'View your performance reviews'}
          </p>
        </div>
        {isManager && (
          <button onClick={() => setShowForm(!showForm)} className="btn btn-primary">
            {showForm ? 'Cancel' : '+ New Review'}
          </button>
        )}
      </div>

      {msg.text && (
        <div className={`att-msg ${msg.type}`}>{msg.text}
          <button className="att-msg-close" onClick={() => setMsg({ text: '', type: '' })}>x</button>
        </div>
      )}

      {/* Stats for HR/Admin */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
          <div className="stat-card"><div className="stat-info"><h3>{stats.total_reviews}</h3><p>Total Reviews</p></div></div>
          <div className="stat-card"><div className="stat-info"><h3>{stats.avg_rating}/5</h3><p>Avg Rating</p></div></div>
          <div className="stat-card"><div className="stat-info"><h3>{stats.avg_goals_met}%</h3><p>Avg Goals Met</p></div></div>
        </div>
      )}

      {/* Submit Review Form (Manager) */}
      {showForm && isManager && (
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 24, marginBottom: 24, border: '1px solid var(--border, #e0e0e0)' }}>
          <h3 style={{ marginTop: 0 }}>Submit Performance Review</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div>
                <label style={sty.label}>Employee *</label>
                <select value={form.user_id} onChange={e => setForm({...form, user_id: e.target.value})} style={sty.input} required>
                  <option value="">Select Employee</option>
                  {employees.filter(e => e.role === 'employee' && e.status === 'active').map(e => (
                    <option key={e.id} value={e.id}>{e.name} — {e.position}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={sty.label}>Review Period *</label>
                <input placeholder="e.g. 2026-Q1" value={form.review_period} onChange={e => setForm({...form, review_period: e.target.value})} style={sty.input} required />
              </div>
              <div>
                <label style={sty.label}>Rating (1-5) *</label>
                <select value={form.rating} onChange={e => setForm({...form, rating: Number(e.target.value)})} style={sty.input}>
                  {[1,2,3,4,5].map(r => <option key={r} value={r}>{r} — {RATING_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label style={sty.label}>Goals Met (%)</label>
                <input type="number" min="0" max="100" value={form.goals_met} onChange={e => setForm({...form, goals_met: Number(e.target.value)})} style={sty.input} />
              </div>
            </div>
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div><label style={sty.label}>Strengths</label><textarea rows="3" value={form.strengths} onChange={e => setForm({...form, strengths: e.target.value})} style={{...sty.input, resize: 'vertical'}} /></div>
              <div><label style={sty.label}>Areas for Improvement</label><textarea rows="3" value={form.improvements} onChange={e => setForm({...form, improvements: e.target.value})} style={{...sty.input, resize: 'vertical'}} /></div>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={sty.label}>Manager Comments</label>
              <textarea rows="3" value={form.manager_comments} onChange={e => setForm({...form, manager_comments: e.target.value})} style={{...sty.input, resize: 'vertical'}} />
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary">Submit Review</button>
              <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Records List */}
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading...</div> :
        records.length === 0 ? (
          <div className="empty-state"><h3>No performance records found</h3></div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {records.map(r => (
              <div key={r.id} style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 20, border: '1px solid var(--border, #e0e0e0)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{r.employee_name}</span>
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: RATING_COLORS[r.rating] + '20', color: RATING_COLORS[r.rating] }}>
                        {r.rating}/5 — {RATING_LABELS[r.rating]}
                      </span>
                      <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, background: '#e3f2fd', color: '#1565c0' }}>{r.status}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#666', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <span><strong>Period:</strong> {r.review_period}</span>
                      <span><strong>Goals:</strong> {r.goals_met}%</span>
                      <span><strong>Dept:</strong> {r.department}</span>
                      <span><strong>Reviewer:</strong> {r.reviewed_by_name}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {isHROrAdmin && r.status === 'submitted' && (
                      <button onClick={() => { setShowCommentFor(r.id); setHrComment(r.hr_comments || ''); }} className="btn btn-outline btn-sm">HR Comment</button>
                    )}
                    {user?.role === 'employee' && r.user_id === user?.id && r.status !== 'acknowledged' && (
                      <button onClick={() => handleAcknowledge(r.id)} className="btn btn-primary btn-sm">Acknowledge</button>
                    )}
                  </div>
                </div>

                {/* Expandable details */}
                {(r.strengths || r.improvements || r.manager_comments) && (
                  <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--bg-secondary, #f8f9fa)', borderRadius: 8, fontSize: 13 }}>
                    {r.strengths && <p><strong>Strengths:</strong> {r.strengths}</p>}
                    {r.improvements && <p><strong>Improvements:</strong> {r.improvements}</p>}
                    {r.manager_comments && <p><strong>Manager:</strong> {r.manager_comments}</p>}
                    {r.hr_comments && <p style={{ color: '#1565c0' }}><strong>HR Comments:</strong> {r.hr_comments}</p>}
                  </div>
                )}

                {/* HR Comment Form */}
                {showCommentFor === r.id && (
                  <div style={{ marginTop: 12, padding: 14, background: '#e3f2fd', borderRadius: 8 }}>
                    <label style={sty.label}>HR Comments</label>
                    <textarea rows="3" value={hrComment} onChange={e => setHrComment(e.target.value)} style={{...sty.input, resize: 'vertical'}} />
                    <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                      <button onClick={() => handleHRComment(r.id)} className="btn btn-primary btn-sm">Save & Mark Reviewed</button>
                      <button onClick={() => setShowCommentFor(null)} className="btn btn-outline btn-sm">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
