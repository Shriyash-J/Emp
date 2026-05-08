// Formatting helpers for attendance timestamps.
// Backend stores check_in / check_out as "HH:MM:SS" in the company timezone
// (see backend-flask/time_utils.py). We display them as a friendly 12h clock.

export function formatTime(hms) {
  if (!hms || typeof hms !== 'string') return '—';
  const parts = hms.split(':');
  if (parts.length < 2) return hms;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return hms;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

export function formatDate(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return ymd;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// "Today" in the browser's local timezone, formatted as YYYY-MM-DD.
// Using toISOString() would return UTC and can be a day off for users east
// of UTC — use local components instead so the key matches what the backend
// stores in the company timezone.
export function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatHours(h) {
  if (h == null) return '—';
  return `${h}h`;
}
