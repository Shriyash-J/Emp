import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMyLeaves, getAllLeaves, requestLeave, updateLeave } from '../services/api';

export default function LeavePage() {
  const { user } = useAuth();
  const [leaves, setLeaves] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ leave_type: 'casual', start_date: '', end_date: '', reason: '' });
  const [msg, setMsg] = useState('');
  const isManager = ['admin', 'hr', 'manager'].includes(user.role);

  // Approval matrix: Admin acts on any non-self request; HR acts only on employee
  // requests; everyone else (Manager, Employee) sees no approve/reject controls.
  const canApprove = (leave) => {
    if (!leave || leave.status !== 'pending') return false;
    if (leave.user_id === user.id) return false; // never approve your own
    if (user.role === 'admin') return true;
    if (user.role === 'hr') return leave.user_role === 'employee';
    return false;
  };

  const fetchLeaves = () => {
    if (isManager) getAllLeaves({}).then(({ data }) => setLeaves(data)).catch(() => {});
    else getMyLeaves().then(({ data }) => setLeaves(data)).catch(() => {});
  };

  useEffect(() => { fetchLeaves(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try { await requestLeave(form); setMsg('Leave request submitted!'); setShowModal(false); setForm({ leave_type: 'casual', start_date: '', end_date: '', reason: '' }); fetchLeaves(); }
    catch (err) { setMsg(err.response?.data?.error || 'Failed'); }
  };

  const handleAction = async (id, status) => {
    try { await updateLeave(id, { status }); setMsg(`Leave ${status}!`); fetchLeaves(); }
    catch (err) { setMsg(err.response?.data?.error || 'Failed'); }
  };

  return (
    <div>
      {msg && <div className="login-success" style={{ marginBottom: 16 }}>{msg}<button onClick={() => setMsg('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button></div>}

      <div style={{ marginBottom: 20 }}>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Request Leave</button>
      </div>

      <div className="card">
        <div className="card-header"><h2>{isManager ? 'All Leave Requests' : 'My Leave Requests'}</h2></div>
        <table>
          <thead>
            <tr>
              {isManager && <><th>Employee</th><th>Department</th></>}
              <th>Type</th><th>Start</th><th>End</th><th>Reason</th><th>Status</th>
              {isManager && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {leaves.map(l => (
              <tr key={l.id}>
                {isManager && <><td><strong>{l.employee_name}</strong></td><td>{l.department}</td></>}
                <td style={{ textTransform: 'capitalize' }}>{l.leave_type}</td>
                <td>{l.start_date}</td>
                <td>{l.end_date}</td>
                <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.reason || '-'}</td>
                <td><span className={`badge ${l.status}`}>{l.status}</span></td>
                {isManager && (
                  <td>
                    {canApprove(l) ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleAction(l.id, 'approved')}>Approve</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleAction(l.id, 'rejected')}>Reject</button>
                      </div>
                    ) : l.status !== 'pending' ? (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{l.approved_by_name ? `by ${l.approved_by_name}` : '-'}</span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {leaves.length === 0 && <div className="empty-state"><h3>No leave requests</h3></div>}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Request Leave</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Leave Type</label>
                <select value={form.leave_type} onChange={e => setForm({...form, leave_type: e.target.value})}>
                  <option value="casual">Casual Leave</option><option value="sick">Sick Leave</option><option value="earned">Earned Leave</option><option value="maternity">Maternity Leave</option><option value="paternity">Paternity Leave</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Start Date</label><input type="date" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} required /></div>
                <div className="form-group"><label>End Date</label><input type="date" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} required /></div>
              </div>
              <div className="form-group"><label>Reason</label><textarea rows="3" value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} placeholder="Reason for leave..."></textarea></div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Submit Request</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
