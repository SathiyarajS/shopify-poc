import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { sessionStorage } from "../shopify.server";
import { Session } from "@shopify/shopify-api";

interface ShopifyAccessTokenResponse {
  access_token: string;
  scope: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const shop = url.searchParams.get("shop");
  const state = url.searchParams.get("state");

  console.log('OAuth callback received:', { shop, code: !!code, state });

  if (!code || !shop) {
    console.error('Missing required parameters:', { code: !!code, shop });
    throw new Response('Missing required OAuth parameters', { status: 400 });
  }

  try {
    // Exchange code for access token
    const clientId = process.env.SHOPIFY_API_KEY;
    const clientSecret = process.env.SHOPIFY_API_SECRET;

    if (!clientId || !clientSecret) {
      console.error('Missing Shopify app credentials');
      throw new Response('Server configuration error', { status: 500 });
    }

    console.log('Exchanging code for access token...');
    
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      throw new Response('Failed to exchange code for token', { status: 400 });
    }

    const tokenData: ShopifyAccessTokenResponse = await tokenResponse.json();
    console.log('Access token obtained successfully');

    // Create a session using the existing Shopify app session storage
    const sessionId = `offline_${shop}`;
    const session = new Session({
      id: sessionId,
      shop: shop,
      state: state || '',
      isOnline: false,
      accessToken: tokenData.access_token,
      scope: tokenData.scope,
    });

    // Store the session
    await sessionStorage.storeSession(session);
    console.log('Session stored successfully');

    // Redirect to app with shop parameter
    return redirect(`/app/session-demo?shop=${shop}`);

  } catch (error) {
    console.error('OAuth callback error:', error);
    throw new Response('OAuth callback failed', { status: 500 });
  }
};