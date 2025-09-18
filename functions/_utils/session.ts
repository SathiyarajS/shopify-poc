import type { Env } from "./env";
import { hmacSHA256, safeCompare } from "./crypto";

export interface SessionRecord {
  session_token: string;
  shop_id: string;
  issued_at: number;
  expires_at: number;
  last_seen_at: number;
  nonce: string | null;
}

export interface IssueSessionResult {
  token: string;
  expiresAt: number;
}

function toBase64(input: string): string {
  return btoa(input);
}

function fromBase64(input: string): string {
  return atob(input);
}

export async function issueSession(env: Env, shop: string): Promise<IssueSessionResult> {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 55 * 60 * 1000; // 55 minutes
  const base = `${shop}:${nonce}:${issuedAt}`;
  const signature = await hmacSHA256(env.SESSION_HMAC_SECRET, base);
  const packed = toBase64(`${nonce}:${issuedAt}`);
  const token = `${packed}.${signature}`;

  await env.DB.prepare(
    `INSERT INTO shop_sessions (session_token, shop_id, issued_at, expires_at, last_seen_at, nonce)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(signature, shop, issuedAt, expiresAt, issuedAt, nonce)
    .run();

  return { token, expiresAt };
}

export interface ValidateSessionResult {
  valid: boolean;
  record?: SessionRecord;
}

export async function validateSession(env: Env, shop: string, token?: string | null): Promise<ValidateSessionResult> {
  if (!token) {
    return { valid: false };
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false };
  }
  const [packed, signature] = parts;
  const decoded = fromBase64(packed);
  const [nonce, issuedAtStr] = decoded.split(":");
  if (!nonce || !issuedAtStr) {
    return { valid: false };
  }
  const message = `${shop}:${nonce}:${issuedAtStr}`;
  const expectedSignature = await hmacSHA256(env.SESSION_HMAC_SECRET, message);
  if (!safeCompare(expectedSignature, signature)) {
    return { valid: false };
  }

  const record = await env.DB.prepare(
    `SELECT session_token, shop_id, issued_at, expires_at, last_seen_at, nonce
       FROM shop_sessions
      WHERE session_token = ? AND shop_id = ?`
  )
    .bind(signature, shop)
    .first<SessionRecord>();

  if (!record) {
    return { valid: false };
  }

  const now = Date.now();
  if (record.expires_at <= now) {
    await env.DB.prepare(`DELETE FROM shop_sessions WHERE session_token = ?`).bind(signature).run();
    return { valid: false };
  }

  await env.DB.prepare(`UPDATE shop_sessions SET last_seen_at = ? WHERE session_token = ?`)
    .bind(now, signature)
    .run();

  return { valid: true, record };
}

export async function pruneExpiredSessions(env: Env, shop: string) {
  await env.DB.prepare(
    `DELETE FROM shop_sessions WHERE shop_id = ? AND expires_at < ?`
  )
    .bind(shop, Date.now())
    .run();
}
