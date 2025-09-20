-- Create sessions table for storing Shopify OAuth sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  scope TEXT,
  state TEXT,
  is_online BOOLEAN DEFAULT FALSE,
  expires_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Index for shop lookups
CREATE INDEX IF NOT EXISTS idx_sessions_shop ON sessions(shop);

-- Index for expiration checks
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);