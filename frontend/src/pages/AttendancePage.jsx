import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getMyAttendance, getAllAttendance, checkIn, checkOut,
  getTodayStatus, getAttendanceSummary, manageAttendance, getEmployees,
  getFaceStatus, registerFace, faceCheckIn, faceCheckOut
} from '../services/api';
import { formatTime, formatDate } from '../utils/format';

export default function AttendancePage() {
  const { user } = useAuth();
  const isManager = ['admin', 'hr', 'manager'].includes(user.role);
  // HR can view attendance (as isManager above), but cannot manually create/edit
  // attendance records — that privilege is admin-only.
  const isAdmin = user.role === 'admin';

  // Core state
  const [records, setRecords] = useState([]);
  const [todayStatus, setTodayStatus] = useState(null);
  const [summary, setSummary] = useState([]);
  const [msg, setMsg] = useState({ text: '', type: 'success' });
  const [loading, setLoading] = useState(false);

  // Filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [summaryMonth, setSummaryMonth] = useState(new Date().toISOString().slice(0, 7));

  // Manage modal
  const [showManage, setShowManage] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [manageForm, setManageForm] = useState({ employee_id: '', date: '', check_in: '', check_out: '', status: 'present' });

  // Face recognition
  const [faceRegistered, setFaceRegistered] = useState(false);
  const [showWebcam, setShowWebcam] = useState(false);
  const [webcamAction, setWebcamAction] = useState(''); // 'check-in' | 'check-out' | 'register'
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  // View toggle
  const [view, setView] = useState('records'); // 'records' | 'summary'

  // ── Data loading ──────────────────────────────────────────────
  const loadRecords = useCallback(() => {
    const params = {};
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;
    if (statusFilter) params.status = statusFilter;
    if (searchFilter) params.search = searchFilter;

    if (isManager) {
      getAllAttendance(params).then(({ data }) => setRecords(data)).catch(() => {});
    } else {
      getMyAttendance(params).then(({ data }) => setRecords(data)).catch(() => {});
    }
  }, [isManager, fromDate, toDate, statusFilter, searchFilter]);

  const loadTodayStatus = useCallback(() => {
    getTodayStatus().then(({ data }) => setTodayStatus(data)).catch(() => {});
  }, []);

  const loadSummary = useCallback(() => {
    getAttendanceSummary({ month: summaryMonth })
      .then(({ data }) => setSummary(data))
      .catch(() => {});
  }, [summaryMonth]);

  const loadFaceStatus = useCallback(() => {
    getFaceStatus().then(({ data }) => setFaceRegistered(data.face_registered)).catch(() => {});
  }, []);

  useEffect(() => {
    loadRecords();
    loadTodayStatus();
    loadSummary();
    loadFaceStatus();
  }, [loadRecords, loadTodayStatus, loadSummary, loadFaceStatus]);

  // ── Actions ───────────────────────────────────────────────────
  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: 'success' }), 5000);
  };

  // ── Webcam helpers ─────────────────────────────────────────────
  const openWebcam = (action) => {
    setWebcamAction(action);
    setCapturedImage(null);
    setCameraReady(false);
    setShowWebcam(true);
    // Start camera after a brief delay so the modal + video element mount first
    setTimeout(() => startCamera(), 100);
  };

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 480, height: 360 }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      showMsg('Camera access denied. Please allow camera permission.', 'error');
      setShowWebcam(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const closeWebcam = useCallback(() => {
    stopCamera();
    setShowWebcam(false);
    setCapturedImage(null);
  }, [stopCamera]);

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Match canvas size to video stream
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    
    // Apply horizontal flip to the canvas so the saved image 
    // matches the "mirrored" preview the user sees.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to Base64 (JPEG is lighter for uploads than PNG)
    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    setCapturedImage(imageData);
  };

  const retakePhoto = () => setCapturedImage(null);

  const submitFaceAction = async () => {
    if (!capturedImage) return;
    setLoading(true);
    
    try {
      let response;
      // Using the specific functions already imported at the top of your file
      if (webcamAction === 'register') {
        response = await registerFace({ image: capturedImage });
        showMsg(response.data.message);
        setFaceRegistered(true);
      } 
      else if (webcamAction === 'check-in') {
        response = await faceCheckIn({ image: capturedImage });
        const { data } = response;
        
        // Using your project's formatTime utility and showMsg helper
        const timeMsg = data.is_late
          ? `LATE: Checked in at ${formatTime(data.check_in)}`
          : `Success: Checked in at ${formatTime(data.check_in)}`;
        
        showMsg(`${timeMsg} (${data.message || ''})`, data.is_late ? 'warning' : 'success');
        
        // Refreshing your local dashboard data
        loadTodayStatus();
        loadRecords();
        loadSummary();
      } 
      else if (webcamAction === 'check-out') {
        response = await faceCheckOut({ image: capturedImage });
        const { data } = response;
        
        const hrs = data.working_hours ? `${data.working_hours}h worked` : '';
        showMsg(`Checked out at ${formatTime(data.check_out)} — ${hrs}`);
        
        loadTodayStatus();
        loadRecords();
        loadSummary();
      }
      
      closeWebcam();
    } catch (err) {
      // Improved error handling to catch AWS/Backend messages
      const errorMessage = err.response?.data?.error || 
                           err.response?.data?.message || 
                           'Face verification failed. Please try again.';
      
      // Using showMsg instead of toast.error
      showMsg(errorMessage, 'error');
      
      // Clear bad photo on failure so user can try again
      if (err.response?.status === 401) {
        retakePhoto();
      }
    } finally { 
      setLoading(false); 
    }
  };

  const handleCheckIn = () => openWebcam('check-in');
  const handleCheckOut = () => openWebcam('check-out');

  const handleManageSubmit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await manageAttendance(manageForm);
      showMsg(data.message);
      setShowManage(false);
      setManageForm({ employee_id: '', date: '', check_in: '', check_out: '', status: 'present' });
      loadRecords();
      loadSummary();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Failed to update attendance', 'error');
    }
  };

  const openManageModal = () => {
    if (employees.length === 0) {
      getEmployees().then(({ data }) => setEmployees(data)).catch(() => {});
    }
    setShowManage(true);
  };

  const clearFilters = () => {
    setFromDate(''); setToDate(''); setStatusFilter(''); setSearchFilter('');
  };

  // ── Helpers ───────────────────────────────────────────────────
  const formatHours = (h) => h != null ? `${h}h` : '—';

  const getBadgeClass = (record) => {
    if (record.status === 'absent') return 'badge absent';
    if (record.status === 'leave') return 'badge on_leave';
    if (record.is_half_day) return 'badge half_day';
    if (record.is_late) return 'badge late';
    return 'badge present';
  };

  const getStatusLabel = (record) => {
    if (record.status === 'absent') return 'Absent';
    if (record.status === 'leave') return 'Leave';
    if (record.is_half_day) return 'Half Day';
    if (record.is_late) return 'Late';
    return 'Present';
  };

  // ── Render: Today's Status Banner ─────────────────────────────
  const renderTodayBanner = () => {
    if (!todayStatus) return null;
    const { checked_in, checked_out, check_in: cin, check_out: cout, is_late, working_hours } = todayStatus;

    let bannerClass = 'att-today-banner';
    let icon, label, detail;

    if (!checked_in) {
      bannerClass += ' not-checked';
      icon = '⏳'; label = 'Not Checked In'; detail = 'You have not checked in today.';
    } else if (!checked_out) {
      bannerClass += is_late ? ' late' : ' working';
      icon = is_late ? '⚠️' : '🟢';
      label = is_late ? 'Working (Late)' : 'Currently Working';
      detail = `Checked in at ${formatTime(cin)}`;
    } else {
      bannerClass += ' done';
      icon = '✅'; label = 'Day Complete';
      detail = `${formatTime(cin)} — ${formatTime(cout)} · ${working_hours || 0}h worked`;
    }

    return (
      <div className={bannerClass}>
        <span className="att-today-icon">{icon}</span>
        <div className="att-today-info">
          <strong>{label}</strong>
          <span>{detail}</span>
        </div>
        {!checked_in && (
          <button className="btn btn-primary btn-sm" onClick={handleCheckIn} disabled={loading}>
            Check In
          </button>
        )}
        {checked_in && !checked_out && (
          <button className="btn btn-secondary btn-sm" onClick={handleCheckOut} disabled={loading}>
            Check Out
          </button>
        )}
      </div>
    );
  };

  // ── Render: Summary Cards ─────────────────────────────────────
  const renderSummary = () => {
    // For employees: show own summary; for managers: show aggregate
    const mySum = isManager
      ? summary.reduce((acc, s) => ({
          total_present: acc.total_present + s.total_present,
          total_absent: acc.total_absent + s.total_absent,
          total_leave: acc.total_leave + s.total_leave,
          total_late: acc.total_late + s.total_late,
          total_hours: acc.total_hours + s.total_hours,
          avg_hours: 0,
        }), { total_present: 0, total_absent: 0, total_leave: 0, total_late: 0, total_hours: 0, avg_hours: 0 })
      : summary[0] || {};

    return (
      <div className="att-summary-grid">
        <div className="att-summary-card green">
          <div className="att-summary-num">{mySum.total_present || 0}</div>
          <div className="att-summary-label">Present</div>
        </div>
        <div className="att-summary-card red">
          <div className="att-summary-num">{mySum.total_absent || 0}</div>
          <div className="att-summary-label">Absent</div>
        </div>
        <div className="att-summary-card purple">
          <div className="att-summary-num">{mySum.total_leave || 0}</div>
          <div className="att-summary-label">On Leave</div>
        </div>
        <div className="att-summary-card yellow">
          <div className="att-summary-num">{mySum.total_late || 0}</div>
          <div className="att-summary-label">Late Days</div>
        </div>
        <div className="att-summary-card blue">
          <div className="att-summary-num">{mySum.total_hours || 0}</div>
          <div className="att-summary-label">Total Hours</div>
        </div>
        {!isManager && (
          <div className="att-summary-card blue">
            <div className="att-summary-num">{mySum.avg_hours || 0}</div>
            <div className="att-summary-label">Avg Hours/Day</div>
          </div>
        )}
      </div>
    );
  };

  // ── Render: Summary Table (manager view) ──────────────────────
  const renderSummaryTable = () => {
    if (!isManager || view !== 'summary') return null;
    return (
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header">
          <h2>Employee Summary — {summaryMonth}</h2>
          <input type="month" value={summaryMonth} onChange={e => setSummaryMonth(e.target.value)}
            className="att-month-input" />
        </div>
        <table>
          <thead>
            <tr>
              <th>Employee</th><th>Dept</th><th>Present</th><th>Absent</th>
              <th>Leave</th><th>Late</th><th>Hours</th><th>Avg</th><th>Overtime</th>
            </tr>
          </thead>
          <tbody>
            {summary.map(s => (
              <tr key={s.employee_id}>
                <td><strong>{s.employee_name}</strong></td>
                <td>{s.department}</td>
                <td><span className="badge present">{s.total_present}</span></td>
                <td><span className="badge absent">{s.total_absent}</span></td>
                <td><span className="badge on_leave">{s.total_leave}</span></td>
                <td>{s.total_late > 0 ? <span className="badge late">{s.total_late}</span> : '0'}</td>
                <td>{s.total_hours}h</td>
                <td>{s.avg_hours}h</td>
                <td>{s.total_overtime > 0 ? <span className="badge pending">{s.total_overtime}h</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {summary.length === 0 && <div className="empty-state"><h3>No records for this month</h3></div>}
      </div>
    );
  };

  // ── Render: Manage Modal ──────────────────────────────────────
  const renderManageModal = () => {
    if (!showManage) return null;
    return (
      <div className="modal-overlay" onClick={() => setShowManage(false)}>
        <div className="modal" onClick={e => e.stopPropagation()}>
          <h2>Manage Attendance</h2>
          <form onSubmit={handleManageSubmit}>
            <div className="form-group">
              <label>Employee</label>
              <select value={manageForm.employee_id} required
                onChange={e => setManageForm(f => ({ ...f, employee_id: e.target.value }))}>
                <option value="">Select employee...</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.name} — {e.department}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={manageForm.date} required
                  onChange={e => setManageForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Status</label>
                <select value={manageForm.status}
                  onChange={e => setManageForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="leave">Leave</option>
                  <option value="half_day">Half Day</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Check In</label>
                <input type="time" step="1" value={manageForm.check_in}
                  onChange={e => setManageForm(f => ({ ...f, check_in: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Check Out</label>
                <input type="time" step="1" value={manageForm.check_out}
                  onChange={e => setManageForm(f => ({ ...f, check_out: e.target.value }))} />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setShowManage(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // ── Main Render ───────────────────────────────────────────────
  return (
    <div>
      {/* Notification */}
      {msg.text && (
        <div className={`att-msg ${msg.type}`}>
          {msg.text}
          <button onClick={() => setMsg({ text: '', type: 'success' })} className="att-msg-close">✕</button>
        </div>
      )}

      {/* Face Registration Banner */}
      {!faceRegistered && (
        <div className="att-today-banner not-checked" style={{ marginBottom: 12 }}>
          <span className="att-today-icon">📷</span>
          <div className="att-today-info">
            <strong>Face Not Registered</strong>
            <span>Register your face to enable face recognition attendance.</span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => openWebcam('register')} disabled={loading}>
            Register Face
          </button>
        </div>
      )}

      {/* Today's Status Banner */}
      {renderTodayBanner()}

      {/* Summary Stats */}
      <div style={{ margin: '20px 0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          {summaryMonth} Overview
        </h3>
        {!isManager && (
          <input type="month" value={summaryMonth} onChange={e => setSummaryMonth(e.target.value)}
            className="att-month-input" />
        )}
      </div>
      {renderSummary()}

      {/* View Toggle + Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '24px 0 12px' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn btn-sm ${view === 'records' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setView('records')}>Records</button>
          {isManager && (
            <button className={`btn btn-sm ${view === 'summary' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setView('summary')}>Summary</button>
          )}
        </div>
        {isAdmin && (
          <button className="btn btn-primary btn-sm" onClick={openManageModal}>
            + Manage Attendance
          </button>
        )}
      </div>

      {/* Summary Table (Manager View) */}
      {renderSummaryTable()}

      {/* Records Table */}
      {view === 'records' && (
        <>
          {/* Filter Bar */}
          <div className="filter-bar">
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              placeholder="From" title="From date" />
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              placeholder="To" title="To date" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="leave">Leave</option>
            </select>
            {isManager && (
              <input type="text" value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
                placeholder="Search employee..." style={{ minWidth: 160 }} />
            )}
            {(fromDate || toDate || statusFilter || searchFilter) && (
              <button className="btn btn-outline btn-sm" onClick={clearFilters}>Clear</button>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h2>{isManager ? 'All Attendance Records' : 'My Attendance'}</h2>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{records.length} records</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    {isManager && <><th>Employee</th><th>Department</th></>}
                    <th>Date</th><th>Check In</th><th>Check Out</th>
                    <th>Hours</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id}>
                      {isManager && (
                        <>
                          <td><strong>{r.employee_name}</strong></td>
                          <td>{r.department}</td>
                        </>
                      )}
                      <td>{formatDate(r.date)}</td>
                      <td>
                        {r.check_in ? formatTime(r.check_in) : '—'}
                        {r.is_late && r.check_in && <span className="att-late-tag">LATE</span>}
                      </td>
                      <td>{r.check_out ? formatTime(r.check_out) : '—'}</td>
                      <td>
                        {formatHours(r.working_hours)}
                        {r.overtime_hours > 0 && (
                          <span className="att-ot-tag">+{r.overtime_hours}h OT</span>
                        )}
                      </td>
                      <td><span className={getBadgeClass(r)}>{getStatusLabel(r)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {records.length === 0 && (
              <div className="empty-state">
                <h3>No attendance records</h3>
                <p>No records found for the selected filters.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Webcam Modal for Face Recognition */}
      {showWebcam && (
        <div className="modal-overlay" onClick={closeWebcam}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ marginBottom: 4 }}>
              {webcamAction === 'register' ? '📷 Register Face' :
               webcamAction === 'check-in' ? '🟢 Face Check-In' : '🔴 Face Check-Out'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
              {capturedImage
                ? 'Review your photo. Click "Confirm" to proceed or "Retake" to try again.'
                : 'Position your face clearly in the frame and click "Capture".'}
            </p>

            <div style={{
              position: 'relative', width: '100%', borderRadius: 12, overflow: 'hidden',
              background: '#000', aspectRatio: '4/3', marginBottom: 16
            }}>
              {!capturedImage ? (
                <video ref={videoRef} autoPlay playsInline muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              ) : (
                <img src={capturedImage} alt="Captured"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              )}
              {!cameraReady && !capturedImage && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: '#fff', fontSize: 14
                }}>Starting camera...</div>
              )}
            </div>

            <canvas ref={canvasRef} style={{ display: 'none' }} />

            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={closeWebcam}>Cancel</button>
              {!capturedImage ? (
                <button className="btn btn-primary" onClick={capturePhoto}
                  disabled={!cameraReady || loading}>
                  Capture
                </button>
              ) : (
                <>
                  <button className="btn btn-outline" onClick={retakePhoto} disabled={loading}>Retake</button>
                  <button className="btn btn-primary" onClick={submitFaceAction} disabled={loading}>
                    {loading ? 'Verifying...' : 'Confirm'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manage Modal */}
      {renderManageModal()}
    </div>
  );
}
