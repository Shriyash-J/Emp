import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Chatbot from './Chatbot';
import NotificationBell from './NotificationBell';

// Two-row navbar: `primary` shows on the first row, `secondary` on the row below.
// Everything else (permissions, functionality) is untouched.
const navItems = {
  admin: {
    primary: [
      { path: '/admin/dashboard', label: 'Home', icon: '🏠' },
      { path: '/admin/employees', label: 'Users', icon: '👥' },
      { path: '/admin/analytics', label: 'Analytics', icon: '📊' },
      { path: '/admin/messaging', label: 'Chat', icon: '💬' },
      { path: '/admin/settings', label: 'Settings', icon: '⚙️' },
    ],
    secondary: [
      { path: '/admin/create-user', label: 'Add HR', icon: '➕' },
      { path: '/admin/payroll', label: 'Payroll', icon: '💰' },
      { path: '/admin/departments', label: 'Org', icon: '🏢' },
      { path: '/admin/activity', label: 'Audit', icon: '📋' },
      { path: '/admin/announcements', label: 'News', icon: '📢' },
    ],
  },
  hr: {
    primary: [
      { path: '/hr/dashboard', label: 'Home', icon: '🏠' },
      { path: '/hr/employees', label: 'People', icon: '👥' },
      { path: '/hr/analytics', label: 'Analytics', icon: '📊' },
      { path: '/hr/messaging', label: 'Chat', icon: '💬' },
    ],
    secondary: [
      { path: '/hr/create-user', label: 'Add User', icon: '➕' },
      { path: '/hr/recruitment', label: 'Recruit', icon: '🎯' },
      { path: '/hr/attendance', label: 'Attendance', icon: '⏰' },
      { path: '/hr/leaves', label: 'Leaves', icon: '🗓️' },
      { path: '/hr/letters', label: 'Letters', icon: '📄' },
      { path: '/hr/performance', label: 'Reviews', icon: '⭐' },
      { path: '/hr/exit-management', label: 'Exits', icon: '🚪' },
      { path: '/hr/announcements', label: 'News', icon: '📢' },
    ],
  },
  manager: {
    primary: [
      { path: '/manager/dashboard', label: 'Home', icon: '🏠' },
      { path: '/manager/teams', label: 'Teams', icon: '👔' },
      { path: '/manager/analytics', label: 'Analytics', icon: '📊' },
      { path: '/manager/messaging', label: 'Chat', icon: '💬' },
      { path: '/manager/tasks', label: 'Tasks', icon: '📝' },
    ],
    secondary: [
      { path: '/manager/employees', label: 'People', icon: '👥' },
      { path: '/manager/attendance', label: 'Attendance', icon: '⏰' },
      { path: '/manager/leaves', label: 'Leaves', icon: '🗓️' },
      { path: '/manager/performance', label: 'Reviews', icon: '⭐' },
      { path: '/manager/letters', label: 'My Letters', icon: '📄' },
      { path: '/manager/announcements', label: 'News', icon: '📢' },
    ],
  },
  employee: {
    primary: [
      { path: '/employee/dashboard', label: 'Home', icon: '🏠' },
      { path: '/employee/teams', label: 'My Teams', icon: '👔' },
      { path: '/employee/analytics', label: 'Analytics', icon: '📊' },
      { path: '/employee/messaging', label: 'Chat', icon: '💬' },
      { path: '/employee/tasks', label: 'My Tasks', icon: '📝' },
    ],
    secondary: [
      { path: '/employee/attendance', label: 'Attendance', icon: '⏰' },
      { path: '/employee/leaves', label: 'My Leaves', icon: '🗓️' },
      { path: '/employee/payroll', label: 'Payroll', icon: '💰' },
      { path: '/employee/performance', label: 'My Reviews', icon: '⭐' },
      { path: '/employee/letters', label: 'My Letters', icon: '📄' },
      { path: '/employee/announcements', label: 'News', icon: '📢' },
    ],
  },
};

// Map the last segment of the path to a page name (works for any role prefix)
const pageNames = {
  'dashboard': 'Dashboard',
  'create-user': 'Create User',
  'analytics': 'Analytics Dashboard',
  'messaging': 'Messages',
  'employees': 'People',
  'teams': 'Team Management',
  'departments': 'Organization',
  'settings': 'System Settings',
  'activity': 'Audit Logs',
  'attendance': 'Attendance',
  'leaves': 'Leave Management',
  'payroll': 'Payroll',
  'letters': 'Letters',
  'recruitment': 'Recruitment',
  'performance': 'Performance Reviews',
  'exit-management': 'Exit Management',
  'tasks': 'Tasks',
  'announcements': 'News & Announcements',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const roleItems = navItems[user?.role] || navItems.employee;
  const primaryItems = roleItems.primary;
  const secondaryItems = roleItems.secondary;
  // Extract last path segment for page name lookup (e.g., "/admin/dashboard" -> "dashboard")
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const lastSegment = pathSegments[pathSegments.length - 1] || 'dashboard';
  const pageName = pageNames[lastSegment] || 'Dashboard';
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);

  useEffect(() => {
    document.title = `${pageName} | WorkNet`;
  }, [pageName]);

  return (
    <div className="corp-app">
      {/* === TOP NAVBAR === */}
      <header className="corp-topnav">
        <div className="corp-topnav-inner">
          {/* Left: Logo + Brand */}
          <div className="corp-topnav-left">
            <button className="corp-mobile-toggle" onClick={() => setShowMobileNav(!showMobileNav)}>
              ☰
            </button>
            <div className="corp-brand">
              <div className="corp-brand-icon">W</div>
              <div className="corp-brand-text">
                <span className="corp-brand-name">WorkNet</span>
                <span className="corp-brand-tagline">by Aaryak Solution</span>
              </div>
            </div>

            {/* Center: Primary Nav Links (Row 1 only).
                Secondary items are rendered ONLY in the Row 2 strip below,
                except when the mobile hamburger is open — then they expand
                inline so phone users can reach every module. */}
            <nav className={`corp-nav ${showMobileNav ? 'open' : ''}`}>
              {primaryItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `corp-nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setShowMobileNav(false)}
                >
                  <span className="corp-nav-icon">{item.icon}</span>
                  <span className="corp-nav-label">{item.label}</span>
                </NavLink>
              ))}
              {showMobileNav && secondaryItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `corp-nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setShowMobileNav(false)}
                >
                  <span className="corp-nav-icon">{item.icon}</span>
                  <span className="corp-nav-label">{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Right: Actions */}
          <div className="corp-topnav-right">
            <button className="corp-icon-btn" onClick={toggleTheme} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
            <NotificationBell />

            {/* User Avatar + Dropdown */}
            <div className="corp-user-menu-wrapper">
              <button className="corp-user-trigger" onClick={() => setShowUserMenu(!showUserMenu)}>
                <div className="corp-avatar">{user?.name?.charAt(0)}</div>
                <div className="corp-user-brief">
                  <span className="corp-user-name">{user?.name}</span>
                  <span className="corp-user-role">{user?.role}</span>
                </div>
                <span className="corp-chevron">{showUserMenu ? '▲' : '▼'}</span>
              </button>
              {showUserMenu && (
                <div className="corp-user-dropdown">
                  <div className="corp-dropdown-header">
                    <div className="corp-avatar lg">{user?.name?.charAt(0)}</div>
                    <div>
                      <strong>{user?.name}</strong>
                      <span>{user?.email}</span>
                    </div>
                  </div>
                  <div className="corp-dropdown-divider"></div>
                  <button className="corp-dropdown-item" onClick={() => { setShowUserMenu(false); toggleTheme(); }}>
                    {theme === 'light' ? '🌙' : '☀️'} {theme === 'light' ? 'Dark' : 'Light'} Mode
                  </button>
                  <div className="corp-dropdown-divider"></div>
                  <button className="corp-dropdown-item danger" onClick={logout}>
                    🚪 Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* === SECONDARY NAV (Row 2) — desktop/tablet only === */}
        {secondaryItems.length > 0 && (
          <div className="corp-subnav">
            <div className="corp-subnav-inner">
              {secondaryItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `corp-nav-link corp-subnav-link ${isActive ? 'active' : ''}`
                  }
                >
                  <span className="corp-nav-icon">{item.icon}</span>
                  <span className="corp-nav-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Click-away for dropdown */}
      {showUserMenu && <div className="corp-overlay" onClick={() => setShowUserMenu(false)}></div>}

      {/* === MAIN CONTENT === */}
      <main className="corp-main">
        <div className="corp-page-content">
          <Outlet />
        </div>
      </main>

      <Chatbot />

      {/* === FOOTER === */}
      <footer className="corp-footer">
        <div className="corp-footer-inner">
          <span>&copy; 2026 Aaryak Solution. All rights reserved.</span>
          <span className="corp-footer-sep">|</span>
          <span>WorkNet — Internal Employee Platform</span>
        </div>
      </footer>
    </div>
  );
}
