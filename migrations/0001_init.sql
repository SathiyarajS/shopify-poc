-- Cloudflare D1 initial schema for Shopify OAuth/session storage

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_install_state (
  shop_id TEXT PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  shop_name TEXT,
  shop_email TEXT,
  shop_currency TEXT,
  access_token TEXT,
  scopes TEXT,
  oauth_completed_at TEXT,
  installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  plan_display_name TEXT,
  plan_partner_development INTEGER DEFAULT 0,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS shop_sessions (
  session_token TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  nonce TEXT,
  CONSTRAINT fk_sessions_install FOREIGN KEY (shop_id)
    REFERENCES app_install_state (shop_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shop_sessions_shop_id
  ON shop_sessions(shop_id);
