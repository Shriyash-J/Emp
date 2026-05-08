import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getAnalyticsOverview, getMyAnalytics, getAnalyticsEmployees } from '../services/api';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Pie, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

const CHART_COLORS = {
  indigo: '#6366f1',
  purple: '#a855f7',
  cyan: '#06b6d4',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
  pink: '#ec4899',
};

const chartOptions = (title) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        color: 'var(--text-secondary)',
        padding: 16,
        usePointStyle: true,
        font: { size: 12 },
      },
    },
    title: {
      display: !!title,
      text: title,
      color: 'var(--text-primary)',
      font: { size: 15, weight: '600' },
      padding: { bottom: 16 },
    },
    tooltip: {
      backgroundColor: 'rgba(0,0,0,.8)',
      titleFont: { size: 13 },
      bodyFont: { size: 12 },
      padding: 10,
      cornerRadius: 8,
    },
  },
  scales: title?.includes('Bar') || title?.includes('Performance') || title?.includes('Priority')
    ? {
        x: {
          ticks: { color: 'var(--text-tertiary)', font: { size: 11 } },
          grid: { display: false },
        },
        y: {
          ticks: { color: 'var(--text-tertiary)', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,.06)' },
          beginAtZero: true,
        },
      }
    : undefined,
});

export default function AnalyticsDashboard() {
  const { user } = useAuth();
  const isPrivileged = ['admin', 'hr', 'manager'].includes(user?.role);
  const [overview, setOverview] = useState(null);
  const [myData, setMyData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Employee filter (admin/hr/manager only)
  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const searchRef = useRef(null);

  // Initial load: personal + overview + employee list
  useEffect(() => {
    const promises = [getMyAnalytics().then(({ data }) => setMyData(data)).catch(() => {})];
    if (isPrivileged) {
      promises.push(getAnalyticsOverview().then(({ data }) => setOverview(data)).catch(() => {}));
      promises.push(getAnalyticsEmployees().then(({ data }) => setEmployees(data)).catch(() => {}));
    }
    Promise.all(promises).finally(() => setLoading(false));
  }, [isPrivileged]);

  // Re-fetch overview whenever selected employee changes (skips initial null load)
  const firstRun = useRef(true);
  useEffect(() => {
    if (!isPrivileged) return;
    if (firstRun.current) { firstRun.current = false; return; }
    setOverviewLoading(true);
    const params = selectedEmployeeId ? { employee_id: selectedEmployeeId } : undefined;
    getAnalyticsOverview(params)
      .then(({ data }) => setOverview(data))
      .catch(() => {})
      .finally(() => setOverviewLoading(false));
  }, [selectedEmployeeId, isPrivileged]);

  // Close the dropdown when clicking outside
  useEffect(() => {
    const onClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees.slice(0, 50);
    return employees
      .filter(e =>
        e.name?.toLowerCase().includes(q) ||
        e.department?.toLowerCase().includes(q) ||
        e.position?.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [employees, search]);

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId) || null;

  if (loading) return <div className="empty-state"><p>Loading analytics...</p></div>;

  const taskSource = isPrivileged && overview ? overview.task_status : myData?.task_status;

  // ── Chart Data ──────────────────────────────────────────────
  const taskStatusData = {
    labels: ['Pending', 'In Progress', 'Completed'],
    datasets: [{
      data: [taskSource?.pending || 0, taskSource?.in_progress || 0, taskSource?.completed || 0],
      backgroundColor: [CHART_COLORS.amber, CHART_COLORS.indigo, CHART_COLORS.green],
      borderWidth: 0,
      borderRadius: 6,
    }],
  };

  const attSource = isPrivileged && overview ? overview.attendance : myData?.attendance;
  const attendanceData = {
    labels: isPrivileged
      ? ['Present', 'Absent', 'Late', 'Half Day', 'On Leave']
      : ['Present', 'Absent', 'Late', 'On Time'],
    datasets: [{
      data: isPrivileged
        ? [attSource?.present || 0, attSource?.absent || 0, attSource?.late || 0, attSource?.half_day || 0, attSource?.on_leave || 0]
        : [attSource?.present || 0, attSource?.absent || 0, attSource?.late || 0, attSource?.on_time || 0],
      backgroundColor: isPrivileged
        ? [CHART_COLORS.green, CHART_COLORS.red, CHART_COLORS.amber, CHART_COLORS.cyan, CHART_COLORS.purple]
        : [CHART_COLORS.green, CHART_COLORS.red, CHART_COLORS.amber, CHART_COLORS.indigo],
      borderWidth: 0,
    }],
  };

  const performanceData = overview?.employee_performance?.length > 0
    ? {
        labels: overview.employee_performance.map(p => p.employee_name),
        datasets: [
          {
            label: 'Rating (1-5)',
            data: overview.employee_performance.map(p => p.rating),
            backgroundColor: CHART_COLORS.indigo,
            borderRadius: 6,
          },
          {
            label: 'Goals Met (%)',
            data: overview.employee_performance.map(p => p.goals_met / 20), // scale 0-100 to 0-5
            backgroundColor: CHART_COLORS.cyan,
            borderRadius: 6,
          },
        ],
      }
    : null;

  const myPerfData = myData?.performance?.length > 0
    ? {
        labels: myData.performance.map(p => p.review_period),
        datasets: [
          {
            label: 'Rating',
            data: myData.performance.map(p => p.rating),
            backgroundColor: CHART_COLORS.indigo,
            borderRadius: 6,
          },
          {
            label: 'Goals Met (scaled)',
            data: myData.performance.map(p => p.goals_met / 20),
            backgroundColor: CHART_COLORS.green,
            borderRadius: 6,
          },
        ],
      }
    : null;

  const priorityData = overview?.task_priority
    ? {
        labels: ['Low', 'Medium', 'High'],
        datasets: [{
          data: [overview.task_priority.low || 0, overview.task_priority.medium || 0, overview.task_priority.high || 0],
          backgroundColor: [CHART_COLORS.green, CHART_COLORS.amber, CHART_COLORS.red],
          borderWidth: 0,
        }],
      }
    : null;

  const deptData = overview?.departments?.length > 0
    ? {
        labels: overview.departments.map(d => d.department),
        datasets: [{
          label: 'Employees',
          data: overview.departments.map(d => d.count),
          backgroundColor: [CHART_COLORS.indigo, CHART_COLORS.purple, CHART_COLORS.cyan, CHART_COLORS.green, CHART_COLORS.amber, CHART_COLORS.pink, CHART_COLORS.red, CHART_COLORS.blue],
          borderRadius: 6,
        }],
      }
    : null;

  return (
    <div>
      <div className="welcome-banner" style={{ marginBottom: 24 }}>
        <div className="welcome-banner-content">
          <h1 className="welcome-name">Analytics Dashboard</h1>
          <p className="welcome-subtitle">
            {!isPrivileged
              ? 'Your personal task, attendance, and performance analytics.'
              : selectedEmployee
                ? `Viewing analytics for ${selectedEmployee.name}${selectedEmployee.department ? ` · ${selectedEmployee.department}` : ''}`
                : 'Organization-wide analytics with task, attendance, and performance insights.'}
          </p>
        </div>
      </div>

      {isPrivileged && (
        <div
          ref={searchRef}
          style={{ position: 'relative', maxWidth: 420, marginBottom: 20 }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={selectedEmployee && !searchOpen ? selectedEmployee.name : search}
              onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
              onFocus={() => { setSearchOpen(true); if (selectedEmployee) setSearch(''); }}
              placeholder="Search employee by name, department, or position..."
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--border-color, #333)',
                background: 'var(--bg-secondary, #1a1a1a)',
                color: 'var(--text-primary, #fff)', fontSize: 14,
              }}
            />
            {selectedEmployeeId && (
              <button
                type="button"
                onClick={() => { setSelectedEmployeeId(null); setSearch(''); setSearchOpen(false); }}
                style={{
                  padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-color, #333)',
                  background: 'transparent', color: 'var(--text-primary, #fff)',
                  cursor: 'pointer', fontSize: 13,
                }}
                title="Clear filter and show company-wide analytics"
              >
                Clear
              </button>
            )}
          </div>

          {searchOpen && filteredEmployees.length > 0 && (
            <div
              style={{
                position: 'absolute', top: '100%', left: 0, right: selectedEmployeeId ? 80 : 0,
                marginTop: 4, maxHeight: 280, overflowY: 'auto', zIndex: 20,
                background: 'var(--bg-secondary, #1a1a1a)',
                border: '1px solid var(--border-color, #333)',
                borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,.3)',
              }}
            >
              {filteredEmployees.map(emp => (
                <div
                  key={emp.id}
                  onClick={() => {
                    setSelectedEmployeeId(emp.id);
                    setSearch('');
                    setSearchOpen(false);
                  }}
                  style={{
                    padding: '10px 12px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border-color, #2a2a2a)',
                    color: 'var(--text-primary, #fff)', fontSize: 13,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(99,102,241,.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ fontWeight: 600 }}>{emp.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary, #888)' }}>
                    {[emp.position, emp.department].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
          {overviewLoading && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #888)', marginTop: 6 }}>
              Updating charts…
            </div>
          )}
        </div>
      )}

      {/* Row 1: Task Status + Attendance */}
      <div className="analytics-grid">
        <div className="analytics-chart-card">
          <h3 className="analytics-chart-title">Task Overview</h3>
          <div className="analytics-chart-body">
            <Bar data={taskStatusData} options={chartOptions()} />
          </div>
          <div className="analytics-chart-footer">
            <span className="analytics-stat"><span className="analytics-dot" style={{ background: CHART_COLORS.amber }}></span>Pending: {taskSource?.pending || 0}</span>
            <span className="analytics-stat"><span className="analytics-dot" style={{ background: CHART_COLORS.indigo }}></span>In Progress: {taskSource?.in_progress || 0}</span>
            <span className="analytics-stat"><span className="analytics-dot" style={{ background: CHART_COLORS.green }}></span>Completed: {taskSource?.completed || 0}</span>
          </div>
        </div>

        <div className="analytics-chart-card">
          <h3 className="analytics-chart-title">
            Attendance {isPrivileged && attSource?.month ? `(${attSource.month})` : '(Last 30 Days)'}
          </h3>
          <div className="analytics-chart-body">
            <Doughnut data={attendanceData} options={chartOptions()} />
          </div>
        </div>
      </div>

      {/* Row 2: Performance + Priority/Dept */}
      <div className="analytics-grid" style={{ marginTop: 20 }}>
        {isPrivileged && performanceData ? (
          <div className="analytics-chart-card">
            <h3 className="analytics-chart-title">Performance Analysis</h3>
            <div className="analytics-chart-body">
              <Bar data={performanceData} options={chartOptions()} />
            </div>
          </div>
        ) : myPerfData ? (
          <div className="analytics-chart-card">
            <h3 className="analytics-chart-title">My Performance Trend</h3>
            <div className="analytics-chart-body">
              <Bar data={myPerfData} options={chartOptions()} />
            </div>
          </div>
        ) : (
          <div className="analytics-chart-card">
            <h3 className="analytics-chart-title">Performance Analysis</h3>
            <div className="analytics-chart-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>No performance reviews available yet.</p>
            </div>
          </div>
        )}

        {isPrivileged && priorityData ? (
          <div className="analytics-chart-card">
            <h3 className="analytics-chart-title">Task Priority Breakdown</h3>
            <div className="analytics-chart-body">
              <Pie data={priorityData} options={chartOptions()} />
            </div>
          </div>
        ) : (
          <div className="analytics-chart-card">
            <h3 className="analytics-chart-title">My Task Distribution</h3>
            <div className="analytics-chart-body">
              <Pie data={taskStatusData} options={chartOptions()} />
            </div>
          </div>
        )}
      </div>

      {/* Row 3: Department chart (admin/hr/manager only) */}
      {isPrivileged && deptData && (
        <div className="analytics-grid" style={{ marginTop: 20 }}>
          <div className="analytics-chart-card" style={{ gridColumn: '1 / -1' }}>
            <h3 className="analytics-chart-title">Department Headcount</h3>
            <div className="analytics-chart-body">
              <Bar data={deptData} options={chartOptions()} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
