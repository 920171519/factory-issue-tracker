import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type AppDatabase = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  employee_no TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_system_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  notify_self_on_status INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  is_pm INTEGER NOT NULL DEFAULT 0,
  is_supervisor INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_handoff_key TEXT,
  last_handoff_at TEXT,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  is_leader INTEGER NOT NULL DEFAULT 0,
  is_default_assignee INTEGER NOT NULL DEFAULT 0,
  is_fallback_assignee INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (group_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_group_default_assignee
  ON group_members(group_id) WHERE is_default_assignee = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_group_fallback_assignee
  ON group_members(group_id) WHERE is_fallback_assignee = 1;

CREATE TABLE IF NOT EXISTS project_default_groups (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, group_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  created_at TEXT NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS statuses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2563eb',
  counts_pending INTEGER NOT NULL DEFAULT 1,
  requires_reason INTEGER NOT NULL DEFAULT 0,
  is_identified INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_status_default
  ON statuses(project_id) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS time_slots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_minute INTEGER NOT NULL,
  end_minute INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  slot_id TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (group_id, weekday, slot_id, user_id, effective_from)
);

CREATE TABLE IF NOT EXISTS schedule_overrides (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  override_date TEXT NOT NULL,
  slot_id TEXT REFERENCES time_slots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'TEMP',
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_schedule_override_user
  ON schedule_overrides(group_id, override_date, COALESCE(slot_id, ''), user_id);

CREATE TABLE IF NOT EXISTS holidays (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  holiday_date TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, holiday_date)
);

CREATE TABLE IF NOT EXISTS location_hosts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  location_no TEXT NOT NULL,
  host_ip TEXT NOT NULL,
  host_account TEXT,
  host_password TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, location_no)
);

CREATE TABLE IF NOT EXISTS code_list (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  description TEXT,
  version TEXT,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);

CREATE TABLE IF NOT EXISTS barcodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  location_no TEXT NOT NULL,
  host_ip TEXT,
  host_account TEXT,
  host_password TEXT,
  device_ip TEXT,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  remark TEXT,
  tracking_groups TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, barcode)
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  barcode_id TEXT NOT NULL REFERENCES barcodes(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  error_item TEXT NOT NULL DEFAULT '',
  status_id TEXT NOT NULL REFERENCES statuses(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_groups (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id),
  pinned_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (issue_id, group_id)
);

CREATE TABLE IF NOT EXISTS issue_group_handlers (
  id TEXT PRIMARY KEY,
  issue_group_id TEXT NOT NULL REFERENCES issue_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  is_primary INTEGER NOT NULL DEFAULT 0,
  assigned_at TEXT NOT NULL,
  UNIQUE (issue_group_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_issue_group_primary
  ON issue_group_handlers(issue_group_id) WHERE is_primary = 1;

CREATE TABLE IF NOT EXISTS status_history (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  old_status_id TEXT REFERENCES statuses(id),
  new_status_id TEXT NOT NULL REFERENCES statuses(id),
  reason_html TEXT NOT NULL DEFAULT '',
  operator_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_history (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL,
  operator_id TEXT REFERENCES users(id),
  from_group_ids TEXT NOT NULL DEFAULT '[]',
  to_group_ids TEXT NOT NULL DEFAULT '[]',
  retained_group_ids TEXT NOT NULL DEFAULT '[]',
  from_handler_ids TEXT NOT NULL DEFAULT '[]',
  to_handler_ids TEXT NOT NULL DEFAULT '[]',
  reason_html TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'IN_APP',
  status TEXT NOT NULL DEFAULT 'SENT',
  barcode_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS delete_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  reviewed_by TEXT REFERENCES users(id),
  review_reason_html TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS delete_request_barcodes (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES delete_requests(id) ON DELETE CASCADE,
  barcode_id TEXT,
  barcode TEXT NOT NULL,
  location_no TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anomalies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_id TEXT REFERENCES issues(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_barcodes_project_updated ON barcodes(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_issues_barcode ON issues(barcode_id);
CREATE INDEX IF NOT EXISTS ix_issues_project_status ON issues(project_id, status_id);
CREATE INDEX IF NOT EXISTS ix_issue_groups_group ON issue_groups(group_id);
CREATE INDEX IF NOT EXISTS ix_handlers_user ON issue_group_handlers(user_id, is_primary);
CREATE INDEX IF NOT EXISTS ix_notifications_recipient ON notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_assignment_history_issue ON assignment_history(issue_id, created_at);
CREATE INDEX IF NOT EXISTS ix_status_history_issue ON status_history(issue_id, created_at);
CREATE INDEX IF NOT EXISTS ix_schedules_group ON schedules(group_id, weekday, slot_id);
`;

let dbInstance: AppDatabase | null = null;
let currentPath: string | null = null;

export function databasePath(): string {
  return process.env.DATABASE_PATH || "./data/app.db";
}

export function createDatabase(filePath = databasePath()): AppDatabase {
  const memory = filePath === ":memory:";
  if (!memory) {
    fs.mkdirSync(path.dirname(path.resolve(/* turbopackIgnore: true */ filePath)), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (!memory) db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  const userColumns = db.prepare("PRAGMA table_info(users)").all() as { name?: unknown }[];
  if (!userColumns.some((column) => column.name === "is_system_admin")) {
    db.exec("ALTER TABLE users ADD COLUMN is_system_admin INTEGER NOT NULL DEFAULT 0");
  }
  return db;
}

export function getDb(): AppDatabase {
  const target = databasePath();
  if (!dbInstance || currentPath !== target) {
    if (dbInstance) dbInstance.close();
    dbInstance = createDatabase(target);
    currentPath = target;
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    currentPath = null;
  }
}

/** Test helper: close the singleton, then open the supplied path on next getDb(). */
export function useDatabaseForTests(filePath: string): void {
  closeDb();
  process.env.DATABASE_PATH = filePath;
}