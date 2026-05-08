import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { registerUser, verifyOtp, resendOtp } from '../services/api';
import { useNavigate, Link } from 'react-router-dom';
import { validatePassword, validatePhone } from '../utils/validators';

const fieldErrorStyle = {
  color: '#ef4444',
  fontSize: 12,
  marginTop: 4,
};

export default function Register() {
  useEffect(() => { document.title = 'Register | WorkNet - Aaryak Solution'; }, []);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', phone: '' });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const { loginUser } = useAuth();
  const navigate = useNavigate();

  // OTP state
  const [otpStep, setOtpStep] = useState(false);
  const [otpEmail, setOtpEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [successMsg, setSuccessMsg] = useState('');
  const otpRefs = useRef([]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (otpStep && otpRefs.current[0]) otpRefs.current[0].focus();
  }, [otpStep]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    if (fieldErrors[e.target.name]) {
      setFieldErrors({ ...fieldErrors, [e.target.name]: null });
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    const errs = {};
    errs.password = validatePassword(form.password);
    errs.phone = validatePhone(form.phone);
    if (!errs.password && form.password !== form.confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.';
    }
    const hasError = Object.values(errs).some(Boolean);
    if (hasError) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    setLoading(true);
    try {
      const { data } = await registerUser({
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone.trim(),
      });
      if (data.requires_otp) {
        setOtpEmail(form.email);
        setOtpStep(true);
        setSuccessMsg('Account created! Please verify your email with the OTP sent.');
        setResendCooldown(30);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (value && !/^\d$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(''));
      otpRefs.current[5]?.focus();
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    const otpCode = otp.join('');
    if (otpCode.length !== 6) {
      setError('Please enter the complete 6-digit OTP.');
      return;
    }
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const { data } = await verifyOtp({ email: otpEmail, otp: otpCode, purpose: 'register' });
      loginUser(data.user, data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'OTP verification failed.');
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setError('');
    setSuccessMsg('');
    try {
      await resendOtp({ email: otpEmail, purpose: 'register' });
      setSuccessMsg('New OTP sent to your email.');
      setResendCooldown(30);
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend OTP.');
    }
  };

  // ─── OTP VERIFICATION VIEW ─────────────────────────────────
  if (otpStep) {
    return (
      <div className="login-page">
        <div className="login-branding">
          <div className="login-branding-content">
            <img src="/logo.svg" alt="WorkNet" className="login-branding-logo-img" />
            <h1>WorkNet</h1>
            <p className="login-branding-tagline">Powered by Aaryak Solution</p>
            <div className="login-branding-divider"></div>
            <p className="login-branding-desc">
              Verify your email to complete registration and access the employee management platform.
            </p>
          </div>
          <p className="login-branding-footer">&copy; 2026 Aaryak Solution. All rights reserved.</p>
        </div>

        <div className="login-form-panel">
          <div className="login-form-wrapper">
            <div className="login-form-header">
              <h2>Verify Email</h2>
              <p>Enter the 6-digit code sent to <strong>{otpEmail}</strong></p>
            </div>

            {error && <div className="login-error">{error}</div>}
            {successMsg && <div className="login-success" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13, marginBottom: 16, border: '1px solid rgba(16,185,129,0.2)' }}>{successMsg}</div>}

            <form onSubmit={handleVerifyOtp}>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => otpRefs.current[i] = el}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(i, e)}
                    onPaste={i === 0 ? handleOtpPaste : undefined}
                    style={{
                      width: 48, height: 56, textAlign: 'center', fontSize: 22, fontWeight: 700,
                      border: '2px solid var(--border)', borderRadius: 'var(--radius)',
                      background: 'var(--bg-card)', color: 'var(--text-primary)',
                      outline: 'none', transition: '.2s',
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border)'}
                  />
                ))}
              </div>
              <button type="submit" className="login-btn" disabled={loading}>
                {loading ? 'Verifying...' : 'Verify & Continue'}
              </button>
            </form>

            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <button
                onClick={handleResendOtp}
                disabled={resendCooldown > 0}
                style={{
                  fontSize: 13, color: resendCooldown > 0 ? 'var(--text-tertiary)' : 'var(--accent)',
                  background: 'none', border: 'none', cursor: resendCooldown > 0 ? 'default' : 'pointer',
                  textDecoration: resendCooldown > 0 ? 'none' : 'underline',
                }}
              >
                {resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── REGISTER VIEW ─────────────────────────────────────────
  return (
    <div className="login-page">
      <div className="login-branding">
        <div className="login-branding-content">
          <div className="login-branding-logo">W</div>
          <h1>WorkNet</h1>
          <p className="login-branding-tagline">Powered by Aaryak Solution</p>
          <div className="login-branding-divider"></div>
          <p className="login-branding-desc">
            Join the WorkNet employee platform. Create your account to get started.
          </p>
        </div>
        <p className="login-branding-footer">&copy; 2026 Aaryak Solution. All rights reserved.</p>
      </div>

      <div className="login-form-panel">
        <div className="login-form-wrapper">
          <div className="login-form-header">
            <h2>Create Account</h2>
            <p>Fill in your details to register</p>
          </div>

          {error && <div className="login-error">{error}</div>}

          <form onSubmit={handleRegister}>
            <div className="login-field">
              <label>Full Name</label>
              <input type="text" name="name" value={form.name} onChange={handleChange} placeholder="Enter your full name" required />
            </div>
            <div className="login-field">
              <label>Email Address</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="Enter your email" required />
            </div>
            <div className="login-field">
              <label>Phone Number</label>
              <input type="tel" name="phone" value={form.phone} onChange={handleChange} placeholder="Enter your phone number" inputMode="numeric" maxLength={10} />
              {fieldErrors.phone && <div style={fieldErrorStyle}>{fieldErrors.phone}</div>}
            </div>
            <div className="login-field">
              <label>Password</label>
              <input type="password" name="password" value={form.password} onChange={handleChange} placeholder="Minimum 6 characters" required />
              {fieldErrors.password && <div style={fieldErrorStyle}>{fieldErrors.password}</div>}
            </div>
            <div className="login-field">
              <label>Confirm Password</label>
              <input type="password" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} placeholder="Re-enter your password" required />
              {fieldErrors.confirmPassword && <div style={fieldErrorStyle}>{fieldErrors.confirmPassword}</div>}
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
