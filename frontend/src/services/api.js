import axios from 'axios';

const API = axios.create({ baseURL: '/api' });

API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

API.interceptors.response.use(
  (res) => res,
  (err) => {
    // Only auto-logout on 403 (expired/invalid token from Node.js backend)
    // Never logout on 401 (wrong credentials during login)
    if (err.response?.status === 403) {
      const msg = err.response?.data?.error || '';
      if (msg.includes('Invalid or expired token')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

// Auth
export const login = (data) => API.post('/auth/login', data);
export const verifyOtp = (data) => API.post('/auth/verify-otp', data);
export const resendOtp = (data) => API.post('/auth/resend-otp', data);
export const getMe = () => API.get('/auth/me');
export const registerUser = (data) => API.post('/auth/register', data);
export const getAdminSetupStatus = () => API.get('/auth/admin-setup-status');
export const adminSetup = (data) => API.post('/auth/admin-setup', data);
export const createUser = (data) => API.post('/auth/create-user', data);

// Employees
export const getEmployees = (params) => API.get('/employees', { params });
export const getEmployee = (id) => API.get(`/employees/${id}`);
export const addEmployee = (data) => API.post('/employees', data);
export const updateEmployee = (id, data) => API.put(`/employees/${id}`, data);
export const deleteEmployee = (id) => API.delete(`/employees/${id}`);
export const getEmployeeAnalytics = (id, params) => API.get(`/employees/${id}/analytics`, { params });

// Activity
export const getActivityLogs = (params) => API.get('/activity', { params });
export const getActivityStats = () => API.get('/activity/stats');

// Attendance
export const checkIn = () => API.post('/attendance/check-in');
export const checkOut = () => API.post('/attendance/check-out');
export const getTodayStatus = () => API.get('/attendance/today');
export const getMyAttendance = (params) => API.get('/attendance/my', { params });
export const getAllAttendance = (params) => API.get('/attendance', { params });
export const getAttendanceSummary = (params) => API.get('/attendance/summary', { params });

// Leaves
export const requestLeave = (data) => API.post('/leaves', data);
export const getMyLeaves = () => API.get('/leaves/my');
export const getAllLeaves = (params) => API.get('/leaves', { params });
export const updateLeave = (id, data) => API.put(`/leaves/${id}`, data);

// Tasks
export const getMyTasks = () => API.get('/tasks/my');
export const getAllTasks = () => API.get('/tasks');
export const createTask = (data) => API.post('/tasks', data);
export const updateTask = (id, data) => API.put(`/tasks/${id}`, data);

// Announcements
export const getAnnouncements = () => API.get('/announcements');
export const createAnnouncement = (data) => API.post('/announcements', data);

// Chat
export const sendChatMessage = (message) => API.post('/chat', { message });
export const getChatHistory = () => API.get('/chat/history');

// Payroll
export const getPayrollConfigs = () => API.get('/payroll/config');
export const getMyPayrollConfig = () => API.get('/payroll/config/my');
export const setPayrollConfig = (userId, data) => API.post(`/payroll/config/${userId}`, data);
export const generatePayroll = (data) => API.post('/payroll/generate', data);
export const getPayrollRecords = (params) => API.get('/payroll/records', { params });
export const getPayrollSlip = (id) => API.get(`/payroll/slip/${id}`);
export const updatePayrollStatus = (id, data) => API.put(`/payroll/records/${id}/status`, data);
export const getHolidays = (params) => API.get('/payroll/holidays', { params });
export const createHoliday = (data) => API.post('/payroll/holidays', data);
export const deleteHoliday = (id) => API.delete(`/payroll/holidays/${id}`);
export const createPaymentOrder = (payrollId) => API.post(`/payroll/pay/${payrollId}`);
export const verifyPayment = (payrollId, data) => API.post(`/payroll/pay/${payrollId}/verify`, data);
export const markPaymentFailed = (payrollId) => API.post(`/payroll/pay/${payrollId}/fail`);
export const getRazorpayKey = () => API.get('/payroll/razorpay-key');

// Face Attendance
export const getFaceStatus = () => API.get('/face-attendance/status');
export const registerFace = (data) => API.post('/face-attendance/register-face', data);
export const faceCheckIn = (data) => API.post('/face-attendance/check-in', data);
export const faceCheckOut = (data) => API.post('/face-attendance/check-out', data);

// Attendance management (Admin)
export const manageAttendance = (data) => API.post('/attendance/manage', data);
export const deleteAttendance = (id) => API.delete(`/attendance/${id}`);

// Letters (HR module)
export const getLetters = (params) => API.get('/letters', { params });
export const getLetter = (id) => API.get(`/letters/${id}`);
export const createLetter = (data) => API.post('/letters', data);
export const downloadLetter = (id) => API.get(`/letters/${id}/download`, { responseType: 'blob' });
export const emailLetter = (id) => API.post(`/letters/${id}/email`);
export const revokeLetter = (id) => API.put(`/letters/${id}/revoke`);
export const getLetterTemplates = () => API.get('/letters/templates');
export const getLetterHistory = (employeeId) => API.get(`/letters/history/${employeeId}`);

// Recruitment (HR module)
export const getCandidates = (params) => API.get('/recruitment/candidates', { params });
export const getCandidate = (id) => API.get(`/recruitment/candidates/${id}`);
export const addCandidate = (data) => API.post('/recruitment/candidates', data);
export const updateCandidate = (id, data) => API.put(`/recruitment/candidates/${id}`, data);
export const deleteCandidate = (id) => API.delete(`/recruitment/candidates/${id}`);
export const getRecruitmentStats = () => API.get('/recruitment/stats');

// Performance
export const getPerformanceRecords = (params) => API.get('/performance', { params });
export const createPerformanceReview = (data) => API.post('/performance', data);
export const addHRComment = (id, data) => API.put(`/performance/${id}/hr-comment`, data);
export const acknowledgeReview = (id) => API.put(`/performance/${id}/acknowledge`);
export const getPerformanceStats = () => API.get('/performance/stats');

// Exit Management (HR module)
export const getExitRecords = (params) => API.get('/exit', { params });
export const initiateExit = (data) => API.post('/exit', data);
export const updateExitRecord = (id, data) => API.put(`/exit/${id}`, data);
export const completeExit = (id) => API.post(`/exit/${id}/complete`);
export const getExitStats = () => API.get('/exit/stats');

// Teams (Manager module)
export const getTeams = () => API.get('/teams');
export const createTeam = (data) => API.post('/teams', data);
export const updateTeam = (id, data) => API.put(`/teams/${id}`, data);
export const deleteTeam = (id) => API.delete(`/teams/${id}`);
export const addTeamMember = (teamId, data) => API.post(`/teams/${teamId}/members`, data);
export const removeTeamMember = (teamId, userId) => API.delete(`/teams/${teamId}/members/${userId}`);
export const getTeamTasks = (teamId) => API.get(`/teams/${teamId}/tasks`);
export const createTeamTask = (teamId, data) => API.post(`/teams/${teamId}/tasks`, data);
export const getMyTeamTasks = () => API.get('/teams/tasks/my');
export const updateTeamTaskProgress = (taskId, data) => API.put(`/teams/tasks/${taskId}/progress`, data);
export const predictTeamTask = (taskId) => API.get(`/teams/tasks/${taskId}/predict`);
export const getTeamStats = () => API.get('/teams/stats');

// Employee deactivation
export const deactivateEmployee = (id) => API.put(`/employees/${id}/deactivate`);
export const reactivateEmployee = (id) => API.put(`/employees/${id}/reactivate`);

// Admin Control Center
export const getAdminDashboard = () => API.get('/admin/dashboard');
export const getDepartments = () => API.get('/admin/departments');
export const createDepartment = (data) => API.post('/admin/departments', data);
export const updateDepartment = (id, data) => API.put(`/admin/departments/${id}`, data);
export const deleteDepartment = (id) => API.delete(`/admin/departments/${id}`);
export const getAdminUsers = (params) => API.get('/admin/users', { params });
export const changeUserRole = (id, data) => API.put(`/admin/users/${id}/role`, data);
export const toggleUserStatus = (id, data) => API.put(`/admin/users/${id}/status`, data);
export const resetUserPassword = (id, data) => API.post(`/admin/users/${id}/reset-password`, data);
export const getSystemSettings = (params) => API.get('/admin/settings', { params });
export const createSetting = (data) => API.post('/admin/settings', data);
export const updateSetting = (key, data) => API.put(`/admin/settings/${key}`, data);
export const deleteSetting = (key) => API.delete(`/admin/settings/${key}`);
export const adjustPayroll = (id, data) => API.put(`/admin/payroll/${id}/adjust`, data);
export const getPayrollSummary = () => API.get('/admin/payroll/summary');

// Analytics
export const getAnalyticsOverview = (params) => API.get('/analytics/overview', { params });
export const getMyAnalytics = () => API.get('/analytics/my');
export const getAnalyticsEmployees = () => API.get('/analytics/employees');

// Internal Messaging
export const getContacts = () => API.get('/messages/contacts');
export const getConversation = (userId, params) => API.get(`/messages/conversation/${userId}`, { params });
export const sendMessage = (data) => API.post('/messages/send', data);
export const getUnreadCount = () => API.get('/messages/unread-count');

// Notifications
export const getNotifications = (params) => API.get('/notifications', { params });
export const getNotificationUnreadCount = () => API.get('/notifications/unread-count');
export const markNotificationRead = (id) => API.post(`/notifications/${id}/read`);
export const markAllNotificationsRead = () => API.post('/notifications/read-all');
export const deleteNotification = (id) => API.delete(`/notifications/${id}`);

export default API;
