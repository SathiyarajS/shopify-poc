import type { Env } from "./env";
import { hmacSHA256, safeCompare } from "./crypto";

interface ShopifyOAuthQuery {
  [key: string]: string | null;
}

export interface ShopifyShop {
  id: number;
  name: string;
  email: string | null;
  domain: string | null;
  myshopify_domain: string;
  currency: string | null;
  timezone: string | null;
  plan_name: string | null;
  plan_display_name?: string | null;
  plan_partner_development?: boolean | null;
}

export async function verifyShopifyHmac(secret: string, url: URL): Promise<boolean> {
  const params = new URLSearchParams(url.search);
  const hmac = params.get("hmac");
  if (!hmac) return false;

  const filtered = new URLSearchParams();
  params.sort();
  for (const [key, value] of params.entries()) {
    if (key === "hmac" || key === "signature") continue;
    if (value !== null) {
      filtered.append(key, value);
    }
  }

  const message = filtered.toString();
  const digest = await hmacSHA256(secret, message);
  return safeCompare(digest, hmac);
}

export async function exchangeAccessToken(env: Env, shop: string, code: string) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to exchange code: ${text}`);
  }

  return (await response.json()) as { access_token: string; scope: string };
}

export async function fetchShop(env: Env, shop: string, accessToken: string): Promise<ShopifyShop> {
  const response = await fetch(`https://${shop}/admin/api/2024-10/shop.json`, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch shop: ${text}`);
  }

  const payload = (await response.json()) as { shop: ShopifyShop };
  return payload.shop;
}

export function normalizeShopDomain(shop?: string | null): string | null {
  if (!shop) return null;
  const lower = shop.toLowerCase().trim();
  return lower.endsWith(".myshopify.com") ? lower : `${lower}.myshopify.com`;
}

export function generateOAuthUrl(env: Env, shop: string, state: string): string {
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", env.SHOPIFY_API_KEY);
  url.searchParams.set("scope", "write_products");
  url.searchParams.set("redirect_uri", `${env.APP_URL}/auth/shopify/callback`);
  url.searchParams.set("state", state);
  return url.toString();
}
