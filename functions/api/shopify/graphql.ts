import type { Env } from "../../_utils/env";
import { normalizeShopDomain } from "../../_utils/shopify";
import { validateSession, pruneExpiredSessions } from "../../_utils/session";

interface GraphQLBody {
  shop?: string;
  query?: string;
  variables?: unknown;
  sessionToken?: string;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    ...init,
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  let shop = normalizeShopDomain(url.searchParams.get("shop"));
  let sessionToken: string | undefined;

  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    sessionToken = authHeader.substring("Bearer ".length).trim();
  }

  try {
    const body = (await request.json().catch(() => ({}))) as GraphQLBody;
    if (!shop && body.shop) {
      shop = normalizeShopDomain(body.shop);
    }
    if (!sessionToken && body.sessionToken) {
      sessionToken = body.sessionToken;
    }
    const query = body.query;
    const variables = body.variables ?? undefined;

    if (!shop) {
      return json({ error: "Missing shop parameter" }, { status: 400 });
    }
    if (!query) {
      return json({ error: "Missing GraphQL query" }, { status: 400 });
    }

    const install = await env.DB.prepare(
      `SELECT shop_id, access_token FROM app_install_state WHERE shop_id = ?`
    )
      .bind(shop)
      .first<{ shop_id: string; access_token: string | null }>();

    if (!install || !install.access_token) {
      await pruneExpiredSessions(env, shop);
      return json({ error: "OAuth required", needsOAuth: true }, { status: 401 });
    }

    const validation = await validateSession(env, shop, sessionToken);
    if (!validation.valid) {
      return json({ error: "Session invalid", needsReload: true }, { status: 401 });
    }

    const response = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": install.access_token,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 401 || response.status === 403) {
      await env.DB.prepare(`UPDATE app_install_state SET access_token = NULL WHERE shop_id = ?`)
        .bind(shop)
        .run();
      await pruneExpiredSessions(env, shop);
      return json({ error: "Shopify authentication failed", needsOAuth: true }, { status: 401 });
    }

    const payload = await response.json();

    return json(payload, { status: response.status });
  } catch (error) {
    console.error("shopify graphql proxy failed", error);
    return json({ error: (error as Error).message }, { status: 500 });
  }
};
