import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getCandidates, addCandidate, updateCandidate, deleteCandidate, getRecruitmentStats
} from '../services/api';
import { validatePhone } from '../utils/validators';

const fieldErrorStyle = {
  color: '#ef4444',
  fontSize: 12,
  marginTop: 4,
};

const STATUS_FLOW = ['applied', 'screening', 'interviewed', 'selected', 'rejected', 'on_hold'];
// Clear colour coding: Selected=green, Rejected=red, Interviewed=blue.
// Other states use distinct, high-contrast hues so no two look alike.
const STATUS_COLORS = {
  applied: '#6366f1', screening: '#f59e0b', interviewed: '#3b82f6',
  selected: '#10b981', rejected: '#ef4444', on_hold: '#6b7280',
};
const ROW_CLASS = {
  selected: 'recruit-row-selected',
  rejected: 'recruit-row-rejected',
  interviewed: 'recruit-row-interviewed',
};

export default function RecruitmentPage() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState({ text: '', type: '' });
  const [fieldErrors, setFieldErrors] = useState({});

  const [form, setForm] = useState({
    name: '', email: '', phone: '', position_applied: '', department: '',
    experience_years: '', current_company: '', expected_salary: '',
    interview_date: '', interview_notes: '', status: 'applied', rejection_reason: '',
  });

  useEffect(() => { fetchAll(); }, [filterStatus]);

  async function fetchAll() {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      if (search) params.search = search;
      const [candRes, statsRes] = await Promise.all([
        getCandidates(params), getRecruitmentStats()
      ]);
      setCandidates(candRes.data);
      setStats(statsRes.data);
    } catch { setMsg({ text: 'Failed to load data.', type: 'error' }); }
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg({ text: '', type: '' });

    const phoneErr = validatePhone(form.phone, { required: false });
    if (phoneErr) {
      setFieldErrors({ phone: phoneErr });
      return;
    }
    setFieldErrors({});

    const payload = { ...form, phone: (form.phone ?? '').trim() };
    try {
      if (editId) {
        await updateCandidate(editId, payload);
        setMsg({ text: 'Candidate updated.', type: 'success' });
      } else {
        await addCandidate(payload);
        setMsg({ text: 'Candidate added.', type: 'success' });
      }
      resetForm();
      fetchAll();
    } catch (err) {
      setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' });
    }
  }

  async function handleStatusChange(id, newStatus) {
    try {
      await updateCandidate(id, { status: newStatus });
      fetchAll();
    } catch (err) {
      setMsg({ text: err.response?.data?.error || 'Failed.', type: 'error' });
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this candidate?')) return;
    try {
      await deleteCandidate(id);
      setMsg({ text: 'Candidate deleted.', type: 'success' });
      fetchAll();
    } catch { setMsg({ text: 'Failed to delete.', type: 'error' }); }
  }

  function startEdit(c) {
    setForm({
      name: c.name, email: c.email, phone: c.phone,
      position_applied: c.position_applied, department: c.department,
      experience_years: c.experience_years, current_company: c.current_company,
      expected_salary: c.expected_salary, interview_date: c.interview_date || '',
      interview_notes: c.interview_notes || '', status: c.status,
      rejection_reason: c.rejection_reason || '',
    });
    setEditId(c.id);
    setShowForm(true);
  }

  function resetForm() {
    setForm({ name: '', email: '', phone: '', position_applied: '', department: '',
      experience_years: '', current_company: '', expected_salary: '',
      interview_date: '', interview_notes: '', status: 'applied', rejection_reason: '' });
    setEditId(null);
    setShowForm(false);
  }

  const sty = { label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary, #555)' },
    input: { width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14, border: '1px solid var(--border, #ddd)', background: 'var(--input-bg, #fff)', color: 'var(--text, #333)', boxSizing: 'border-box' } };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Recruitment</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary, #666)', fontSize: 14 }}>Manage candidates through the hiring pipeline</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="btn btn-primary">
          {showForm ? 'Cancel' : '+ Add Candidate'}
        </button>
      </div>

      {msg.text && (
        <div className={`att-msg ${msg.type}`}>{msg.text}
          <button className="att-msg-close" onClick={() => setMsg({ text: '', type: '' })}>x</button>
        </div>
      )}

      {/* Pipeline Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
          {STATUS_FLOW.map(s => {
            const active = filterStatus === s;
            return (
              <div key={s}
                className={`recruit-pipeline-card ${active ? 'active' : ''}`}
                onClick={() => setFilterStatus(active ? '' : s)}
                style={{ borderColor: active ? STATUS_COLORS[s] : undefined }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: STATUS_COLORS[s] }}>{stats.by_status[s] || 0}</div>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'capitalize', marginTop: 2, color: 'var(--text-secondary)' }}>{s.replace('_', ' ')}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 24, marginBottom: 24,
          border: '1px solid var(--border, #e0e0e0)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h3 style={{ marginTop: 0 }}>{editId ? 'Edit Candidate' : 'Add New Candidate'}</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div><label style={sty.label}>Name *</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} style={sty.input} required /></div>
              <div><label style={sty.label}>Email *</label><input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} style={sty.input} required /></div>
              <div>
                <label style={sty.label}>Phone</label>
                <input value={form.phone} onChange={e => { setForm({...form, phone: e.target.value}); if (fieldErrors.phone) setFieldErrors({ ...fieldErrors, phone: null }); }} style={sty.input} inputMode="numeric" maxLength={10} placeholder="10-digit phone" />
                {fieldErrors.phone && <div style={fieldErrorStyle}>{fieldErrors.phone}</div>}
              </div>
              <div><label style={sty.label}>Position *</label><input value={form.position_applied} onChange={e => setForm({...form, position_applied: e.target.value})} style={sty.input} required /></div>
              <div><label style={sty.label}>Department</label><input value={form.department} onChange={e => setForm({...form, department: e.target.value})} style={sty.input} /></div>
              <div><label style={sty.label}>Experience (years)</label><input type="number" step="0.5" value={form.experience_years} onChange={e => setForm({...form, experience_years: e.target.value})} style={sty.input} /></div>
              <div><label style={sty.label}>Current Company</label><input value={form.current_company} onChange={e => setForm({...form, current_company: e.target.value})} style={sty.input} /></div>
              <div><label style={sty.label}>Expected Salary</label><input type="number" value={form.expected_salary} onChange={e => setForm({...form, expected_salary: e.target.value})} style={sty.input} /></div>
              {editId && (
                <>
                  <div><label style={sty.label}>Status</label>
                    <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} style={sty.input}>
                      {STATUS_FLOW.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  <div><label style={sty.label}>Interview Date</label><input type="date" value={form.interview_date} onChange={e => setForm({...form, interview_date: e.target.value})} style={sty.input} /></div>
                </>
              )}
            </div>
            {editId && (
              <div style={{ marginTop: 14 }}>
                <label style={sty.label}>Interview Notes</label>
                <textarea rows="3" value={form.interview_notes} onChange={e => setForm({...form, interview_notes: e.target.value})}
                  style={{ ...sty.input, resize: 'vertical' }} />
                {form.status === 'rejected' && (
                  <div style={{ marginTop: 10 }}>
                    <label style={sty.label}>Rejection Reason</label>
                    <input value={form.rejection_reason} onChange={e => setForm({...form, rejection_reason: e.target.value})} style={sty.input} />
                  </div>
                )}
              </div>
            )}
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary">{editId ? 'Update' : 'Add Candidate'}</button>
              <button type="button" className="btn btn-outline" onClick={resetForm}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Candidates Table */}
      {loading ? <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading...</div> : (
        <div style={{ background: 'var(--card-bg, #fff)', borderRadius: 12, border: '1px solid var(--border, #e0e0e0)', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border, #e0e0e0)', fontSize: 13 }}>
                <th style={thSty}>Name</th><th style={thSty}>Position</th><th style={thSty}>Dept</th>
                <th style={thSty}>Exp</th><th style={thSty}>Status</th><th style={thSty}>Interview</th><th style={thSty}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <tr key={c.id}
                  className={ROW_CLASS[c.status] || ''}
                  style={{ borderBottom: '1px solid var(--border-light, #f0f0f0)' }}>
                  <td style={tdSty}><strong>{c.name}</strong><br/><span style={{ fontSize: 12, color: '#888' }}>{c.email}</span></td>
                  <td style={tdSty}>{c.position_applied}</td>
                  <td style={tdSty}>{c.department}</td>
                  <td style={tdSty}>{c.experience_years}y</td>
                  <td style={tdSty}>
                    <span className={`recruit-status-pill ${c.status}`}>
                      {c.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={tdSty}>{c.interview_date || '—'}</td>
                  <td style={tdSty}>
                    <div className="recruit-actions">
                      <button
                        type="button"
                        onClick={() => handleStatusChange(c.id, 'interviewed')}
                        className={`recruit-btn recruit-btn-interview ${c.status === 'interviewed' ? 'is-active' : ''}`}
                        title="Mark as Interviewed">
                        Interview
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStatusChange(c.id, 'selected')}
                        className={`recruit-btn recruit-btn-select ${c.status === 'selected' ? 'is-active' : ''}`}
                        title="Mark as Selected">
                        Select
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStatusChange(c.id, 'rejected')}
                        className={`recruit-btn recruit-btn-reject ${c.status === 'rejected' ? 'is-active' : ''}`}
                        title="Mark as Rejected">
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="recruit-btn recruit-btn-edit"
                        title="Edit candidate">
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="recruit-btn recruit-btn-delete"
                        title="Delete candidate">
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {candidates.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', padding: 40, color: '#888' }}>No candidates found</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thSty = { padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary, #555)' };
const tdSty = { padding: '12px 14px', fontSize: 13.5 };
