-- ============================================================================
-- WorkNet — Supabase (PostgreSQL) schema
-- ============================================================================
-- You do NOT have to run this file manually. On first startup, the Flask
-- app calls db.create_all() which creates every table defined in models.py
-- directly against the connected database.
--
-- This file is provided for reference, for manual setup via the Supabase
-- SQL editor, or for auditing the schema that SQLAlchemy will generate.
-- Column types and constraints match models.py exactly.
--
-- If you choose to run this manually:
--   1. Open Supabase → SQL Editor → New query
--   2. Paste the contents of this file and Run
--   3. Leave RLS (Row-Level Security) DISABLED on these tables — the app
--      authorises every request itself via JWT + role checks. Supabase RLS
--      would double-gate and block all writes.
-- ============================================================================

-- ─── USERS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id                 SERIAL PRIMARY KEY,
    name               VARCHAR(100) NOT NULL,
    email              VARCHAR(120) NOT NULL UNIQUE,
    password           VARCHAR(255) NOT NULL,
    role               VARCHAR(20)  NOT NULL DEFAULT 'employee',  -- admin | hr | manager | employee
    department         VARCHAR(100) DEFAULT '',
    position           VARCHAR(100) DEFAULT '',
    phone              VARCHAR(20)  DEFAULT '',
    status             VARCHAR(20)  DEFAULT 'active',              -- active | inactive
    hire_date          VARCHAR(20),
    upi_id             VARCHAR(100) DEFAULT '',
    is_email_verified  BOOLEAN DEFAULT FALSE,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users (role);

-- ─── OTPs (email verification / password reset) ───────────────────────────
CREATE TABLE IF NOT EXISTS otps (
    id          SERIAL PRIMARY KEY,
    email       VARCHAR(120) NOT NULL,
    otp_code    VARCHAR(6)   NOT NULL,
    purpose     VARCHAR(20)  NOT NULL DEFAULT 'login',
    is_used     BOOLEAN DEFAULT FALSE,
    attempts    INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otps_email ON otps (email);

-- ─── ATTENDANCE ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date            VARCHAR(10) NOT NULL,          -- YYYY-MM-DD in company tz
    check_in        VARCHAR(8),                    -- HH:MM:SS
    check_out       VARCHAR(8),                    -- HH:MM:SS
    status          VARCHAR(20) DEFAULT 'present', -- present | absent | leave | half_day
    working_hours   DOUBLE PRECISION,
    is_late         BOOLEAN DEFAULT FALSE,
    is_half_day     BOOLEAN DEFAULT FALSE,
    overtime_hours  DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance (user_id, date);

-- ─── LEAVES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaves (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type   VARCHAR(30) NOT NULL DEFAULT 'casual',
    start_date   VARCHAR(10) NOT NULL,
    end_date     VARCHAR(10) NOT NULL,
    reason       VARCHAR(500) DEFAULT '',
    status       VARCHAR(20)  DEFAULT 'pending',  -- pending | approved | rejected
    approved_by  INTEGER REFERENCES users(id),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TASKS (individual assignments) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
    id           SERIAL PRIMARY KEY,
    title        VARCHAR(200) NOT NULL,
    description  VARCHAR(1000) DEFAULT '',
    assigned_to  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by  INTEGER NOT NULL REFERENCES users(id),
    priority     VARCHAR(20) DEFAULT 'medium',
    status       VARCHAR(20) DEFAULT 'pending',   -- pending | in_progress | completed
    due_date     VARCHAR(10),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks (assigned_to);

-- ─── ANNOUNCEMENTS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
    id               SERIAL PRIMARY KEY,
    title            VARCHAR(200) NOT NULL,
    content          TEXT NOT NULL,
    priority         VARCHAR(20) DEFAULT 'normal',
    target_audience  VARCHAR(20) DEFAULT 'all',
    created_by       INTEGER NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PAYROLL CONFIG ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_config (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    basic_salary      DOUBLE PRECISION NOT NULL DEFAULT 0,
    hra               DOUBLE PRECISION DEFAULT 0,
    da                DOUBLE PRECISION DEFAULT 0,
    ta                DOUBLE PRECISION DEFAULT 0,
    pf_deduction      DOUBLE PRECISION DEFAULT 0,
    tax_deduction     DOUBLE PRECISION DEFAULT 0,
    other_deductions  DOUBLE PRECISION DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PAYROLL (monthly) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll (
    id                       SERIAL PRIMARY KEY,
    user_id                  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month                    VARCHAR(7) NOT NULL,
    total_working_days       INTEGER DEFAULT 0,
    days_present             INTEGER DEFAULT 0,
    days_absent              INTEGER DEFAULT 0,
    days_leave               INTEGER DEFAULT 0,
    basic_salary             DOUBLE PRECISION DEFAULT 0,
    hra                      DOUBLE PRECISION DEFAULT 0,
    da                       DOUBLE PRECISION DEFAULT 0,
    ta                       DOUBLE PRECISION DEFAULT 0,
    gross_salary             DOUBLE PRECISION DEFAULT 0,
    pf_deduction             DOUBLE PRECISION DEFAULT 0,
    tax_deduction            DOUBLE PRECISION DEFAULT 0,
    other_deductions         DOUBLE PRECISION DEFAULT 0,
    total_deductions         DOUBLE PRECISION DEFAULT 0,
    net_salary               DOUBLE PRECISION DEFAULT 0,
    bonus                    DOUBLE PRECISION DEFAULT 0,
    bonus_reason             VARCHAR(200) DEFAULT '',
    extra_deduction          DOUBLE PRECISION DEFAULT 0,
    extra_deduction_reason   VARCHAR(200) DEFAULT '',
    overtime_pay             DOUBLE PRECISION DEFAULT 0,
    late_penalty             DOUBLE PRECISION DEFAULT 0,
    final_salary             DOUBLE PRECISION DEFAULT 0,
    status                   VARCHAR(20) DEFAULT 'generated',
    payment_status           VARCHAR(20) DEFAULT 'pending',
    payment_order_id         VARCHAR(100) DEFAULT '',
    payment_id               VARCHAR(100) DEFAULT '',
    paid_on                  TIMESTAMPTZ,
    generated_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_user_month ON payroll (user_id, month);

-- ─── HOLIDAYS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holidays (
    id            SERIAL PRIMARY KEY,
    date          VARCHAR(10) NOT NULL,
    name          VARCHAR(200) NOT NULL,
    holiday_type  VARCHAR(20) DEFAULT 'company',
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_by    INTEGER NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LETTERS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS letters (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    letter_type   VARCHAR(30) NOT NULL,
    title         VARCHAR(200) NOT NULL,
    content_json  TEXT NOT NULL DEFAULT '{}',
    file_path     VARCHAR(500),
    issued_by     INTEGER NOT NULL REFERENCES users(id),
    status        VARCHAR(20) DEFAULT 'issued',
    issued_date   VARCHAR(10) NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TEAMS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    description  VARCHAR(500) DEFAULT '',
    manager_id   INTEGER NOT NULL REFERENCES users(id),
    department   VARCHAR(100) DEFAULT '',
    status       VARCHAR(20) DEFAULT 'active',
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
    id            SERIAL PRIMARY KEY,
    team_id       INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_in_team  VARCHAR(50) DEFAULT 'member',
    joined_at     TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_team_user UNIQUE (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS team_tasks (
    id                SERIAL PRIMARY KEY,
    team_id           INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    title             VARCHAR(200) NOT NULL,
    description       TEXT DEFAULT '',
    assigned_by       INTEGER NOT NULL REFERENCES users(id),
    priority          VARCHAR(20) DEFAULT 'medium',
    status            VARCHAR(20) DEFAULT 'pending',
    start_date        VARCHAR(10) NOT NULL,
    deadline          VARCHAR(10) NOT NULL,
    overall_progress  INTEGER DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS team_task_progress (
    id            SERIAL PRIMARY KEY,
    team_task_id  INTEGER NOT NULL REFERENCES team_tasks(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    progress      INTEGER DEFAULT 0,
    notes         VARCHAR(500) DEFAULT '',
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_teamtask_user UNIQUE (team_task_id, user_id)
);

-- ─── RECRUITMENT ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidates (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR(100) NOT NULL,
    email             VARCHAR(120) NOT NULL,
    phone             VARCHAR(20) DEFAULT '',
    position_applied  VARCHAR(100) NOT NULL,
    department        VARCHAR(100) DEFAULT '',
    resume_path       VARCHAR(500),
    experience_years  DOUBLE PRECISION DEFAULT 0,
    current_company   VARCHAR(200) DEFAULT '',
    expected_salary   DOUBLE PRECISION DEFAULT 0,
    status            VARCHAR(30) DEFAULT 'applied',
    interview_date    VARCHAR(10),
    interview_notes   TEXT DEFAULT '',
    rejection_reason  VARCHAR(500) DEFAULT '',
    added_by          INTEGER NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PERFORMANCE REVIEWS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_records (
    id                SERIAL PRIMARY KEY,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_period     VARCHAR(20) NOT NULL,
    rating            INTEGER NOT NULL,
    goals_met         INTEGER DEFAULT 0,
    strengths         TEXT DEFAULT '',
    improvements      TEXT DEFAULT '',
    manager_comments  TEXT DEFAULT '',
    hr_comments       TEXT DEFAULT '',
    status            VARCHAR(20) DEFAULT 'submitted',
    reviewed_by       INTEGER NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── EXIT MANAGEMENT ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exit_records (
    id                         SERIAL PRIMARY KEY,
    user_id                    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    resignation_date           VARCHAR(10) NOT NULL,
    last_working_date          VARCHAR(10) NOT NULL,
    exit_type                  VARCHAR(30) DEFAULT 'resignation',
    reason                     TEXT DEFAULT '',
    notice_period_days         INTEGER DEFAULT 30,
    exit_interview_done        BOOLEAN DEFAULT FALSE,
    exit_interview_notes       TEXT DEFAULT '',
    assets_returned            BOOLEAN DEFAULT FALSE,
    final_settlement_done      BOOLEAN DEFAULT FALSE,
    relieving_letter_issued    BOOLEAN DEFAULT FALSE,
    experience_letter_issued   BOOLEAN DEFAULT FALSE,
    status                     VARCHAR(20) DEFAULT 'initiated',
    processed_by               INTEGER NOT NULL REFERENCES users(id),
    created_at                 TIMESTAMPTZ DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ DEFAULT NOW()
);

-- ─── DEPARTMENTS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL UNIQUE,
    description  VARCHAR(500) DEFAULT '',
    manager_id   INTEGER REFERENCES users(id),
    head_count   INTEGER DEFAULT 0,
    budget       DOUBLE PRECISION DEFAULT 0,
    status       VARCHAR(20) DEFAULT 'active',
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SYSTEM CONFIG ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_config (
    id           SERIAL PRIMARY KEY,
    key          VARCHAR(100) NOT NULL UNIQUE,
    value        TEXT NOT NULL DEFAULT '',
    description  VARCHAR(500) DEFAULT '',
    category     VARCHAR(50) DEFAULT 'general',
    updated_by   INTEGER REFERENCES users(id),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ACTIVITY LOG ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action       VARCHAR(50) NOT NULL,
    description  VARCHAR(500) NOT NULL,
    module       VARCHAR(20) NOT NULL DEFAULT 'system',
    ip_address   VARCHAR(50) DEFAULT '',
    timestamp    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_user      ON activity_log (user_id);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log (timestamp DESC);

-- ─── MESSAGES (internal chat) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id           SERIAL PRIMARY KEY,
    sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message      TEXT NOT NULL,
    is_read      BOOLEAN DEFAULT FALSE,
    timestamp    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (sender_id, receiver_id);

-- ─── FACE ENCODINGS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS face_encodings (
    id             SERIAL PRIMARY KEY,
    user_id        INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    encoding_data  TEXT NOT NULL,
    registered_at  TIMESTAMPTZ DEFAULT NOW()
);
