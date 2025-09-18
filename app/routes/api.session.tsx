import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { sessionStorage } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ error: "Shop parameter is required" }, { status: 400 });
  }

  try {
    // Find the most recent session for this shop
    const sessions = await sessionStorage.findSessionsByShop(shop);
    
    if (sessions.length === 0) {
      return json({ session: null });
    }

    // Get the most recent session (assuming sessions are returned in order)
    const session = sessions[0];
    
    // Return sanitized session data
    return json({
      session: {
        id: session.id,
        shop: session.shop,
        state: session.state,
        isOnline: session.isOnline,
        scope: session.scope,
        expires: session.expires,
        accessToken: session.accessToken,
      }
    });
  } catch (error) {
    console.error("Failed to fetch session:", error);
    return json({ error: "Failed to fetch session" }, { status: 500 });
  }
};