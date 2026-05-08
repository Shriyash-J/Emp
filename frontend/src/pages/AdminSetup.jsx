import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { adminSetup } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { validatePhone } from '../utils/validators';

const fieldErrorStyle = {
  color: '#ef4444',
  fontSize: 12,
  marginTop: 4,
};

export default function AdminSetup() {
  useEffect(() => { document.title = 'Admin Setup | WorkNet - Aaryak Solution'; }, []);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', phone: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const { loginUser } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (fieldErrors[e.target.name]) {
      setFieldErrors({ ...fieldErrors, [e.target.name]: null });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const errs = {};
    if (!form.password) {
      errs.password = 'Password is required.';
    } else if (form.password.length < 8) {
      errs.password = 'Password must be at least 8 characters.';
    }
    if (!errs.password && form.password !== form.confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.';
    }
    errs.phone = validatePhone(form.phone);
    if (Object.values(errs).some(Boolean)) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    setLoading(true);
    try {
      const { data } = await adminSetup({
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone.trim(),
      });
      loginUser(data.user, data.token);
      navigate(data.redirect || '/admin/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Setup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-branding">
        <div className="login-branding-content">
          <div className="login-branding-logo">W</div>
          <h1>WorkNet</h1>
          <p className="login-branding-tagline">Powered by Aaryak Solution</p>
          <div className="login-branding-divider"></div>
          <p className="login-branding-desc">
            Welcome! No admin account exists yet. Set up the first administrator to get started.
          </p>
        </div>
        <p className="login-branding-footer">&copy; 2026 Aaryak Solution. All rights reserved.</p>
      </div>

      <div className="login-form-panel">
        <div className="login-form-wrapper">
          <div className="login-form-header">
            <h2>First-Time Admin Setup</h2>
            <p>Create the initial administrator account</p>
          </div>

          {error && <div className="login-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="login-field">
              <label>Full Name</label>
              <input type="text" name="name" value={form.name} onChange={handleChange} placeholder="Enter admin name" required />
            </div>
            <div className="login-field">
              <label>Email Address</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="Enter admin email" required />
            </div>
            <div className="login-field">
              <label>Phone Number</label>
              <input type="tel" name="phone" value={form.phone} onChange={handleChange} placeholder="Enter phone number" inputMode="numeric" maxLength={10} />
              {fieldErrors.phone && <div style={fieldErrorStyle}>{fieldErrors.phone}</div>}
            </div>
            <div className="login-field">
              <label>Password</label>
              <input type="password" name="password" value={form.password} onChange={handleChange} placeholder="Min 8 chars, uppercase, lowercase, digit, special" required />
              {fieldErrors.password && <div style={fieldErrorStyle}>{fieldErrors.password}</div>}
            </div>
            <div className="login-field">
              <label>Confirm Password</label>
              <input type="password" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} placeholder="Re-enter your password" required />
              {fieldErrors.confirmPassword && <div style={fieldErrorStyle}>{fieldErrors.confirmPassword}</div>}
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Setting Up...' : 'Create Admin Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
