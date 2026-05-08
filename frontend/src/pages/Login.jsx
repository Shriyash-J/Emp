import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { login, verifyOtp, resendOtp, getAdminSetupStatus } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { validatePassword } from '../utils/validators';

const fieldErrorStyle = {
  color: '#ef4444',
  fontSize: 12,
  marginTop: 4,
};

export default function Login() {
  const { loginUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => { document.title = 'Login | WorkNet - Aaryak Solution'; }, []);

  // Redirect to admin setup if no admin exists
  useEffect(() => {
    getAdminSetupStatus()
      .then(({ data }) => {
        if (!data.admin_exists) navigate('/admin-setup', { replace: true });
      })
      .catch(() => { /* server offline — stay on login */ });
  }, [navigate]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);

  // OTP state
  const [otpStep, setOtpStep] = useState(false);
  const [otpEmail, setOtpEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [successMsg, setSuccessMsg] = useState('');
  const otpRefs = useRef([]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Focus first OTP input when OTP step activates
  useEffect(() => {
    if (otpStep && otpRefs.current[0]) {
      otpRefs.current[0].focus();
    }
  }, [otpStep]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    const pwErr = validatePassword(password);
    if (pwErr) {
      setFieldErrors({ password: pwErr });
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      const { data } = await login({ email, password });
      if (data.requires_otp) {
        setOtpEmail(data.email);
        setOtpStep(true);
        setSuccessMsg('OTP sent to your email address.');
        setResendCooldown(30);
      } else {
        loginUser(data.user, data.token);
        navigate(data.redirect || `/${data.user?.role}/dashboard`);
      }
    } catch (err) {
      const serverError = err.response?.data?.error;
      if (!err.response || err.code === 'ERR_NETWORK') {
        setError('Cannot connect to server. Make sure the backend is running.');
      } else if (err.response?.status >= 500 || (!serverError && err.response?.status !== 401)) {
        setError('Cannot connect to server. Make sure the backend is running.');
      } else {
        setError(serverError || 'Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (value && !/^\d$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
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
      const { data } = await verifyOtp({ email: otpEmail, otp: otpCode, purpose: 'login' });
      loginUser(data.user, data.token);
      navigate(data.redirect || `/${data.user?.role}/dashboard`);
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
      await resendOtp({ email: otpEmail, purpose: 'login' });
      setSuccessMsg('New OTP sent to your email.');
      setResendCooldown(30);
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend OTP.');
    }
  };

  const handleBackToLogin = () => {
    setOtpStep(false);
    setOtp(['', '', '', '', '', '']);
    setError('');
    setSuccessMsg('');
    setOtpEmail('');
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
              Streamline your workforce management with our comprehensive employee management platform.
            </p>
          </div>
          <p className="login-branding-footer">&copy; 2026 Aaryak Solution. All rights reserved.</p>
        </div>

        <div className="login-form-panel">
          <div className="login-form-wrapper">
            <div className="login-form-header">
              <h2>Verify OTP</h2>
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
                {loading ? 'Verifying...' : 'Verify & Sign In'}
              </button>
            </form>

            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <button
                className="login-link-btn"
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

            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <button
                className="login-link-btn"
                onClick={handleBackToLogin}
                style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                &larr; Back to login
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── LOGIN VIEW ────────────────────────────────────────────
  return (
    <div className="login-page">
      <div className="login-branding">
        <div className="login-branding-content">
          <div className="login-branding-logo">W</div>
          <h1>WorkNet</h1>
          <p className="login-branding-tagline">Powered by Aaryak Solution</p>
          <div className="login-branding-divider"></div>
          <p className="login-branding-desc">
            Your corporate workspace for workforce management. Sign in to access your dashboard.
          </p>
        </div>
        <p className="login-branding-footer">&copy; 2026 Aaryak Solution. All rights reserved.</p>
      </div>

      <div className="login-form-panel">
        <div className="login-form-wrapper">
          <div className="login-form-header">
            <h2>Welcome to WorkNet</h2>
            <p>Sign in to your account to continue</p>
          </div>

          {error && <div className="login-error">{error}</div>}

          <form onSubmit={handleLogin}>
            <div className="login-field">
              <label>Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter your email" required />
            </div>
            <div className="login-field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: null }); }} placeholder="Enter your password" required />
              {fieldErrors.password && <div style={fieldErrorStyle}>{fieldErrors.password}</div>}
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          <div style={{ marginTop: 20, textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>
            Contact your administrator to get an account.
          </div>
        </div>
      </div>
    </div>
  );
}
