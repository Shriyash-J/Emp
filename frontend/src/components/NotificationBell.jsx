import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getNotifications,
  getNotificationUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from '../services/api';

const POLL_INTERVAL_MS = 15000;
const CATEGORY_ICONS = {
  leave: '🗓️',
  task: '📝',
  announcement: '📢',
  attendance: '⏰',
  payroll: '💰',
  message: '💬',
  general: '🔔',
};

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef(null);
  const navigate = useNavigate();

  const refreshCount = useCallback(async () => {
    try {
      const { data } = await getNotificationUnreadCount();
      setUnread(data.unread_count || 0);
    } catch {
      // Endpoint may be unavailable briefly during deploy — keep last value.
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getNotifications({ limit: 30 });
      setItems(data.notifications || []);
      setUnread(data.unread_count || 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll the unread count in the background so the red dot stays accurate
  // even when the dropdown is closed.
  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshCount]);

  // Fetch the full list only when the dropdown opens, to keep idle traffic low.
  useEffect(() => {
    if (open) loadList();
  }, [open, loadList]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleItemClick = async (n) => {
    if (!n.is_read) {
      try {
        await markNotificationRead(n.id);
        setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, is_read: true } : it)));
        setUnread((u) => Math.max(0, u - 1));
      } catch {
        // Non-fatal — navigation still happens.
      }
    }
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  const handleMarkAll = async () => {
    if (unread === 0) return;
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((it) => ({ ...it, is_read: true })));
      setUnread(0);
    } catch {
      // Ignore — user can retry.
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    try {
      await deleteNotification(id);
      const wasUnread = items.find((it) => it.id === id && !it.is_read);
      setItems((prev) => prev.filter((it) => it.id !== id));
      if (wasUnread) setUnread((u) => Math.max(0, u - 1));
    } catch {
      // Ignore.
    }
  };

  return (
    <div className="corp-notif-wrapper" ref={wrapperRef}>
      <button
        className="corp-icon-btn corp-notif-btn"
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
      >
        🔔
        {unread > 0 && (
          <span className="corp-notif-badge">{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="corp-notif-panel" role="dialog" aria-label="Notifications">
          <div className="corp-notif-header">
            <strong>Notifications</strong>
            <button
              className="corp-notif-mark-all"
              onClick={handleMarkAll}
              disabled={unread === 0}
            >
              Mark all read
            </button>
          </div>

          <div className="corp-notif-list">
            {loading && items.length === 0 ? (
              <div className="corp-notif-empty">Loading…</div>
            ) : items.length === 0 ? (
              <div className="corp-notif-empty">
                <div style={{ fontSize: 28, marginBottom: 6 }}>🔕</div>
                You’re all caught up.
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={`corp-notif-item ${n.is_read ? '' : 'unread'}`}
                  onClick={() => handleItemClick(n)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleItemClick(n);
                    }
                  }}
                >
                  <div className="corp-notif-icon">
                    {CATEGORY_ICONS[n.category] || CATEGORY_ICONS.general}
                  </div>
                  <div className="corp-notif-body">
                    <div className="corp-notif-title">{n.title}</div>
                    {n.body && <div className="corp-notif-text">{n.body}</div>}
                    <div className="corp-notif-time">{timeAgo(n.created_at)}</div>
                  </div>
                  <button
                    className="corp-notif-delete"
                    onClick={(e) => handleDelete(e, n.id)}
                    title="Dismiss"
                    aria-label="Dismiss notification"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
