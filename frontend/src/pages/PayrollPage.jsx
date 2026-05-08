import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getPayrollRecords, getPayrollSlip, generatePayroll, updatePayrollStatus,
  getPayrollConfigs, setPayrollConfig, getHolidays, createHoliday, deleteHoliday,
  getMyPayrollConfig, getEmployees, createPaymentOrder, verifyPayment, markPaymentFailed,
} from '../services/api';

export default function PayrollPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'hr';

  return isAdmin ? <AdminPayrollView /> : <EmployeePayrollView />;
}

// ═══════════════════════════════════════════════════════════════
// ADMIN / HR VIEW
// ═══════════════════════════════════════════════════════════════
function AdminPayrollView() {
  const { user } = useAuth();
  const [tab, setTab] = useState('records');
  const [records, setRecords] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [slip, setSlip] = useState(null);

  // Config form
  const [configForm, setConfigForm] = useState(null);

  // Holiday form
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '', holiday_type: 'company', user_id: '' });

  useEffect(() => {
    loadData();
  }, [tab, month]);

  const loadData = () => {
    if (tab === 'records') {
      getPayrollRecords({ month }).then(({ data }) => setRecords(data)).catch(() => {});
    } else if (tab === 'config') {
      getPayrollConfigs().then(({ data }) => setConfigs(data)).catch(() => {});
      getEmployees().then(({ data }) => setEmployees(data)).catch(() => {});
    } else if (tab === 'holidays') {
      getHolidays().then(({ data }) => setHolidays(data)).catch(() => {});
      getEmployees().then(({ data }) => setEmployees(data)).catch(() => {});
    }
  };

  const handleGenerate = async () => {
    setLoading(true); setMsg(''); setError('');
    try {
      const { data } = await generatePayroll({ month });
      setMsg(`${data.message}${data.skipped?.length ? ` Skipped: ${data.skipped.join(', ')}` : ''}`);
      getPayrollRecords({ month }).then(({ data }) => setRecords(data));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate payroll.');
    } finally {
      setLoading(false);
    }
  };

  const handleViewSlip = async (payrollId) => {
    try {
      const { data } = await getPayrollSlip(payrollId);
      setSlip(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load salary slip.');
    }
  };

  const handleStatusUpdate = async (payrollId, status) => {
    try {
      await updatePayrollStatus(payrollId, { status });
      setMsg(`Payroll ${status}.`);
      getPayrollRecords({ month }).then(({ data }) => setRecords(data));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update status.');
    }
  };

  const handlePaySalary = async (payrollId) => {
    setMsg(''); setError('');
    try {
      const { data } = await createPaymentOrder(payrollId);
      // Load Razorpay checkout script if not already loaded
      if (!window.Razorpay) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
          document.head.appendChild(script);
        });
      }

      const options = {
        key: data.key_id,
        amount: data.amount,
        currency: data.currency,
        name: 'Aaryak Solution',
        description: data.description,
        order_id: data.order_id,
        prefill: {
          name: data.employee_name,
          email: data.employee_email,
        },
        theme: { color: '#6366f1' },
        handler: async (response) => {
          // Payment successful — verify on backend
          try {
            await verifyPayment(payrollId, {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            setMsg('Payment successful! Salary marked as Paid.');
            getPayrollRecords({ month }).then(({ data }) => setRecords(data));
          } catch (err) {
            setError(err.response?.data?.error || 'Payment verification failed.');
          }
        },
        modal: {
          ondismiss: async () => {
            await markPaymentFailed(payrollId).catch(() => {});
            setError('Payment was cancelled.');
            getPayrollRecords({ month }).then(({ data }) => setRecords(data));
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', async (response) => {
        await markPaymentFailed(payrollId).catch(() => {});
        setError(`Payment failed: ${response.error?.description || 'Unknown error'}`);
        getPayrollRecords({ month }).then(({ data }) => setRecords(data));
      });
      rzp.open();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to initiate payment.');
    }
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault(); setMsg(''); setError('');
    try {
      await setPayrollConfig(configForm.user_id, configForm);
      setMsg('Salary configuration saved.');
      setConfigForm(null);
      getPayrollConfigs().then(({ data }) => setConfigs(data));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save config.');
    }
  };

  const handleCreateHoliday = async (e) => {
    e.preventDefault(); setMsg(''); setError('');
    try {
      await createHoliday({ ...holidayForm, user_id: holidayForm.user_id || null });
      setMsg('Holiday created.');
      setHolidayForm({ date: '', name: '', holiday_type: 'company', user_id: '' });
      getHolidays().then(({ data }) => setHolidays(data));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create holiday.');
    }
  };

  const handleDeleteHoliday = async (id) => {
    try {
      await deleteHoliday(id);
      setHolidays(holidays.filter(h => h.id !== id));
      setMsg('Holiday deleted.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete holiday.');
    }
  };

  const openConfigForm = (emp) => {
    const existing = configs.find(c => c.user_id === emp.id);
    setConfigForm({
      user_id: emp.id,
      employee_name: emp.name,
      basic_salary: existing?.basic_salary || 0,
      hra: existing?.hra || 0,
      da: existing?.da || 0,
      ta: existing?.ta || 0,
      pf_deduction: existing?.pf_deduction || 0,
      tax_deduction: existing?.tax_deduction || 0,
      other_deductions: existing?.other_deductions || 0,
    });
  };

  // ─── Salary Slip Modal ─────────────────────────────────
  if (slip) return <SalarySlipView slip={slip} onClose={() => setSlip(null)} />;

  return (
    <div>
      {msg && <div className="login-success" style={{ marginBottom: 16, background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '10px 14px', borderRadius: 8, fontSize: 13, border: '1px solid rgba(16,185,129,0.2)', display: 'flex', justifyContent: 'space-between' }}>{msg}<button onClick={() => setMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>X</button></div>}
      {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}<button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>X</button></div>}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['records', 'config', 'holidays'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`btn ${tab === t ? 'btn-primary' : 'btn-secondary'}`}
            style={{ textTransform: 'capitalize' }}
          >{t === 'config' ? 'Salary Config' : t === 'records' ? 'Payroll Records' : 'Holidays'}</button>
        ))}
      </div>

      {/* ─── PAYROLL RECORDS TAB ─── */}
      {tab === 'records' && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <h2>Payroll Records</h2>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
              <button className="btn btn-primary" onClick={handleGenerate} disabled={loading}>
                {loading ? 'Generating...' : 'Generate Payroll'}
              </button>
            </div>
          </div>
          <div className="card-body">
            {records.length === 0 ? (
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: 20, textAlign: 'center' }}>No payroll records for this month. Click "Generate Payroll" to create them.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Month</th>
                      <th>Working Days</th>
                      <th>Present</th>
                      <th>Leave</th>
                      <th>Absent</th>
                      <th>Gross</th>
                      <th>Deductions</th>
                      <th>Net Salary</th>
                      <th>Status</th>
                      <th>Payment</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600 }}>{r.employee_name}</td>
                        <td>{r.department}</td>
                        <td>{r.month}</td>
                        <td>{r.total_working_days}</td>
                        <td>{r.days_present}</td>
                        <td>{r.days_leave}</td>
                        <td>{r.days_absent}</td>
                        <td style={{ color: 'var(--accent)' }}>{r.gross_salary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                        <td style={{ color: '#ef4444' }}>{r.total_deductions.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                        <td style={{ fontWeight: 700, color: '#10b981' }}>{r.net_salary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                        <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                        <td>
                          <span className={`badge ${r.payment_status || 'pending'}`} style={{
                            background: r.payment_status === 'paid' ? 'rgba(16,185,129,0.15)' : r.payment_status === 'failed' ? 'rgba(239,68,68,0.15)' : r.payment_status === 'processing' ? 'rgba(245,158,11,0.15)' : 'rgba(100,116,139,0.15)',
                            color: r.payment_status === 'paid' ? '#10b981' : r.payment_status === 'failed' ? '#ef4444' : r.payment_status === 'processing' ? '#f59e0b' : '#94a3b8'
                          }}>
                            {r.payment_status || 'pending'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handleViewSlip(r.id)}>Slip</button>
                            {r.status === 'generated' && <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handleStatusUpdate(r.id, 'approved')}>Approve</button>}
                            {r.status === 'approved' && r.payment_status !== 'paid' && (
                              <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 8px', background: 'var(--gradient-success)', border: 'none' }} onClick={() => handlePaySalary(r.id)}>Pay Salary</button>
                            )}
                            {r.payment_status === 'failed' && r.status === 'approved' && (
                              <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 8px', background: 'var(--gradient-success)', border: 'none' }} onClick={() => handlePaySalary(r.id)}>Retry Payment</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── SALARY CONFIG TAB ─── */}
      {tab === 'config' && (
        <div className="card">
          <div className="card-header"><h2>Employee Salary Configuration</h2></div>
          <div className="card-body">
            {configForm ? (
              <form onSubmit={handleSaveConfig}>
                <h3 style={{ marginBottom: 16, color: 'var(--text-primary)' }}>Configure Salary - {configForm.employee_name}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                  {[
                    { label: 'Basic Salary', key: 'basic_salary' },
                    { label: 'HRA', key: 'hra' },
                    { label: 'DA', key: 'da' },
                    { label: 'TA', key: 'ta' },
                    { label: 'PF Deduction', key: 'pf_deduction' },
                    { label: 'Tax Deduction', key: 'tax_deduction' },
                    { label: 'Other Deductions', key: 'other_deductions' },
                  ].map(f => (
                    <div key={f.key} className="login-field">
                      <label>{f.label}</label>
                      <input type="number" step="0.01" min="0" value={configForm[f.key]} onChange={e => setConfigForm({ ...configForm, [f.key]: parseFloat(e.target.value) || 0 })} />
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
                  <button type="submit" className="btn btn-primary">Save Configuration</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setConfigForm(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr><th>Employee</th><th>Department</th><th>Basic</th><th>HRA</th><th>DA</th><th>TA</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => {
                      const c = configs.find(x => x.user_id === emp.id);
                      return (
                        <tr key={emp.id}>
                          <td style={{ fontWeight: 600 }}>{emp.name}</td>
                          <td>{emp.department}</td>
                          <td>{c ? `${c.basic_salary.toLocaleString()}` : '-'}</td>
                          <td>{c ? `${c.hra.toLocaleString()}` : '-'}</td>
                          <td>{c ? `${c.da.toLocaleString()}` : '-'}</td>
                          <td>{c ? `${c.ta.toLocaleString()}` : '-'}</td>
                          <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{c ? `${c.gross_salary.toLocaleString()}` : '-'}</td>
                          <td style={{ color: '#ef4444' }}>{c ? `${c.total_deductions.toLocaleString()}` : '-'}</td>
                          <td style={{ color: '#10b981', fontWeight: 700 }}>{c ? `${c.net_salary.toLocaleString()}` : '-'}</td>
                          <td><button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => openConfigForm(emp)}>Configure</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── HOLIDAYS TAB ─── */}
      {tab === 'holidays' && (
        <div className="card">
          <div className="card-header"><h2>Holidays Management</h2></div>
          <div className="card-body">
            {user?.role === 'admin' && (
              <form onSubmit={handleCreateHoliday} style={{ marginBottom: 24, padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-main)' }}>
                <h3 style={{ marginBottom: 12, fontSize: 14 }}>Add Holiday</h3>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
                  <div className="login-field" style={{ marginBottom: 0 }}>
                    <label>Date</label>
                    <input type="date" required value={holidayForm.date} onChange={e => setHolidayForm({ ...holidayForm, date: e.target.value })} />
                  </div>
                  <div className="login-field" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
                    <label>Holiday Name</label>
                    <input type="text" required value={holidayForm.name} onChange={e => setHolidayForm({ ...holidayForm, name: e.target.value })} placeholder="e.g. Diwali" />
                  </div>
                  <div className="login-field" style={{ marginBottom: 0 }}>
                    <label>Type</label>
                    <select value={holidayForm.holiday_type} onChange={e => setHolidayForm({ ...holidayForm, holiday_type: e.target.value, user_id: e.target.value === 'company' ? '' : holidayForm.user_id })}>
                      <option value="company">Company-wide</option>
                      <option value="custom">Custom (Specific Employee)</option>
                    </select>
                  </div>
                  {holidayForm.holiday_type === 'custom' && (
                    <div className="login-field" style={{ marginBottom: 0 }}>
                      <label>Employee</label>
                      <select required value={holidayForm.user_id} onChange={e => setHolidayForm({ ...holidayForm, user_id: e.target.value })}>
                        <option value="">Select employee</option>
                        {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </div>
                  )}
                  <button type="submit" className="btn btn-primary">Add Holiday</button>
                </div>
              </form>
            )}

            {holidays.length === 0 ? (
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 20 }}>No holidays configured.</p>
            ) : (
              <table className="data-table">
                <thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th>For</th>{user?.role === 'admin' && <th>Action</th>}</tr></thead>
                <tbody>
                  {holidays.map(h => (
                    <tr key={h.id}>
                      <td>{h.date}</td>
                      <td style={{ fontWeight: 600 }}>{h.name}</td>
                      <td><span className={`badge ${h.holiday_type}`}>{h.holiday_type}</span></td>
                      <td>{h.employee_name}</td>
                      {user?.role === 'admin' && (
                        <td><button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px', color: '#ef4444' }} onClick={() => handleDeleteHoliday(h.id)}>Delete</button></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// EMPLOYEE VIEW
// ═══════════════════════════════════════════════════════════════
function EmployeePayrollView() {
  const [records, setRecords] = useState([]);
  const [slip, setSlip] = useState(null);
  const [config, setConfig] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getPayrollRecords({}).then(({ data }) => setRecords(data)).catch(() => {});
    getMyPayrollConfig().then(({ data }) => setConfig(data)).catch(() => {});
    getHolidays().then(({ data }) => setHolidays(data)).catch(() => {});
  }, []);

  const handleViewSlip = async (payrollId) => {
    try {
      const { data } = await getPayrollSlip(payrollId);
      setSlip(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load salary slip.');
    }
  };

  if (slip) return <SalarySlipView slip={slip} onClose={() => setSlip(null)} />;

  return (
    <div>
      {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Salary Overview */}
      {config && (
        <div className="stats-grid" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-info"><h3>{config.gross_salary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</h3><p>Gross Salary</p></div>
            <div className="stat-icon blue">&#128176;</div>
          </div>
          <div className="stat-card">
            <div className="stat-info"><h3>{config.total_deductions.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</h3><p>Deductions</p></div>
            <div className="stat-icon yellow">&#128181;</div>
          </div>
          <div className="stat-card">
            <div className="stat-info"><h3>{config.net_salary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</h3><p>Net Salary</p></div>
            <div className="stat-icon green">&#128178;</div>
          </div>
          <div className="stat-card">
            <div className="stat-info"><h3>{records.length}</h3><p>Pay Periods</p></div>
            <div className="stat-icon purple">&#128203;</div>
          </div>
        </div>
      )}

      {/* Pay History */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><h2>My Pay History</h2></div>
        <div className="card-body">
          {records.length === 0 ? (
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 20 }}>No payroll records yet.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Month</th><th>Working Days</th><th>Present</th><th>Leave</th><th>Gross</th><th>Deductions</th><th>Net Salary</th><th>Status</th><th>Payment</th><th>Action</th></tr></thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.month}</td>
                    <td>{r.total_working_days}</td>
                    <td>{r.days_present}</td>
                    <td>{r.days_leave}</td>
                    <td>{r.gross_salary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                    <td style={{ color: '#ef4444' }}>{r.total_deductions.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                    <td style={{ fontWeight: 700, color: '#10b981' }}>{r.net_salary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</td>
                    <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                    <td>
                      <span className="badge" style={{
                        background: r.payment_status === 'paid' ? 'rgba(16,185,129,0.15)' : r.payment_status === 'failed' ? 'rgba(239,68,68,0.15)' : 'rgba(100,116,139,0.15)',
                        color: r.payment_status === 'paid' ? '#10b981' : r.payment_status === 'failed' ? '#ef4444' : '#94a3b8'
                      }}>{r.payment_status || 'pending'}</span>
                    </td>
                    <td><button className="btn btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handleViewSlip(r.id)}>View Slip</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Holidays */}
      <div className="card">
        <div className="card-header"><h2>Holidays</h2></div>
        <div className="card-body">
          {holidays.length === 0 ? (
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13, textAlign: 'center', padding: 20 }}>No holidays listed.</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>Date</th><th>Holiday</th><th>Type</th></tr></thead>
              <tbody>
                {holidays.map(h => (
                  <tr key={h.id}><td>{h.date}</td><td style={{ fontWeight: 600 }}>{h.name}</td><td><span className={`badge ${h.holiday_type}`}>{h.holiday_type}</span></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// SALARY SLIP VIEW (shared)
// ═══════════════════════════════════════════════════════════════
function SalarySlipView({ slip, onClose }) {
  const handlePrint = () => window.print();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <button className="btn btn-secondary" onClick={onClose}>&larr; Back</button>
        <button className="btn btn-primary" onClick={handlePrint}>Print Salary Slip</button>
      </div>

      <div className="card" id="salary-slip" style={{ maxWidth: 700, margin: '0 auto' }}>
        <div className="card-body" style={{ padding: 32 }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 24, borderBottom: '2px solid var(--border)', paddingBottom: 20 }}>
            <h1 style={{ fontSize: 22, color: 'var(--accent)', marginBottom: 4 }}>{slip.company}</h1>
            <h2 style={{ fontSize: 16, color: 'var(--text-secondary)', fontWeight: 500 }}>{slip.slip_title} - {slip.month}</h2>
          </div>

          {/* Employee Info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24, fontSize: 13 }}>
            <div><strong>Name:</strong> {slip.employee.name}</div>
            <div><strong>Employee ID:</strong> EMP-{String(slip.employee.id).padStart(4, '0')}</div>
            <div><strong>Department:</strong> {slip.employee.department}</div>
            <div><strong>Position:</strong> {slip.employee.position}</div>
            <div><strong>Email:</strong> {slip.employee.email}</div>
            <div><strong>Hire Date:</strong> {slip.employee.hire_date}</div>
          </div>

          {/* Attendance Summary */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10, color: 'var(--text-primary)' }}>Attendance Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, fontSize: 13 }}>
              <div style={{ padding: 12, background: 'var(--bg-main)', borderRadius: 'var(--radius)', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{slip.attendance.total_working_days}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>Working Days</div>
              </div>
              <div style={{ padding: 12, background: 'rgba(16,185,129,0.1)', borderRadius: 'var(--radius)', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>{slip.attendance.days_present}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>Present</div>
              </div>
              <div style={{ padding: 12, background: 'rgba(59,130,246,0.1)', borderRadius: 'var(--radius)', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#3b82f6' }}>{slip.attendance.days_leave}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>Leave</div>
              </div>
              <div style={{ padding: 12, background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius)', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{slip.attendance.days_absent}</div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>Absent</div>
              </div>
            </div>
          </div>

          {/* Earnings & Deductions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24, fontSize: 13 }}>
            <div>
              <h3 style={{ fontSize: 14, marginBottom: 10, color: '#10b981' }}>Earnings</h3>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {[
                  ['Basic Salary', slip.earnings.basic_salary],
                  ['HRA', slip.earnings.hra],
                  ['DA', slip.earnings.da],
                  ['TA', slip.earnings.ta],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border-light)' }}>
                    <span>{label}</span>
                    <span>{val.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', fontWeight: 700, background: 'rgba(16,185,129,0.05)' }}>
                  <span>Gross Salary</span>
                  <span style={{ color: '#10b981' }}>{slip.earnings.gross_salary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                </div>
              </div>
            </div>
            <div>
              <h3 style={{ fontSize: 14, marginBottom: 10, color: '#ef4444' }}>Deductions</h3>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {[
                  ['Provident Fund', slip.deductions.pf_deduction],
                  ['Tax', slip.deductions.tax_deduction],
                  ['Other', slip.deductions.other_deductions],
                ].map(([label, val]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border-light)' }}>
                    <span>{label}</span>
                    <span>{val.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', fontWeight: 700, background: 'rgba(239,68,68,0.05)' }}>
                  <span>Total Deductions</span>
                  <span style={{ color: '#ef4444' }}>{slip.deductions.total_deductions.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Net Salary */}
          <div style={{ textAlign: 'center', padding: 20, background: 'var(--bg-main)', borderRadius: 'var(--radius)', border: '2px solid var(--accent)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>NET SALARY</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)' }}>
              {(slip.final_salary || slip.net_salary).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${slip.status}`}>{slip.status}</span>
              {slip.payment_status && (
                <span className="badge" style={{
                  background: slip.payment_status === 'paid' ? 'rgba(16,185,129,0.15)' : slip.payment_status === 'failed' ? 'rgba(239,68,68,0.15)' : slip.payment_status === 'processing' ? 'rgba(245,158,11,0.15)' : 'rgba(100,116,139,0.15)',
                  color: slip.payment_status === 'paid' ? '#10b981' : slip.payment_status === 'failed' ? '#ef4444' : slip.payment_status === 'processing' ? '#f59e0b' : '#94a3b8'
                }}>
                  Payment: {slip.payment_status}
                </span>
              )}
            </div>
            {slip.paid_on && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#10b981' }}>
                Paid on: {new Date(slip.paid_on).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ marginTop: 24, textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)' }}>
            This is a system-generated salary slip. For queries, contact HR.
            <br />Generated on {slip.generated_at ? new Date(slip.generated_at).toLocaleDateString() : 'N/A'}
            {slip.payment_id && <><br />Payment Ref: {slip.payment_id}</>}
          </div>
        </div>
      </div>
    </div>
  );
}
