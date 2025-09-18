import type { Env } from "../../_utils/env";
import { issueSession, validateSession, pruneExpiredSessions } from "../../_utils/session";
import { normalizeShopDomain } from "../../_utils/shopify";

interface RefreshBody {
  shop?: string;
  sessionToken?: string;
}

interface RefreshResponse {
  success: boolean;
  needsOAuth: boolean;
  needsReload: boolean;
  session?: {
    shop: string;
    sessionToken: string;
    expiresAt: number;
  };
  message?: string;
}

function json(body: RefreshResponse, init: ResponseInit = {}): Response {
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

  try {
    const body = (await request.json().catch(() => ({}))) as RefreshBody;
    if (!shop && body.shop) {
      shop = normalizeShopDomain(body.shop);
    }
    const providedToken = body.sessionToken;

    if (!shop) {
      return json(
        {
          success: false,
          needsOAuth: false,
          needsReload: false,
          message: "Missing shop parameter",
        },
        { status: 400 }
      );
    }

    const install = await env.DB.prepare(
      `SELECT shop_id, access_token FROM app_install_state WHERE shop_id = ?`
    )
      .bind(shop)
      .first<{ shop_id: string; access_token: string | null }>();

    if (!install || !install.access_token) {
      await pruneExpiredSessions(env, shop);
      return json({ success: true, needsOAuth: true, needsReload: false });
    }

    const validation = await validateSession(env, shop, providedToken ?? undefined);

    if (validation.valid && validation.record && providedToken) {
      return json({
        success: true,
        needsOAuth: false,
        needsReload: false,
        session: {
          shop,
          sessionToken: providedToken,
          expiresAt: validation.record.expires_at,
        },
      });
    }

    await pruneExpiredSessions(env, shop);
    const issued = await issueSession(env, shop);

    return json({
      success: true,
      needsOAuth: false,
      needsReload: false,
      session: {
        shop,
        sessionToken: issued.token,
        expiresAt: issued.expiresAt,
      },
    });
  } catch (error) {
    console.error("session refresh failed", error);
    return json(
      {
        success: false,
        needsOAuth: false,
        needsReload: false,
        message: (error as Error).message,
      },
      { status: 500 }
    );
  }
};
