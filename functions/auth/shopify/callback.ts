import type { Env } from "../../_utils/env";
import {
  normalizeShopDomain,
  verifyShopifyHmac,
  exchangeAccessToken,
  fetchShop,
} from "../../_utils/shopify";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  const shopParam = normalizeShopDomain(url.searchParams.get("shop"));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!shopParam || !code || !state) {
    return jsonResponse({ success: false, error: "Missing required OAuth params" }, { status: 400 });
  }

  const isValidHmac = await verifyShopifyHmac(env.SHOPIFY_API_SECRET, url);
  if (!isValidHmac) {
    return jsonResponse({ success: false, error: "Invalid HMAC signature" }, { status: 401 });
  }

  try {
    const { access_token: accessToken, scope } = await exchangeAccessToken(env, shopParam, code);
    const shop = await fetchShop(env, shopParam, accessToken);

    const nowIso = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO app_install_state (
        shop_id,
        shop_domain,
        shop_name,
        shop_email,
        shop_currency,
        access_token,
        scopes,
        oauth_completed_at,
        updated_at,
        plan_display_name,
        plan_partner_development
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_id) DO UPDATE SET
        shop_domain = excluded.shop_domain,
        shop_name = excluded.shop_name,
        shop_email = excluded.shop_email,
        shop_currency = excluded.shop_currency,
        access_token = excluded.access_token,
        scopes = excluded.scopes,
        oauth_completed_at = excluded.oauth_completed_at,
        updated_at = excluded.updated_at,
        plan_display_name = excluded.plan_display_name,
        plan_partner_development = excluded.plan_partner_development
      `
    )
      .bind(
        shop.myshopify_domain,
        shop.myshopify_domain,
        shop.name ?? null,
        shop.email ?? null,
        shop.currency ?? null,
        accessToken,
        scope,
        nowIso,
        nowIso,
        (shop as any).plan_display_name ?? shop.plan_name ?? null,
        (shop as any).plan_partner_development ? 1 : 0
      )
      .run();

    await env.DB.prepare(`DELETE FROM shop_sessions WHERE shop_id = ?`).bind(shop.myshopify_domain).run();

    const redirectUrl = new URL(env.APP_URL || "https://admin.shopify.com/store");
    redirectUrl.searchParams.set("shop", shop.myshopify_domain);

    return Response.redirect(redirectUrl.toString(), 302);
  } catch (error) {
    console.error("OAuth callback failed", error);
    return jsonResponse({ success: false, error: (error as Error).message }, { status: 500 });
  }
};
