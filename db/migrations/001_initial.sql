CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token TEXT PRIMARY KEY,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS user_files (
  id TEXT PRIMARY KEY,
  metadata JSONB NOT NULL,
  content BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS curriculum_items (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  parent_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS curriculum_items_exam_parent_idx ON curriculum_items(exam_id, parent_id);
