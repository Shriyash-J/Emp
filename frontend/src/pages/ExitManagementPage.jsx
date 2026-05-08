import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getExitRecords, initiateExit, updateExitRecord, completeExit,
  getExitStats, getEmployees
} from '../services/api';

const STATUS_COLORS = { initiated: '#ff9800', in_progress: '#2196f3', completed: '#4caf50' };
const EXIT_TYPES = ['resignation', 'termination', 'retirement', 'contract_end'];

export default function ExitManagementPage() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState({ text: '', type: '' });

  const [form, setForm] = useState({
    user_id: '', resignation_date: '', last_working_date: '',
    exit_type: 'resignation', reason: '', notice_period_days: 30,
  });

  const [checklistForm, setChecklistForm] = useState({});

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [recRes, empRes, statsRes] = await Promise.all([
        getExitRecords(), getEmployees(), getExitStats()
      ]);
      setRecords(recRes.data);
      setEmployees(empRes.data);
      setStats(statsRes.data);
    } catch { setMsg({ text: 'Failed to load data.', type: 'error' }); }
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ text: '', type: '' });
    try {
      await initiateExit(form);
      setMsg({ text: 'Exit process initiated.', type: 'success' });
      setShowForm(false);
      setForm({ user_id: '', resignation_date: '', last_working_date: '', exit_type: 'resignation', reason: '', notice_period_days: 30 });
      fetchAll();
    } catch (err) {
      setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' });
    }
  }

  async function handleChecklistUpdate(recordId, field, value) {
    try {
      await updateExitRecord(recordId, { [field]: value });
      fetchAll();
    } catch (err) {
      setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' });
    }
  }

  async function handleComplete(recordId) {
    if (!window.confirm('Complete exit and deactivate employee?')) return;
    try {
      const res = await completeExit(recordId);
      setMsg({ text: res.data.message, type: 'success' });
      fetchAll();
    } catch (err) {
      setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' });
    }
  }

  // Employees who are active and don't already have an exit record
  const exitUserIds = new Set(records.map(r => r.user_id));
  const eligibleEmployees = employees.filter(e =>
    e.status !== 'inactive' && !exitUserIds.has(e.id) && e.role !== 'admin'
  );

  const sty = {
    label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary, #555)' },
    input: { width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--border, #ddd)', background: 'var(--input-bg, #fff)', color: 'var(--text, #333)', boxSizing: 'border-box' },
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Exit Management</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary, #666)', fontSize: 14 }}>Handle employee resignations and offboarding</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn btn-primary">
          {showForm ? 'Cancel' : '+ Initiate Exit'}
        </button>
      </div>

      {msg.text && (
        <div className={`att-msg ${msg.type}`}>{msg.text}
          <button className="att-msg-close" onClick={() => setMsg({ text: '', type: '' })}>x</button>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
          {Object.entries(stats.by_status).map(([s, c]) => (
            <div key={s} style={{ background: 'var(--card-bg, #fff)', borderRadius: 10, padding: '14px 12px', textAlign: 'center', border: '1px solid var(--border, #e0e0e0)' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: STATUS_COLORS[s] || '#333' }}>{c}</div>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>{s.replace('_', ' ')}</div>
            </div>
          ))}
        </div>
      )}

      {/* Initiate Exit Form */}
      {showForm && (
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 24, marginBottom: 24, border: '1px solid var(--border, #e0e0e0)' }}>
          <h3 style={{ marginTop: 0 }}>Initiate Employee Exit</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div>
                <label style={sty.label}>Employee *</label>
                <select value={form.user_id} onChange={e => setForm({...form, user_id: e.target.value})} style={sty.input} required>
                  <option value="">Select Employee</option>
                  {eligibleEmployees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.position} ({e.department})</option>)}
                </select>
              </div>
              <div>
                <label style={sty.label}>Exit Type</label>
                <select value={form.exit_type} onChange={e => setForm({...form, exit_type: e.target.value})} style={sty.input}>
                  {EXIT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div><label style={sty.label}>Resignation Date *</label><input type="date" value={form.resignation_date} onChange={e => setForm({...form, resignation_date: e.target.value})} style={sty.input} required /></div>
              <div><label style={sty.label}>Last Working Date *</label><input type="date" value={form.last_working_date} onChange={e => setForm({...form, last_working_date: e.target.value})} style={sty.input} required /></div>
              <div><label style={sty.label}>Notice Period (days)</label><input type="number" value={form.notice_period_days} onChange={e => setForm({...form, notice_period_days: e.target.value})} style={sty.input} /></div>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={sty.label}>Reason</label>
              <textarea rows="3" value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} style={{...sty.input, resize: 'vertical'}} />
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary">Initiate Exit</button>
              <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Exit Records */}
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading...</div> :
        records.length === 0 ? (
          <div className="empty-state"><h3>No exit records</h3></div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {records.map(r => (
              <div key={r.id} style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 20, border: '1px solid var(--border, #e0e0e0)' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{r.employee_name}</span>
                    <span style={{ marginLeft: 10, padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: STATUS_COLORS[r.status] + '20', color: STATUS_COLORS[r.status], textTransform: 'capitalize' }}>
                      {r.status.replace('_', ' ')}
                    </span>
                    <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                      {r.position} | {r.department} | {r.exit_type.replace('_', ' ')} | Resigned: {r.resignation_date} | Last Day: {r.last_working_date}
                    </div>
                    {r.reason && <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}><strong>Reason:</strong> {r.reason}</div>}
                  </div>
                </div>

                {/* Checklist */}
                {r.status !== 'completed' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, padding: '14px', background: 'var(--bg-secondary, #f8f9fa)', borderRadius: 8 }}>
                    {[
                      { key: 'exit_interview_done', label: 'Exit Interview' },
                      { key: 'assets_returned', label: 'Assets Returned' },
                      { key: 'final_settlement_done', label: 'Final Settlement' },
                    ].map(item => (
                      <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={r[item.key]}
                          onChange={e => handleChecklistUpdate(r.id, item.key, e.target.checked)}
                          style={{ width: 18, height: 18 }}
                        />
                        <span style={{ fontWeight: r[item.key] ? 600 : 400, color: r[item.key] ? '#4caf50' : 'var(--text, #333)' }}>
                          {item.label} {r[item.key] ? ' Done' : ''}
                        </span>
                      </label>
                    ))}

                    {/* Complete Exit button */}
                    {r.exit_interview_done && r.assets_returned && r.final_settlement_done && (
                      <button onClick={() => handleComplete(r.id)} className="btn btn-primary btn-sm" style={{ alignSelf: 'center' }}>
                        Complete Exit & Deactivate
                      </button>
                    )}
                  </div>
                )}

                {r.status === 'completed' && (
                  <div style={{ padding: '12px 14px', background: '#e8f5e9', borderRadius: 8, fontSize: 13, color: '#2e7d32', fontWeight: 600 }}>
                    Exit completed — Employee deactivated
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
