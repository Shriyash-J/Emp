import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getEmployees, getAllLeaves, getAnnouncements, getRecruitmentStats, getExitStats } from '../services/api';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#f59e0b', '#10b981', '#ef4444'];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HRDashboard() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [recruitStats, setRecruitStats] = useState(null);
  const [exitStats, setExitStats] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    getEmployees({}).then(({ data }) => setEmployees(data)).catch(() => {});
    getAllLeaves({}).then(({ data }) => setLeaves(data)).catch(() => {});
    getAnnouncements().then(({ data }) => setAnnouncements(data.slice(0, 4))).catch(() => {});
    getRecruitmentStats().then(({ data }) => setRecruitStats(data)).catch(() => {});
    getExitStats().then(({ data }) => setExitStats(data)).catch(() => {});
  }, []);

  const activeCount = employees.filter(e => e.status === 'active').length;
  const deptSet = new Set(employees.map(e => e.department).filter(Boolean));
  const pendingLeaves = leaves.filter(l => l.status === 'pending');
  const approvedLeaves = leaves.filter(l => l.status === 'approved');
  const rejectedLeaves = leaves.filter(l => l.status === 'rejected');

  const leaveData = [
    { name: 'Pending', value: pendingLeaves.length },
    { name: 'Approved', value: approvedLeaves.length },
    { name: 'Rejected', value: rejectedLeaves.length },
  ].filter(d => d.value > 0);

  return (
    <div>
      {/* Welcome Banner */}
      <div className="welcome-banner">
        <div className="welcome-banner-content">
          <p className="welcome-greeting">{getGreeting()}</p>
          <h1 className="welcome-name">{user?.name}</h1>
          <p className="welcome-platform">Welcome to WorkNet — Your corporate workspace by Aaryak Solution</p>
          <p className="welcome-subtitle">
            You're managing <strong>{employees.length}</strong> employees across <strong>{deptSet.size}</strong> departments.
            {pendingLeaves.length > 0 && <> There are <strong>{pendingLeaves.length}</strong> pending leave requests.</>}
          </p>
          <div className="welcome-actions">
            <button className="welcome-action-btn primary" onClick={() => navigate('/employees')}>👥 Manage People</button>
            <button className="welcome-action-btn secondary" onClick={() => navigate('/recruitment')}>🎯 Recruitment</button>
            <button className="welcome-action-btn secondary" onClick={() => navigate('/letters')}>📄 Letters</button>
            <button className="welcome-action-btn secondary" onClick={() => navigate('/announcements')}>📢 Post News</button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions-strip">
        <div className="quick-action-card" onClick={() => navigate('/employees')}>
          <div className="quick-action-icon accent">👥</div>
          <div className="quick-action-text">
            <strong>People</strong>
            <span>{employees.length} total</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/recruitment')}>
          <div className="quick-action-icon warning">🎯</div>
          <div className="quick-action-text">
            <strong>Recruitment</strong>
            <span>{recruitStats?.total || 0} candidates</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/letters')}>
          <div className="quick-action-icon success">📄</div>
          <div className="quick-action-text">
            <strong>Letters</strong>
            <span>Issue & manage</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/performance')}>
          <div className="quick-action-icon purple">⭐</div>
          <div className="quick-action-text">
            <strong>Performance</strong>
            <span>View reviews</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/exit-management')}>
          <div className="quick-action-icon" style={{background: '#ffebee', color: '#f44336'}}>🚪</div>
          <div className="quick-action-text">
            <strong>Exits</strong>
            <span>{exitStats?.by_status?.initiated || 0} pending</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/attendance')}>
          <div className="quick-action-icon success">⏰</div>
          <div className="quick-action-text">
            <strong>Attendance</strong>
            <span>View reports</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-info"><h3>{employees.length}</h3><p>Total Employees</p></div>
          <div className="stat-icon blue">👥</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{activeCount}</h3><p>Active Employees</p></div>
          <div className="stat-icon green">✅</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{pendingLeaves.length}</h3><p>Pending Leaves</p></div>
          <div className="stat-icon yellow">🗓️</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{deptSet.size}</h3><p>Departments</p></div>
          <div className="stat-icon purple">🏢</div>
        </div>
      </div>

      {/* Leave Requests + Chart */}
      <div className="dashboard-grid cols-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="card-header">
            <h2>Pending Leave Requests</h2>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/leaves')}>View All</button>
          </div>
          <div className="card-body">
            {pendingLeaves.length === 0 ? <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No pending requests</p> :
              pendingLeaves.slice(0, 5).map((l) => (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-light)' }}>
                  <div>
                    <strong style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{l.employee_name}</strong>
                    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{l.leave_type} &middot; {l.start_date} to {l.end_date}</p>
                  </div>
                  <span className="badge pending">Pending</span>
                </div>
              ))}
          </div>
        </div>

        {leaveData.length > 0 && (
          <div className="chart-card">
            <h3>Leave Status Overview</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={leaveData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {leaveData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Employees + News */}
      <div className="dashboard-grid cols-2">
        <div className="card">
          <div className="card-header">
            <h2>Recent Employees</h2>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/employees')}>Manage</button>
          </div>
          <table>
            <thead>
              <tr><th>Name</th><th>Department</th><th>Position</th><th>Status</th></tr>
            </thead>
            <tbody>
              {employees.slice(0, 6).map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.name}</strong></td>
                  <td>{e.department}</td>
                  <td>{e.position}</td>
                  <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>News & Updates</h2>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/announcements')}>View All</button>
          </div>
          <div className="card-body">
            {announcements.length === 0 && <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No announcements</p>}
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
          </div>
        </div>
      </div>
    </div>
  );
}
