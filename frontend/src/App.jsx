import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import AdminSetup from './pages/AdminSetup';
import Layout from './components/Layout';
import AdminDashboard from './pages/AdminDashboard';
import HRDashboard from './pages/HRDashboard';
import EmployeeDashboard from './pages/EmployeeDashboard';
import EmployeeList from './pages/EmployeeList';
import ActivityLogs from './pages/ActivityLogs';
import AttendancePage from './pages/AttendancePage';
import LeavePage from './pages/LeavePage';
import TasksPage from './pages/TasksPage';
import AnnouncementsPage from './pages/AnnouncementsPage';
import PayrollPage from './pages/PayrollPage';
import LettersPage from './pages/LettersPage';
import RecruitmentPage from './pages/RecruitmentPage';
import PerformancePage from './pages/PerformancePage';
import ExitManagementPage from './pages/ExitManagementPage';
import TeamsPage from './pages/TeamsPage';
import DepartmentsPage from './pages/DepartmentsPage';
import SettingsPage from './pages/SettingsPage';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import MessagingPage from './pages/MessagingPage';
import CreateUser from './pages/CreateUser';

function ProtectedRoute({ children, roles }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user?.role)) {
    // Redirect to role-specific dashboard if unauthorized
    const dashboardPath = `/${user?.role}/dashboard`;
    return <Navigate to={dashboardPath} replace />;
  }
  return children;
}

// Redirect "/" or "/dashboard" to the correct role-based dashboard
function DashboardRedirect() {
  const { user } = useAuth();
  const role = user?.role || 'employee';
  return <Navigate to={`/${role}/dashboard`} replace />;
}

export default function App() {
  const { isAuthenticated } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <DashboardRedirect /> : <Login />} />
      <Route path="/admin-setup" element={isAuthenticated ? <DashboardRedirect /> : <AdminSetup />} />
      <Route path="/register" element={<Navigate to="/login" replace />} />

      {/* All authenticated routes under Layout */}
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<DashboardRedirect />} />
        <Route path="dashboard" element={<DashboardRedirect />} />

        {/* ── Admin routes (/admin/*) ── */}
        <Route path="admin/dashboard" element={<ProtectedRoute roles={['admin']}><AdminDashboard /></ProtectedRoute>} />
        <Route path="admin/create-user" element={<ProtectedRoute roles={['admin']}><CreateUser /></ProtectedRoute>} />
        <Route path="admin/employees" element={<ProtectedRoute roles={['admin']}><EmployeeList /></ProtectedRoute>} />
        <Route path="admin/activity" element={<ProtectedRoute roles={['admin']}><ActivityLogs /></ProtectedRoute>} />
        <Route path="admin/departments" element={<ProtectedRoute roles={['admin']}><DepartmentsPage /></ProtectedRoute>} />
        <Route path="admin/settings" element={<ProtectedRoute roles={['admin']}><SettingsPage /></ProtectedRoute>} />
        <Route path="admin/payroll" element={<ProtectedRoute roles={['admin']}><PayrollPage /></ProtectedRoute>} />
        <Route path="admin/analytics" element={<ProtectedRoute roles={['admin']}><AnalyticsDashboard /></ProtectedRoute>} />
        <Route path="admin/messaging" element={<ProtectedRoute roles={['admin']}><MessagingPage /></ProtectedRoute>} />
        <Route path="admin/announcements" element={<ProtectedRoute roles={['admin']}><AnnouncementsPage /></ProtectedRoute>} />

        {/* ── HR routes (/hr/*) ── */}
        <Route path="hr/dashboard" element={<ProtectedRoute roles={['hr']}><HRDashboard /></ProtectedRoute>} />
        <Route path="hr/create-user" element={<ProtectedRoute roles={['hr']}><CreateUser /></ProtectedRoute>} />
        <Route path="hr/employees" element={<ProtectedRoute roles={['hr']}><EmployeeList /></ProtectedRoute>} />
        <Route path="hr/recruitment" element={<ProtectedRoute roles={['hr']}><RecruitmentPage /></ProtectedRoute>} />
        <Route path="hr/attendance" element={<ProtectedRoute roles={['hr']}><AttendancePage /></ProtectedRoute>} />
        <Route path="hr/leaves" element={<ProtectedRoute roles={['hr']}><LeavePage /></ProtectedRoute>} />
        <Route path="hr/letters" element={<ProtectedRoute roles={['hr']}><LettersPage /></ProtectedRoute>} />
        <Route path="hr/performance" element={<ProtectedRoute roles={['hr']}><PerformancePage /></ProtectedRoute>} />
        <Route path="hr/exit-management" element={<ProtectedRoute roles={['hr']}><ExitManagementPage /></ProtectedRoute>} />
        <Route path="hr/analytics" element={<ProtectedRoute roles={['hr']}><AnalyticsDashboard /></ProtectedRoute>} />
        <Route path="hr/messaging" element={<ProtectedRoute roles={['hr']}><MessagingPage /></ProtectedRoute>} />
        <Route path="hr/announcements" element={<ProtectedRoute roles={['hr']}><AnnouncementsPage /></ProtectedRoute>} />

        {/* ── Manager routes (/manager/*) ── */}
        <Route path="manager/dashboard" element={<ProtectedRoute roles={['manager']}><EmployeeDashboard /></ProtectedRoute>} />
        <Route path="manager/teams" element={<ProtectedRoute roles={['manager']}><TeamsPage /></ProtectedRoute>} />
        <Route path="manager/employees" element={<ProtectedRoute roles={['manager']}><EmployeeList /></ProtectedRoute>} />
        <Route path="manager/attendance" element={<ProtectedRoute roles={['manager']}><AttendancePage /></ProtectedRoute>} />
        <Route path="manager/leaves" element={<ProtectedRoute roles={['manager']}><LeavePage /></ProtectedRoute>} />
        <Route path="manager/performance" element={<ProtectedRoute roles={['manager']}><PerformancePage /></ProtectedRoute>} />
        <Route path="manager/letters" element={<ProtectedRoute roles={['manager']}><LettersPage /></ProtectedRoute>} />
        <Route path="manager/tasks" element={<ProtectedRoute roles={['manager']}><TasksPage /></ProtectedRoute>} />
        <Route path="manager/analytics" element={<ProtectedRoute roles={['manager']}><AnalyticsDashboard /></ProtectedRoute>} />
        <Route path="manager/messaging" element={<ProtectedRoute roles={['manager']}><MessagingPage /></ProtectedRoute>} />
        <Route path="manager/announcements" element={<ProtectedRoute roles={['manager']}><AnnouncementsPage /></ProtectedRoute>} />

        {/* ── Employee routes (/employee/*) ── */}
        <Route path="employee/dashboard" element={<ProtectedRoute roles={['employee']}><EmployeeDashboard /></ProtectedRoute>} />
        <Route path="employee/teams" element={<ProtectedRoute roles={['employee']}><TeamsPage /></ProtectedRoute>} />
        <Route path="employee/attendance" element={<ProtectedRoute roles={['employee']}><AttendancePage /></ProtectedRoute>} />
        <Route path="employee/leaves" element={<ProtectedRoute roles={['employee']}><LeavePage /></ProtectedRoute>} />
        <Route path="employee/payroll" element={<ProtectedRoute roles={['employee']}><PayrollPage /></ProtectedRoute>} />
        <Route path="employee/performance" element={<ProtectedRoute roles={['employee']}><PerformancePage /></ProtectedRoute>} />
        <Route path="employee/letters" element={<ProtectedRoute roles={['employee']}><LettersPage /></ProtectedRoute>} />
        <Route path="employee/tasks" element={<ProtectedRoute roles={['employee']}><TasksPage /></ProtectedRoute>} />
        <Route path="employee/analytics" element={<ProtectedRoute roles={['employee']}><AnalyticsDashboard /></ProtectedRoute>} />
        <Route path="employee/messaging" element={<ProtectedRoute roles={['employee']}><MessagingPage /></ProtectedRoute>} />
        <Route path="employee/announcements" element={<ProtectedRoute roles={['employee']}><AnnouncementsPage /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
