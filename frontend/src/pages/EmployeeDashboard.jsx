import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getMyTasks, getMyTeamTasks, getMyAttendance, getMyLeaves, getAnnouncements, faceCheckIn, faceCheckOut, getFaceStatus, getTodayStatus } from '../services/api';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatTime, todayLocal } from '../utils/format';

const COLORS = ['#f59e0b', '#6366f1', '#10b981', '#ef4444'];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [todayStatus, setTodayStatus] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('success');

  // Face verification state
  const [faceRegistered, setFaceRegistered] = useState(false);
  const [showWebcam, setShowWebcam] = useState(false);
  const [webcamAction, setWebcamAction] = useState(''); // 'check-in' | 'check-out'
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    // Combine individual + team tasks so the dashboard reflects every
    // assignment the logged-in user owns (both endpoints filter by user_id).
    Promise.all([
      getMyTasks().then(r => r.data).catch(() => []),
      getMyTeamTasks().then(r => r.data).catch(() => []),
    ]).then(([mine, teamTasks]) => {
      const normalizedTeam = teamTasks.map(t => ({
        id: `team-${t.id}`,
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: t.status,
        due_date: t.deadline,
      }));
      setTasks([...mine, ...normalizedTeam]);
    });
    getMyAttendance().then(({ data }) => setAttendance(data)).catch(() => {});
    getTodayStatus().then(({ data }) => setTodayStatus(data)).catch(() => {});
    getMyLeaves().then(({ data }) => setLeaves(data)).catch(() => {});
    getAnnouncements().then(({ data }) => setAnnouncements(data.slice(0, 3))).catch(() => {});
    getFaceStatus().then(({ data }) => setFaceRegistered(data.face_registered)).catch(() => {});
  }, []);

  // Prefer the authoritative /attendance/today response; fall back to matching
  // today's local date against the recent-records list. todayLocal() uses the
  // browser's local calendar day so it aligns with the backend's company tz.
  const today = todayLocal();
  const todayAtt = todayStatus?.checked_in
    ? {
        check_in: todayStatus.check_in,
        check_out: todayStatus.check_out,
        working_hours: todayStatus.working_hours,
        is_late: todayStatus.is_late,
      }
    : attendance.find(a => a.date === today);
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const pendingLeaves = leaves.filter(l => l.status === 'pending').length;

  const taskData = [
    { name: 'Pending', value: pendingTasks },
    { name: 'In Progress', value: inProgressTasks },
    { name: 'Completed', value: completedTasks },
  ].filter(d => d.value > 0);

  // ── Webcam helpers ─────────────────────────────────────────────
  const showMessage = (text, type = 'success') => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(''), 5000);
  };

  const openWebcam = (action) => {
    if (!faceRegistered) {
      showMessage('Face not registered. Please register your face from the Attendance page first.', 'error');
      return;
    }
    setWebcamAction(action);
    setCapturedImage(null);
    setCameraReady(false);
    setShowWebcam(true);
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
      showMessage('Camera access denied. Please allow camera permission.', 'error');
      setShowWebcam(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
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
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    setCapturedImage(canvas.toDataURL('image/jpeg', 0.8));
  };

  const submitFaceAction = async () => {
    if (!capturedImage) return;
    setVerifying(true);
    try {
      if (webcamAction === 'check-in') {
        const { data } = await faceCheckIn({ image: capturedImage });
        showMessage(
          data.is_late
            ? `Checked in at ${formatTime(data.check_in)} — marked LATE (after 9:30 AM)`
            : `Checked in successfully at ${formatTime(data.check_in)}`,
          data.is_late ? 'warning' : 'success'
        );
      } else {
        const { data } = await faceCheckOut({ image: capturedImage });
        const hrs = data.working_hours ? `${data.working_hours}h worked` : '';
        const ot = data.overtime_hours ? ` (${data.overtime_hours}h overtime)` : '';
        showMessage(`Checked out at ${formatTime(data.check_out)} — ${hrs}${ot}`);
      }
      getMyAttendance().then(({ data }) => setAttendance(data));
      getTodayStatus().then(({ data }) => setTodayStatus(data)).catch(() => {});
      closeWebcam();
    } catch (err) {
      showMessage(err.response?.data?.error || 'Face not recognized. Verification failed.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleCheckIn = () => openWebcam('check-in');
  const handleCheckOut = () => openWebcam('check-out');

  return (
    <div>
      {msg && (
        <div className={`att-msg ${msgType}`} style={{ marginBottom: 16 }}>
          {msg}
          <button className="att-msg-close" onClick={() => setMsg('')}>✕</button>
        </div>
      )}

      {/* Welcome Banner */}
      <div className="welcome-banner">
        <div className="welcome-banner-content">
          <p className="welcome-greeting">{getGreeting()}</p>
          <h1 className="welcome-name">{user?.name}</h1>
          <p className="welcome-platform">Welcome to WorkNet — Your corporate workspace by Aaryak Solution</p>
          <p className="welcome-subtitle">
            You have <strong>{pendingTasks + inProgressTasks}</strong> active tasks
            and <strong>{pendingLeaves}</strong> pending leave requests. Have a productive day!
          </p>
          <div className="welcome-actions">
            <button
              className="welcome-action-btn primary"
              onClick={handleCheckIn}
              disabled={!!todayAtt?.check_in}
            >
              ⏰ {todayAtt?.check_in ? `Checked In · ${formatTime(todayAtt.check_in)}` : 'Check In'}
            </button>
            <button
              className="welcome-action-btn secondary"
              onClick={handleCheckOut}
              disabled={!todayAtt?.check_in || !!todayAtt?.check_out}
            >
              🏠 {todayAtt?.check_out ? `Checked Out · ${formatTime(todayAtt.check_out)}` : 'Check Out'}
            </button>
            <button className="welcome-action-btn secondary" onClick={() => navigate('/tasks')}>
              📝 My Tasks
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions-strip">
        <div className="quick-action-card" onClick={() => navigate('/attendance')}>
          <div className="quick-action-icon accent">⏰</div>
          <div className="quick-action-text">
            <strong>Attendance</strong>
            <span>{todayAtt ? (todayAtt.check_out ? 'Completed' : 'Working') : 'Not checked in'}</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/tasks')}>
          <div className="quick-action-icon warning">📝</div>
          <div className="quick-action-text">
            <strong>Tasks</strong>
            <span>{pendingTasks + inProgressTasks} active</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/leaves')}>
          <div className="quick-action-icon success">🗓️</div>
          <div className="quick-action-text">
            <strong>Leaves</strong>
            <span>{pendingLeaves} pending</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/announcements')}>
          <div className="quick-action-icon purple">📢</div>
          <div className="quick-action-text">
            <strong>News</strong>
            <span>{announcements.length} recent</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-info"><h3>{todayAtt ? (todayAtt.check_out ? 'Done' : 'In') : 'Out'}</h3><p>Today's Status</p></div>
          <div className="stat-icon blue">⏰</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{pendingTasks + inProgressTasks}</h3><p>Active Tasks</p></div>
          <div className="stat-icon yellow">📝</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{pendingLeaves}</h3><p>Pending Leaves</p></div>
          <div className="stat-icon green">🗓️</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{attendance.length}</h3><p>Days Tracked</p></div>
          <div className="stat-icon purple">📊</div>
        </div>
      </div>

      {/* Tasks + Chart/Announcements */}
      <div className="dashboard-grid cols-2">
        <div className="card">
          <div className="card-header">
            <h2>My Tasks</h2>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/tasks')}>View All</button>
          </div>
          <div className="card-body">
            {tasks.length === 0 ? <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No tasks assigned</p> :
              tasks.slice(0, 5).map((t) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <div>
                    <strong style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{t.title}</strong>
                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>Due: {t.due_date || 'N/A'} &middot; By: {t.assigned_by_name}</p>
                  </div>
                  <span className={`badge ${t.status}`}>{t.status.replace('_', ' ')}</span>
                </div>
              ))}
          </div>
        </div>

        {taskData.length > 0 ? (
          <div className="chart-card">
            <h3>Task Distribution</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={taskData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {taskData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <h2>News & Updates</h2>
              <button className="btn btn-outline btn-sm" onClick={() => navigate('/announcements')}>View All</button>
            </div>
            <div className="card-body">
              {announcements.map((a) => (
                <div key={a.id} className="news-feed-item">
                  <div className={`news-feed-dot ${a.priority || 'normal'}`}></div>
                  <div className="news-feed-content">
                    <strong>{a.title}</strong>
                    <p>{a.content?.slice(0, 80)}...</p>
                    <div className="news-feed-meta">
                      {a.created_by_name || 'Admin'} &middot; {new Date(a.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
              {announcements.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No announcements</p>}
            </div>
          </div>
        )}
      </div>

      {/* Webcam Modal for Face Verification */}
      {showWebcam && (
        <div className="modal-overlay" onClick={closeWebcam}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ marginBottom: 4 }}>
              {webcamAction === 'check-in' ? '🟢 Face Check-In' : '🔴 Face Check-Out'}
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
                  disabled={!cameraReady || verifying}>
                  Capture
                </button>
              ) : (
                <>
                  <button className="btn btn-outline" onClick={() => setCapturedImage(null)} disabled={verifying}>Retake</button>
                  <button className="btn btn-primary" onClick={submitFaceAction} disabled={verifying}>
                    {verifying ? 'Verifying...' : 'Confirm'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
