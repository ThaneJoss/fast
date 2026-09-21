CREATE TABLE ip_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE ip_allowlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL UNIQUE,
  group_id INTEGER REFERENCES ip_groups(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX ip_allowlist_group ON ip_allowlist(group_id);

CREATE TABLE path_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE TABLE path_rules (
  prefix TEXT PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES path_categories(id) ON DELETE CASCADE
);
CREATE INDEX path_rules_category ON path_rules(category_id);

-- Names are snapshots. Deleting or renaming a rule must not rewrite historical logs.
CREATE TABLE access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  ip TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied', 'admin', 'error')),
  group_id INTEGER,
  group_name TEXT,
  category_id INTEGER,
  category_name TEXT,
  country TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  duration_ms INTEGER NOT NULL
);
CREATE INDEX access_logs_ip ON access_logs(ip, id DESC);
CREATE INDEX access_logs_group ON access_logs(group_id, id DESC);
CREATE INDEX access_logs_category ON access_logs(category_id, id DESC);
CREATE INDEX access_logs_decision ON access_logs(decision, id DESC);
CREATE INDEX access_logs_created ON access_logs(created_at, id DESC);

INSERT INTO path_categories (name) VALUES ('Ubuntu'), ('npm'), ('其他路径'), ('管理后台');
INSERT INTO path_rules (prefix, category_id) VALUES
  ('/archive.ubuntu.com', 1), ('/security.ubuntu.com', 1),
  ('/registry.npmjs.org', 2), ('/', 3), ('/admin', 4);
