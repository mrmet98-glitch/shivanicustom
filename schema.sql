-- The application creates these tables automatically on first API request.
-- This file is included for reference / manual initialization if desired.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','customer')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_type TEXT,
  client_reference TEXT,
  details TEXT,
  requested_delivery_date TEXT,
  metal TEXT,
  size_details TEXT,
  supplied_materials TEXT,
  internal_notes TEXT,
  status TEXT NOT NULL DEFAULT 'Project Received',
  approved_design_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS designs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metal TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  has_price INTEGER NOT NULL DEFAULT 1,
  price_includes_diamonds INTEGER NOT NULL DEFAULT 0,
  price_includes_findings INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'pending',
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS finding_lines (
  id TEXT PRIMARY KEY,
  design_id TEXT NOT NULL,
  description TEXT,
  finding_type TEXT NOT NULL DEFAULT 'Other',
  metal TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS diamond_lines (
  id TEXT PRIMARY KEY,
  design_id TEXT NOT NULL,
  shape TEXT,
  weight_ct REAL,
  weight_mode TEXT NOT NULL DEFAULT 'total' CHECK(weight_mode IN ('total','each')),
  stone_count INTEGER NOT NULL DEFAULT 1,
  color_clarity TEXT,
  diamond_origin TEXT NOT NULL DEFAULT '',
  provided_by TEXT NOT NULL DEFAULT '',
  measurements TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  design_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('reference','design')),
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  design_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS project_activity (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  design_id TEXT,
  actor_user_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(design_id) REFERENCES designs(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS project_activity_reads (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(project_id,user_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
