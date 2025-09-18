// Session utilities for the embedded Shopify app
export interface ShopifySession {
  shop: string;
  sessionToken?: string;
  isEmbedded: boolean;
  expiresAt?: number;
}

export interface SessionAuthResult {
  success: boolean;
  session?: ShopifySession;
  needsReload?: boolean;
  needsOAuth?: boolean;
  error?: string;
}

// Detect if app is running inside Shopify's embedded iframe
export const isEmbeddedApp = (): boolean => {
  try {
    return window.parent !== window && window.location !== window.parent.location;
  } catch {
    return true;
  }
};

// Extract shop + session token from URL query params
export const getShopifySessionFromContext = (): Partial<ShopifySession> | null => {
  const params = new URLSearchParams(window.location.search);
  const shop = params.get("shop");
  const sessionToken = params.get("session");

  if (!shop) return null;

  return {
    shop,
    sessionToken: sessionToken || undefined,
    isEmbedded: isEmbeddedApp(),
  };
};

// Storage keys
const SESSION_KEY = "shopify_session";
const LAST_VALID_SESSION_KEY = "shopify_last_valid_shop";

export const saveSession = (session: ShopifySession): void => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.setItem(
      LAST_VALID_SESSION_KEY,
      JSON.stringify({ shop: session.shop, timestamp: Date.now() })
    );
  } catch (error) {
    console.warn("Failed to save session", error);
  }
};

export const loadSession = (): ShopifySession | null => {
  try {
    const data = sessionStorage.getItem(SESSION_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data) as ShopifySession;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      clearSession();
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("Failed to load session", error);
    return null;
  }
};

export const clearSession = (): void => {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn("Failed to clear session", error);
  }
};

export const getLastValidShop = (): string | null => {
  try {
    const value = localStorage.getItem(LAST_VALID_SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as { shop: string; timestamp: number };
    if (Date.now() - parsed.timestamp > 30 * 24 * 60 * 60 * 1000) {
      return null;
    }
    return parsed.shop;
  } catch (error) {
    console.warn("Failed to read last valid shop", error);
    return null;
  }
};

export const shouldRefreshSession = (session: ShopifySession): boolean => {
  if (!session.expiresAt) return false;
  const threshold = 5 * 60 * 1000; // 5 minutes
  return Date.now() + threshold > session.expiresAt;
};

export const generateOAuthUrl = (
  shop: string,
  clientId: string,
  scopes: string[],
  redirectUri: string,
  state: string,
): string => {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(","),
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
};
