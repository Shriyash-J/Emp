"""Timezone-aware helpers for attendance and other time-sensitive features.

The whole app stores attendance `date` (YYYY-MM-DD) and `check_in` / `check_out`
(HH:MM:SS) as plain strings. These must be computed in the *company* timezone
so that the stored day boundary and "late" threshold match how employees
actually experience the clock — not whatever UTC happens to be.

Configure via env vars:
  APP_TIMEZONE_OFFSET_HOURS   — numeric offset from UTC (default 5.5 = IST)
  APP_TIMEZONE_NAME           — label used on aware datetimes (default "IST")
"""

import os
from datetime import datetime, timedelta, timezone


def _build_local_tz():
    offset_hours = float(os.getenv('APP_TIMEZONE_OFFSET_HOURS', '5.5'))
    name = os.getenv('APP_TIMEZONE_NAME', 'IST')
    return timezone(timedelta(hours=offset_hours), name=name)


LOCAL_TZ = _build_local_tz()


def now_local():
    """Current datetime in the configured company timezone (aware)."""
    return datetime.now(LOCAL_TZ)


def today_str():
    """Today's date in the company timezone as 'YYYY-MM-DD'."""
    return now_local().strftime('%Y-%m-%d')


def now_time_str():
    """Current time in the company timezone as 'HH:MM:SS' (24h)."""
    return now_local().strftime('%H:%M:%S')
