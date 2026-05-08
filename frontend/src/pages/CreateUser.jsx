import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { createUser } from '../services/api';
import { validatePassword, validatePhone } from '../utils/validators';

const fieldErrorStyle = {
  color: '#ef4444',
  fontSize: 12,
  marginTop: 4,
};

export default function CreateUser() {
  useEffect(() => { document.title = 'Create User | WorkNet'; }, []);
  const { user: currentUser } = useAuth();
  const isAdminInit = currentUser?.role === 'admin';
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: isAdminInit ? 'hr' : 'employee',
    department: '', position: '', phone: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  // Strict hierarchy: Admin -> HR only.  HR -> Manager, Employee only.
  const allowedRoles = isAdmin
    ? [{ value: 'hr', label: 'HR' }]
    : [{ value: 'manager', label: 'Manager' }, { value: 'employee', label: 'Employee' }];

  const defaultRole = isAdmin ? 'hr' : 'employee';

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (fieldErrors[e.target.name]) {
      setFieldErrors({ ...fieldErrors, [e.target.name]: null });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.name || !form.email || !form.role) {
      setError('Name, email, and role are required.');
      return;
    }

    const errs = {};
    errs.password = validatePassword(form.password);
    // Phone is optional on this form — validate format only if provided.
    errs.phone = validatePhone(form.phone, { required: false });
    if (Object.values(errs).some(Boolean)) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    setLoading(true);
    try {
      const { data } = await createUser({ ...form, phone: form.phone.trim() });
      setSuccess(data.message || 'User created successfully.');
      setForm({ name: '', email: '', password: '', role: defaultRole, department: '', position: '', phone: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Create New User</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
          {isAdmin ? 'Create HR accounts for your organization.' : 'Create Manager or Employee accounts.'}
        </p>
      </div>

      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '10px 14px',
          borderRadius: 'var(--radius)', fontSize: 13, marginBottom: 16,
          border: '1px solid rgba(239,68,68,0.2)',
        }}>{error}</div>
      )}

      {success && (
        <div style={{
          background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '10px 14px',
          borderRadius: 'var(--radius)', fontSize: 13, marginBottom: 16,
          border: '1px solid rgba(16,185,129,0.2)',
        }}>{success}</div>
      )}

      <form onSubmit={handleSubmit} style={{
        background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: 24,
        border: '1px solid var(--border)',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="login-field" style={{ margin: 0 }}>
            <label>Full Name *</label>
            <input type="text" name="name" value={form.name} onChange={handleChange} placeholder="Employee full name" required />
          </div>
          <div className="login-field" style={{ margin: 0 }}>
            <label>Email *</label>
            <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="user@example.com" required />
          </div>
          <div className="login-field" style={{ margin: 0 }}>
            <label>Password *</label>
            <input type="password" name="password" value={form.password} onChange={handleChange} placeholder="Temporary password (min 6 chars)" required />
            {fieldErrors.password && <div style={fieldErrorStyle}>{fieldErrors.password}</div>}
          </div>
          <div className="login-field" style={{ margin: 0 }}>
            <label>Role *</label>
            <select
              name="role" value={form.role} onChange={handleChange} required
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-primary)', fontSize: 14,
              }}
            >
              {allowedRoles.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="login-field" style={{ margin: 0 }}>
            <label>Department</label>
            <input type="text" name="department" value={form.department} onChange={handleChange} placeholder="e.g., Engineering" />
          </div>
          <div className="login-field" style={{ margin: 0 }}>
            <label>Position</label>
            <input type="text" name="position" value={form.position} onChange={handleChange} placeholder="e.g., Software Developer" />
          </div>
          <div className="login-field" style={{ margin: 0, gridColumn: '1 / -1' }}>
            <label>Phone Number</label>
            <input type="tel" name="phone" value={form.phone} onChange={handleChange} placeholder="10-digit phone number" inputMode="numeric" maxLength={10} />
            {fieldErrors.phone && <div style={fieldErrorStyle}>{fieldErrors.phone}</div>}
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
          <button type="submit" className="login-btn" disabled={loading} style={{ flex: 1 }}>
            {loading ? 'Creating...' : 'Create User'}
          </button>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 12 }}>
          The user will log in using the email and password you set here. Share the credentials securely.
        </p>
      </form>
    </div>
  );
}
