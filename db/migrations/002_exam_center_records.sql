CREATE TABLE IF NOT EXISTS exam_records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS exam_records_collection_updated_idx ON exam_records(collection, updated_at);

CREATE TABLE IF NOT EXISTS exam_center_state (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
