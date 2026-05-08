import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getLetters, createLetter, downloadLetter, emailLetter, revokeLetter,
  getLetterTemplates, getEmployees
} from '../services/api';

const LETTER_TYPE_LABELS = {
  offer: 'Offer Letter',
  experience: 'Experience Letter',
  appointment: 'Appointment Letter',
  relieving: 'Relieving Letter',
};

const STATUS_COLORS = {
  issued: '#4caf50',
  draft: '#ff9800',
  revoked: '#f44336',
};

export default function LettersPage() {
  const { user } = useAuth();
  const isHROrAdmin = ['admin', 'hr'].includes(user?.role);

  const [letters, setLetters] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [templates, setTemplates] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [emailingId, setEmailingId] = useState(null);

  // Form state
  const [form, setForm] = useState({
    user_id: '',
    letter_type: 'offer',
    issued_date: new Date().toISOString().split('T')[0],
    letter_data: {},
  });

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [lettersRes] = await Promise.all([
        getLetters(filterType ? { type: filterType } : {}),
      ]);
      setLetters(lettersRes.data);

      if (isHROrAdmin) {
        const [empRes, tplRes] = await Promise.all([
          getEmployees(),
          getLetterTemplates(),
        ]);
        setEmployees(empRes.data);
        setTemplates(tplRes.data);
      }
    } catch (err) {
      setError('Failed to load data.');
    }
    setLoading(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.user_id) {
      setError('Please select an employee.');
      return;
    }

    try {
      const res = await createLetter(form);
      setSuccess(res.data.message);
      setShowForm(false);
      setForm({ user_id: '', letter_type: 'offer', issued_date: new Date().toISOString().split('T')[0], letter_data: {} });
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create letter.');
    }
  }

  async function handleDownload(letterId, letterType, empName) {
    try {
      const res = await downloadLetter(letterId);
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${letterType}_letter_${empName.replace(/\s+/g, '_')}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to download letter.');
    }
  }

  async function handleEmail(letterId) {
    setError('');
    setSuccess('');
    setEmailingId(letterId);
    try {
      const res = await emailLetter(letterId);
      setSuccess(res.data.message || 'Letter emailed successfully.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send email.');
    } finally {
      setEmailingId(null);
    }
  }

  async function handleRevoke(letterId) {
    if (!window.confirm('Are you sure you want to revoke this letter?')) return;
    try {
      await revokeLetter(letterId);
      setSuccess('Letter revoked successfully.');
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to revoke letter.');
    }
  }

  function handleFormFieldChange(field, value) {
    setForm(prev => ({
      ...prev,
      letter_data: { ...prev.letter_data, [field]: value }
    }));
  }

  // Get selected employee info to auto-fill
  const selectedEmployee = employees.find(e => e.id === Number(form.user_id));

  const filteredLetters = filterType
    ? letters.filter(l => l.letter_type === filterType)
    : letters;

  return (
    <div style={{ padding: '0' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
            {isHROrAdmin ? 'Letter Management' : 'My Letters'}
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary, #666)', fontSize: 14 }}>
            {isHROrAdmin
              ? 'Generate and manage official letters for employees'
              : 'View and download your official letters'}
          </p>
        </div>
        {isHROrAdmin && (
          <button
            onClick={() => setShowForm(!showForm)}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: 'var(--primary, #1a237e)', color: '#fff',
              fontWeight: 600, cursor: 'pointer', fontSize: 14,
            }}
          >
            {showForm ? 'Cancel' : '+ Issue Letter'}
          </button>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#ffebee', color: '#c62828', marginBottom: 16, fontSize: 14 }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>x</button>
        </div>
      )}
      {success && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: '#e8f5e9', color: '#2e7d32', marginBottom: 16, fontSize: 14 }}>
          {success}
          <button onClick={() => setSuccess('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>x</button>
        </div>
      )}

      {/* Issue Letter Form */}
      {showForm && isHROrAdmin && (
        <div style={{
          background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 24,
          marginBottom: 24, border: '1px solid var(--border, #e0e0e0)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <h3 style={{ marginTop: 0, fontSize: 18, fontWeight: 600 }}>Issue New Letter</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
              {/* Employee Select */}
              <div>
                <label style={labelStyle}>Employee *</label>
                <select
                  value={form.user_id}
                  onChange={e => setForm({ ...form, user_id: e.target.value })}
                  style={inputStyle}
                  required
                >
                  <option value="">Select Employee</option>
                  {employees.filter(e => e.role === 'employee' || e.role === 'manager').map(e => (
                    <option key={e.id} value={e.id}>{e.name} — {e.position} ({e.department})</option>
                  ))}
                </select>
              </div>

              {/* Letter Type */}
              <div>
                <label style={labelStyle}>Letter Type *</label>
                <select
                  value={form.letter_type}
                  onChange={e => setForm({ ...form, letter_type: e.target.value, letter_data: {} })}
                  style={inputStyle}
                >
                  <option value="offer">Offer Letter</option>
                  <option value="experience">Experience Letter</option>
                  <option value="appointment">Appointment Letter</option>
                  <option value="relieving">Relieving Letter</option>
                </select>
              </div>

              {/* Issue Date */}
              <div>
                <label style={labelStyle}>Issue Date</label>
                <input
                  type="date"
                  value={form.issued_date}
                  onChange={e => setForm({ ...form, issued_date: e.target.value })}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Dynamic fields based on letter type */}
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
              {form.letter_type === 'offer' && (
                <>
                  <div>
                    <label style={labelStyle}>Salary (Annual CTC)</label>
                    <input
                      type="text"
                      placeholder={selectedEmployee ? 'Auto-filled from payroll config' : 'e.g. 12,00,000'}
                      value={form.letter_data.salary || ''}
                      onChange={e => handleFormFieldChange('salary', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Joining Date</label>
                    <input
                      type="date"
                      value={form.letter_data.joining_date || ''}
                      onChange={e => handleFormFieldChange('joining_date', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </>
              )}

              {form.letter_type === 'experience' && (
                <>
                  <div>
                    <label style={labelStyle}>Last Working Date *</label>
                    <input
                      type="date"
                      value={form.letter_data.last_working_date || ''}
                      onChange={e => handleFormFieldChange('last_working_date', e.target.value)}
                      style={inputStyle}
                      required
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Duration</label>
                    <input
                      type="text"
                      placeholder="e.g. 2 years 3 months"
                      value={form.letter_data.duration || ''}
                      onChange={e => handleFormFieldChange('duration', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </>
              )}

              {form.letter_type === 'relieving' && (
                <>
                  <div>
                    <label style={labelStyle}>Resignation Date *</label>
                    <input
                      type="date"
                      value={form.letter_data.resignation_date || ''}
                      onChange={e => handleFormFieldChange('resignation_date', e.target.value)}
                      style={inputStyle}
                      required
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Last Working Date *</label>
                    <input
                      type="date"
                      value={form.letter_data.last_working_date || ''}
                      onChange={e => handleFormFieldChange('last_working_date', e.target.value)}
                      style={inputStyle}
                      required
                    />
                  </div>
                </>
              )}

              {form.letter_type === 'appointment' && (
                <>
                  <div>
                    <label style={labelStyle}>Salary (Monthly Gross)</label>
                    <input
                      type="text"
                      placeholder={selectedEmployee ? 'Auto-filled from payroll config' : 'e.g. 1,00,000'}
                      value={form.letter_data.salary || ''}
                      onChange={e => handleFormFieldChange('salary', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Reporting Manager</label>
                    <input
                      type="text"
                      placeholder="Manager name"
                      value={form.letter_data.reporting_manager || ''}
                      onChange={e => handleFormFieldChange('reporting_manager', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Joining Date</label>
                    <input
                      type="date"
                      value={form.letter_data.joining_date || ''}
                      onChange={e => handleFormFieldChange('joining_date', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </>
              )}
            </div>

            <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
              <button type="submit" style={{
                padding: '10px 24px', borderRadius: 8, border: 'none',
                background: 'var(--primary, #1a237e)', color: '#fff',
                fontWeight: 600, cursor: 'pointer', fontSize: 14,
              }}>
                Generate & Issue Letter
              </button>
              <button type="button" onClick={() => setShowForm(false)} style={{
                padding: '10px 24px', borderRadius: 8, border: '1px solid var(--border, #ccc)',
                background: 'transparent', cursor: 'pointer', fontSize: 14,
              }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {['', 'offer', 'experience', 'appointment', 'relieving'].map(type => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            style={{
              padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              border: filterType === type ? '2px solid var(--primary, #1a237e)' : '1px solid var(--border, #ddd)',
              background: filterType === type ? 'var(--primary, #1a237e)' : 'transparent',
              color: filterType === type ? '#fff' : 'var(--text, #333)',
              cursor: 'pointer',
            }}
          >
            {type ? LETTER_TYPE_LABELS[type] : 'All Letters'}
          </button>
        ))}
      </div>

      {/* Letters List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading...</div>
      ) : filteredLetters.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 60,
          background: 'var(--card-bg, #fff)', borderRadius: 12,
          border: '1px solid var(--border, #e0e0e0)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
          <h3 style={{ margin: '0 0 8px', fontWeight: 600 }}>No Letters Found</h3>
          <p style={{ color: '#888', fontSize: 14 }}>
            {isHROrAdmin ? 'Click "Issue Letter" to generate a new letter.' : 'No letters have been issued to you yet.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filteredLetters.map(letter => (
            <div key={letter.id} style={{
              background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 20,
              border: '1px solid var(--border, #e0e0e0)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              flexWrap: 'wrap', gap: 12,
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>
                    {letter.letter_type === 'offer' ? '📋' : letter.letter_type === 'experience' ? '📜' : letter.letter_type === 'relieving' ? '🔓' : '📝'}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{letter.title}</span>
                  <span style={{
                    padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                    background: STATUS_COLORS[letter.status] + '20',
                    color: STATUS_COLORS[letter.status],
                    textTransform: 'uppercase',
                  }}>
                    {letter.status}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary, #666)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {isHROrAdmin && <span><strong>Employee:</strong> {letter.employee_name}</span>}
                  <span><strong>Department:</strong> {letter.department}</span>
                  <span><strong>Position:</strong> {letter.position}</span>
                  <span><strong>Issued:</strong> {letter.issued_date}</span>
                  {letter.issued_by_name && <span><strong>By:</strong> {letter.issued_by_name}</span>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {letter.status === 'issued' && (
                  <button
                    onClick={() => handleDownload(letter.id, letter.letter_type, letter.employee_name)}
                    style={{
                      padding: '8px 16px', borderRadius: 8, border: 'none',
                      background: '#4caf50', color: '#fff', fontWeight: 600,
                      cursor: 'pointer', fontSize: 13,
                    }}
                  >
                    Download PDF
                  </button>
                )}
                {isHROrAdmin && letter.status === 'issued' && (
                  <button
                    onClick={() => handleEmail(letter.id)}
                    disabled={emailingId === letter.id}
                    style={{
                      padding: '8px 16px', borderRadius: 8, border: 'none',
                      background: '#1976d2', color: '#fff', fontWeight: 600,
                      cursor: emailingId === letter.id ? 'not-allowed' : 'pointer',
                      opacity: emailingId === letter.id ? 0.7 : 1,
                      fontSize: 13,
                    }}
                  >
                    {emailingId === letter.id ? 'Sending…' : 'Send Email'}
                  </button>
                )}
                {isHROrAdmin && letter.status === 'issued' && (
                  <button
                    onClick={() => handleRevoke(letter.id)}
                    style={{
                      padding: '8px 16px', borderRadius: 8,
                      border: '1px solid #f44336', background: 'transparent',
                      color: '#f44336', fontWeight: 600, cursor: 'pointer', fontSize: 13,
                    }}
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stats Summary for HR/Admin */}
      {isHROrAdmin && letters.length > 0 && (
        <div style={{
          marginTop: 24, display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
        }}>
          {Object.entries(LETTER_TYPE_LABELS).map(([type, label]) => {
            const count = letters.filter(l => l.letter_type === type).length;
            const issued = letters.filter(l => l.letter_type === type && l.status === 'issued').length;
            return (
              <div key={type} style={{
                background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 16,
                border: '1px solid var(--border, #e0e0e0)', textAlign: 'center',
              }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary, #1a237e)' }}>{count}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{label}s</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{issued} active</div>
              </div>
            );
          })}
          <div style={{
            background: 'var(--card-bg, #fff)', borderRadius: 12, padding: 16,
            border: '1px solid var(--border, #e0e0e0)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#f44336' }}>
              {letters.filter(l => l.status === 'revoked').length}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Revoked</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Total revoked</div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 13, fontWeight: 600,
  marginBottom: 4, color: 'var(--text-secondary, #555)',
};

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14,
  border: '1px solid var(--border, #ddd)', background: 'var(--input-bg, #fff)',
  color: 'var(--text, #333)', boxSizing: 'border-box',
};
