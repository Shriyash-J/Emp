import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getEmployees, addEmployee, updateEmployee, deleteEmployee,
  getEmployeeAnalytics
} from '../services/api';
import { validatePassword, validatePhone } from '../utils/validators';

const fieldErrorStyle = {
  color: '#ef4444',
  fontSize: 12,
  marginTop: 4,
};

const RATING_LABELS = { 1: 'Needs Improvement', 2: 'Below Expectations', 3: 'Meets Expectations', 4: 'Exceeds', 5: 'Outstanding' };
const RATING_COLORS = { 1: '#f44336', 2: '#ff9800', 3: '#2196f3', 4: '#4caf50', 5: '#1a237e' };

export default function EmployeeList() {
  const { user } = useAuth();
  const canEdit = ['admin', 'hr'].includes(user.role);
  const canViewAnalytics = ['admin', 'hr', 'manager'].includes(user.role);

  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'employee', department: '', position: '', phone: '' });
  const [msg, setMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  // Analytics state
  const [analyticsEmpId, setAnalyticsEmpId] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsMonths, setAnalyticsMonths] = useState(6);

  const fetchEmployees = () => {
    getEmployees({ search, department: filterDept, status: filterStatus }).then(({ data }) => setEmployees(data)).catch(() => {});
  };

  useEffect(() => { fetchEmployees(); }, [search, filterDept, filterStatus]);

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];

  // ── Analytics ──────────────────────────────────────────────
  async function openAnalytics(empId) {
    if (analyticsEmpId === empId) { setAnalyticsEmpId(null); setAnalytics(null); return; }
    setAnalyticsEmpId(empId);
    setAnalyticsLoading(true);
    setAnalytics(null);
    try {
      const { data } = await getEmployeeAnalytics(empId, { months: analyticsMonths });
      setAnalytics(data);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to load analytics.');
      setAnalyticsEmpId(null);
    }
    setAnalyticsLoading(false);
  }

  async function refreshAnalytics(months) {
    setAnalyticsMonths(months);
    if (!analyticsEmpId) return;
    setAnalyticsLoading(true);
    try {
      const { data } = await getEmployeeAnalytics(analyticsEmpId, { months });
      setAnalytics(data);
    } catch { /* keep old data */ }
    setAnalyticsLoading(false);
  }

  // ── CRUD ───────────────────────────────────────────────────
  const openAdd = () => {
    setEditingEmp(null);
    setForm({ name: '', email: '', password: '', role: 'employee', department: '', position: '', phone: '' });
    setFieldErrors({});
    setShowModal(true);
  };
  const openEdit = (emp) => {
    setEditingEmp(emp);
    setForm({ name: emp.name, email: emp.email, password: '', role: emp.role, department: emp.department, position: emp.position, phone: emp.phone, status: emp.status });
    setFieldErrors({});
    setShowModal(true);
  };
  const updateField = (key, value) => {
    setForm({ ...form, [key]: value });
    if (fieldErrors[key]) setFieldErrors({ ...fieldErrors, [key]: null });
  };
  const handleSubmit = async (e) => {
    e.preventDefault();

    const errs = {};
    // Password is only required when adding a new employee.
    if (!editingEmp) {
      errs.password = validatePassword(form.password);
    }
    errs.phone = validatePhone(form.phone, { required: false });
    if (Object.values(errs).some(Boolean)) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    const trimmedPhone = (form.phone ?? '').trim();
    try {
      if (editingEmp) {
        const { password, ...rest } = form;
        await updateEmployee(editingEmp.id, { ...rest, phone: trimmedPhone });
        setMsg('Employee updated successfully!');
      } else {
        await addEmployee({ ...form, phone: trimmedPhone });
        setMsg('Employee added successfully!');
      }
      setShowModal(false); fetchEmployees();
    } catch (err) { setMsg(err.response?.data?.error || 'Operation failed'); }
  };
  const handleDelete = async (id, name) => {
    if (!confirm(`Are you sure you want to delete ${name}?`)) return;
    try { await deleteEmployee(id); setMsg('Employee deleted.'); fetchEmployees(); }
    catch (err) { setMsg(err.response?.data?.error || 'Delete failed'); }
  };

  // ── Helpers ────────────────────────────────────────────────
  function ProgressBar({ value, max = 100, color = '#4caf50', height = 6 }) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return (
      <div style={{ height, background: '#e0e0e0', borderRadius: height / 2, overflow: 'hidden', width: '100%' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: height / 2, transition: 'width 0.4s' }} />
      </div>
    );
  }

  function MetricCard({ label, value, sub, color }) {
    return (
      <div style={{ textAlign: 'center', padding: '12px 8px', background: 'var(--bg-secondary, #f8f9fa)', borderRadius: 10, minWidth: 90 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--primary, #1a237e)' }}>{value}</div>
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: 'var(--text-secondary, #555)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{sub}</div>}
      </div>
    );
  }

  const a = analytics; // shorthand

  return (
    <div>
      {msg && (
        <div className={`att-msg ${msg.includes('success') || msg.includes('deleted') ? 'success' : 'error'}`}>
          {msg}<button className="att-msg-close" onClick={() => setMsg('')}>x</button>
        </div>
      )}

      <div className="filter-bar">
        <input placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="on_leave">On Leave</option>
        </select>
        {user.role === 'hr' && <button className="btn btn-primary" onClick={openAdd}>+ Add Employee</button>}
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Position</th><th>Status</th><th>Hire Date</th>
              {canEdit && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <>
                <tr key={emp.id}
                  onClick={() => canViewAnalytics && openAnalytics(emp.id)}
                  style={{ cursor: canViewAnalytics ? 'pointer' : 'default', background: analyticsEmpId === emp.id ? 'var(--bg-secondary, #f0f4ff)' : undefined }}
                >
                  <td><strong>{emp.name}</strong>{canViewAnalytics && <span style={{ fontSize: 11, color: '#999', marginLeft: 6 }}>{analyticsEmpId === emp.id ? '▲' : '▼'}</span>}</td>
                  <td>{emp.email}</td>
                  <td><span className={`badge ${emp.role}`}>{emp.role}</span></td>
                  <td>{emp.department}</td>
                  <td>{emp.position}</td>
                  <td><span className={`badge ${emp.status}`}>{emp.status}</span></td>
                  <td>{emp.hire_date}</td>
                  {canEdit && (
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(emp); }} style={{ marginRight: 6 }}>Edit</button>
                      {user.role === 'admin' && <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); handleDelete(emp.id, emp.name); }}>Delete</button>}
                    </td>
                  )}
                </tr>

                {/* ═══ ANALYTICS PANEL — expands inline below the row ═══ */}
                {analyticsEmpId === emp.id && (
                  <tr key={`analytics-${emp.id}`}>
                    <td colSpan={canEdit ? 8 : 7} style={{ padding: 0, border: 'none' }}>
                      <div style={{ padding: '20px 24px', background: 'var(--bg-secondary, #f8f9fa)', borderBottom: '2px solid var(--primary, #1a237e)' }}>

                        {analyticsLoading ? (
                          <div style={{ textAlign: 'center', padding: 30, color: '#888' }}>Loading analytics...</div>
                        ) : !a ? (
                          <div style={{ textAlign: 'center', padding: 30, color: '#888' }}>No data available</div>
                        ) : (
                          <>
                            {/* Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                              <div>
                                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Analytics: {a.employee.name}</h3>
                                <span style={{ fontSize: 13, color: '#666' }}>
                                  {a.employee.position} | {a.employee.department} | Period: last {a.period.months} months
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {[3, 6, 12].map(m => (
                                  <button key={m} onClick={(e) => { e.stopPropagation(); refreshAnalytics(m); }}
                                    style={{
                                      padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                      border: analyticsMonths === m ? '2px solid var(--primary, #1a237e)' : '1px solid #ccc',
                                      background: analyticsMonths === m ? 'var(--primary, #1a237e)' : 'white',
                                      color: analyticsMonths === m ? 'white' : '#333',
                                    }}>
                                    {m}mo
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* ═══ SECTION 1: Attendance ═══ */}
                            <div style={{ marginBottom: 20 }}>
                              <h4 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: 'var(--primary, #1a237e)' }}>Attendance</h4>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 12 }}>
                                <MetricCard label="Present" value={a.attendance.total_present} color="#4caf50" />
                                <MetricCard label="Absent" value={a.attendance.total_absent} color="#f44336" />
                                <MetricCard label="On Leave" value={a.attendance.total_leave} color="#ff9800" />
                                <MetricCard label="Late" value={a.attendance.total_late} color="#e91e63" />
                                <MetricCard label="Avg Hours" value={a.attendance.avg_hours_per_day} sub="/day" color="#2196f3" />
                                <MetricCard label="Overtime" value={`${a.attendance.total_overtime}h`} color="#9c27b0" />
                                <MetricCard label="Rate" value={`${a.attendance.attendance_rate}%`} color={a.attendance.attendance_rate >= 90 ? '#4caf50' : a.attendance.attendance_rate >= 75 ? '#ff9800' : '#f44336'} />
                              </div>
                              {/* Monthly sparkline */}
                              {a.attendance.monthly_breakdown.length > 0 && (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  {a.attendance.monthly_breakdown.map(m => (
                                    <div key={m.month} style={{ fontSize: 11, textAlign: 'center', padding: '4px 8px', background: '#fff', borderRadius: 8, border: '1px solid #eee', minWidth: 65 }}>
                                      <div style={{ fontWeight: 600 }}>{m.month.slice(5)}</div>
                                      <div style={{ color: '#4caf50' }}>{m.present}p</div>
                                      <div style={{ color: '#f44336' }}>{m.absent}a</div>
                                      {m.late > 0 && <div style={{ color: '#e91e63' }}>{m.late}L</div>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* ═══ SECTION 2: Task Performance ═══ */}
                            <div style={{ marginBottom: 20 }}>
                              <h4 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: 'var(--primary, #1a237e)' }}>Task Performance</h4>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 10 }}>
                                <MetricCard label="Total" value={a.tasks.total_tasks} color="#333" />
                                <MetricCard label="Completed" value={a.tasks.completed} color="#4caf50" />
                                <MetricCard label="In Progress" value={a.tasks.in_progress} color="#2196f3" />
                                <MetricCard label="Pending" value={a.tasks.pending} color="#9e9e9e" />
                                <MetricCard label="Completion" value={`${a.tasks.completion_rate}%`} color={a.tasks.completion_rate >= 80 ? '#4caf50' : '#ff9800'} />
                                <MetricCard label="On Time" value={a.tasks.on_time_completions} color="#4caf50" />
                              </div>
                              {a.tasks.total_tasks > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ fontSize: 12, minWidth: 70 }}>Completion</span>
                                  <ProgressBar value={a.tasks.completion_rate} color={a.tasks.completion_rate >= 80 ? '#4caf50' : '#ff9800'} height={8} />
                                  <span style={{ fontSize: 12, fontWeight: 600 }}>{a.tasks.completion_rate}%</span>
                                </div>
                              )}
                            </div>

                            {/* ═══ SECTION 3: Leave Summary ═══ */}
                            <div style={{ marginBottom: 20 }}>
                              <h4 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: 'var(--primary, #1a237e)' }}>Leave Summary</h4>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 10 }}>
                                <MetricCard label="Requests" value={a.leaves.total_requests} color="#333" />
                                <MetricCard label="Approved" value={a.leaves.approved} color="#4caf50" />
                                <MetricCard label="Rejected" value={a.leaves.rejected} color="#f44336" />
                                <MetricCard label="Pending" value={a.leaves.pending} color="#ff9800" />
                                <MetricCard label="Days Taken" value={a.leaves.total_days_taken} color="#9c27b0" />
                              </div>
                              {Object.keys(a.leaves.by_type).length > 0 && (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {Object.entries(a.leaves.by_type).map(([type, days]) => (
                                    <span key={type} style={{ padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600, background: '#e3f2fd', color: '#1565c0' }}>
                                      {type}: {days}d
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* ═══ SECTION 4: Performance Ratings ═══ */}
                            <div>
                              <h4 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: 'var(--primary, #1a237e)' }}>Performance Ratings</h4>
                              {a.performance.total_reviews === 0 ? (
                                <span style={{ fontSize: 13, color: '#888' }}>No performance reviews yet</span>
                              ) : (
                                <>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 10 }}>
                                    <MetricCard label="Avg Rating" value={`${a.performance.avg_rating}/5`} color={RATING_COLORS[Math.round(a.performance.avg_rating)] || '#333'} />
                                    <MetricCard label="Latest" value={a.performance.latest_rating ? `${a.performance.latest_rating}/5` : '-'} sub={a.performance.latest_rating ? RATING_LABELS[a.performance.latest_rating] : ''} color={RATING_COLORS[a.performance.latest_rating] || '#333'} />
                                    <MetricCard label="Goals Met" value={`${a.performance.avg_goals_met}%`} color={a.performance.avg_goals_met >= 80 ? '#4caf50' : '#ff9800'} />
                                    <MetricCard label="Reviews" value={a.performance.total_reviews} color="#333" />
                                  </div>
                                  {/* Rating history */}
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {a.performance.rating_history.map((r, i) => (
                                      <div key={i} style={{ padding: '6px 12px', borderRadius: 10, background: '#fff', border: '1px solid #eee', fontSize: 12, textAlign: 'center' }}>
                                        <div style={{ fontWeight: 600 }}>{r.period}</div>
                                        <div style={{ fontSize: 18, fontWeight: 700, color: RATING_COLORS[r.rating] }}>{r.rating}/5</div>
                                        <div style={{ color: '#888' }}>{r.goals_met}% goals</div>
                                      </div>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {employees.length === 0 && <div className="empty-state"><h3>No employees found</h3><p>Try adjusting your search or filters</p></div>}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingEmp ? 'Edit Employee' : 'Add New Employee'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group"><label>Full Name *</label><input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} required /></div>
                <div className="form-group"><label>Email *</label><input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} required /></div>
              </div>
              {!editingEmp && (
                <div className="form-group">
                  <label>Password *</label>
                  <input type="password" value={form.password} onChange={(e) => updateField('password', e.target.value)} required={!editingEmp} />
                  {fieldErrors.password && <div style={fieldErrorStyle}>{fieldErrors.password}</div>}
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Role *</label>
                  <select value={form.role} onChange={(e) => setForm({...form, role: e.target.value})}>
                    <option value="employee">Employee</option><option value="manager">Manager</option><option value="hr">HR</option>
                    {user.role === 'admin' && <option value="admin">Admin</option>}
                  </select>
                </div>
                <div className="form-group"><label>Department</label><input value={form.department} onChange={(e) => setForm({...form, department: e.target.value})} placeholder="e.g., Engineering" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Position</label><input value={form.position} onChange={(e) => setForm({...form, position: e.target.value})} placeholder="e.g., Software Developer" /></div>
                <div className="form-group">
                  <label>Phone</label>
                  <input value={form.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="10-digit phone number" inputMode="numeric" maxLength={10} />
                  {fieldErrors.phone && <div style={fieldErrorStyle}>{fieldErrors.phone}</div>}
                </div>
              </div>
              {editingEmp && (
                <div className="form-group">
                  <label>Status</label>
                  <select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
                    <option value="active">Active</option><option value="inactive">Inactive</option><option value="on_leave">On Leave</option>
                  </select>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingEmp ? 'Update' : 'Add Employee'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
