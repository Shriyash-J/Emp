import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAdminDashboard } from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#6366f1', '#a855f7', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];
const ROLE_COLORS = { admin: '#ef4444', hr: '#a855f7', manager: '#06b6d4', employee: '#10b981' };

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminDashboard()
      .then(({ data }) => { setData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state"><p>Loading admin dashboard...</p></div>;
  if (!data) return <div className="empty-state"><p>Failed to load dashboard.</p></div>;

  const deptData = (data.department_counts || []).map(d => ({ name: d.department, value: d.count }));
  const roleData = Object.entries(data.role_distribution || {}).map(([role, count]) => ({ name: role, value: count }));

  return (
    <div>
      {/* Welcome Banner */}
      <div className="welcome-banner">
        <div className="welcome-banner-content">
          <p className="welcome-greeting">{getGreeting()}</p>
          <h1 className="welcome-name">{user?.name}</h1>
          <p className="welcome-platform">Admin Control Center — Aaryak Solution</p>
          <p className="welcome-subtitle">
            <strong>{data.active_users}</strong> active users across <strong>{data.departments_total}</strong> departments.
            {data.payroll_month && <> Payroll cost for {data.payroll_month}: <strong>INR {data.total_payroll_cost?.toLocaleString()}</strong>.</>}
            {' '}<strong>{data.today_activities}</strong> audit events today.
          </p>
          <div className="welcome-actions">
            <button className="welcome-action-btn primary" onClick={() => navigate('/employees')}>👥 User Management</button>
            <button className="welcome-action-btn secondary" onClick={() => navigate('/payroll')}>💰 Payroll</button>
            <button className="welcome-action-btn secondary" onClick={() => navigate('/departments')}>🏢 Organization</button>
            <button className="welcome-action-btn secondary" onClick={() => navigate('/activity')}>📋 Audit Logs</button>
          </div>
        </div>
      </div>

      {/* Quick Actions — Admin-specific only */}
      <div className="quick-actions-strip">
        <div className="quick-action-card" onClick={() => navigate('/employees')}>
          <div className="quick-action-icon accent">👥</div>
          <div className="quick-action-text">
            <strong>Users</strong>
            <span>{data.total_users} total, {data.active_users} active</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/payroll')}>
          <div className="quick-action-icon warning">💰</div>
          <div className="quick-action-text">
            <strong>Payroll</strong>
            <span>INR {(data.total_payroll_cost || 0).toLocaleString()}</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/departments')}>
          <div className="quick-action-icon purple">🏢</div>
          <div className="quick-action-text">
            <strong>Departments</strong>
            <span>{data.departments_total} active</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/activity')}>
          <div className="quick-action-icon success">📋</div>
          <div className="quick-action-text">
            <strong>Audit</strong>
            <span>{data.today_activities} today</span>
          </div>
        </div>
        <div className="quick-action-card" onClick={() => navigate('/settings')}>
          <div className="quick-action-icon" style={{background:'#e3f2fd',color:'#1565c0'}}>⚙️</div>
          <div className="quick-action-text">
            <strong>Settings</strong>
            <span>{data.config_count} configs</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-info"><h3>{data.total_users}</h3><p>Total Users</p></div>
          <div className="stat-icon blue">👥</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{data.active_users}</h3><p>Active</p></div>
          <div className="stat-icon green">✅</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{data.inactive_users}</h3><p>Inactive</p></div>
          <div className="stat-icon red">🚫</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>{data.departments_total}</h3><p>Departments</p></div>
          <div className="stat-icon purple">🏢</div>
        </div>
        <div className="stat-card">
          <div className="stat-info"><h3>INR {((data.total_payroll_cost || 0) / 100000).toFixed(1)}L</h3><p>Payroll Cost</p></div>
          <div className="stat-icon yellow">💰</div>
        </div>
      </div>

      {/* Charts */}
      <div className="dashboard-grid cols-2" style={{ marginBottom: 20 }}>
        <div className="chart-card">
          <h3>Headcount by Department</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={deptData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} />
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {deptData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Role Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={roleData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value"
                label={({ name, value }) => `${name}: ${value}`}>
                {roleData.map((entry, i) => <Cell key={i} fill={ROLE_COLORS[entry.name] || COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Audit Trail */}
      <div className="card">
        <div className="card-header">
          <h2>Recent Audit Trail</h2>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('/activity')}>View All</button>
        </div>
        <div className="card-body">
          <ul className="activity-list">
            {(data.recent_audit || []).map((a) => (
              <li key={a.id} className="activity-item">
                <div className="activity-dot"></div>
                <div className="activity-content">
                  <p><strong>{a.user_name || 'System'}</strong> ({a.user_role}) — {a.description}</p>
                  <small>{a.action} | {a.module} | {a.ip_address} | {new Date(a.timestamp).toLocaleString()}</small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
