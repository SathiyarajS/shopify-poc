// Session-based auth for Shopify embedded apps
export interface ShopifySession {
  shop: string;
  accessToken?: string;
  sessionToken?: string;
  isEmbedded: boolean;
  expiresAt?: number;
  scope?: string;
}

export interface SessionAuthResult {
  success: boolean;
  session?: ShopifySession;
  needsReload?: boolean;
  needsOAuth?: boolean;
  error?: string;
}

// Detect if app is running in Shopify admin iframe
export const isEmbeddedApp = (): boolean => {
  try {
    return window.parent !== window && window.location !== window.parent.location;
  } catch {
    return true; // Assume embedded if we can't check (cross-origin restriction)
  }
};

// Get Shopify session from URL parameters or postMessage
export const getShopifySessionFromContext = (): Partial<ShopifySession> | null => {
  const params = new URLSearchParams(window.location.search);
  const shop = params.get('shop');
  const sessionToken = params.get('session');
  
  if (!shop) return null;
  
  return {
    shop,
    sessionToken: sessionToken || undefined,
    isEmbedded: isEmbeddedApp(),
  };
};

// Storage keys
const SESSION_KEY = 'shopify_session';
const LAST_VALID_SESSION_KEY = 'shopify_last_valid_session';

// Save session to browser storage
export const saveSession = (session: ShopifySession): void => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    // Also save to localStorage as backup
    if (session.accessToken) {
      localStorage.setItem(LAST_VALID_SESSION_KEY, JSON.stringify({
        shop: session.shop,
        timestamp: Date.now(),
      }));
    }
  } catch (error) {
    console.warn('Failed to save session:', error);
  }
};

// Load session from browser storage
export const loadSession = (): ShopifySession | null => {
  try {
    const sessionData = sessionStorage.getItem(SESSION_KEY);
    if (sessionData) {
      const session = JSON.parse(sessionData) as ShopifySession;
      
      // Check if session is expired
      if (session.expiresAt && Date.now() > session.expiresAt) {
        clearSession();
        return null;
      }
      
      return session;
    }
  } catch (error) {
    console.warn('Failed to load session:', error);
  }
  
  return null;
};

// Clear current session
export const clearSession = (): void => {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.warn('Failed to clear session:', error);
  }
};

// Get last known valid shop from localStorage
export const getLastValidShop = (): string | null => {
  try {
    const lastSession = localStorage.getItem(LAST_VALID_SESSION_KEY);
    if (lastSession) {
      const data = JSON.parse(lastSession);
      // Only return if it's recent (within 30 days)
      if (Date.now() - data.timestamp < 30 * 24 * 60 * 60 * 1000) {
        return data.shop;
      }
    }
  } catch (error) {
    console.warn('Failed to get last valid shop:', error);
  }
  
  return null;
};

// Check if session needs refresh
export const shouldRefreshSession = (session: ShopifySession): boolean => {
  if (!session.expiresAt) return false;
  
  // Refresh if expires within next 5 minutes
  const refreshThreshold = 5 * 60 * 1000;
  return Date.now() + refreshThreshold > session.expiresAt;
};

// Create session from Prisma session data (fallback)
export const createSessionFromPrismaSession = (sessionData: any): ShopifySession => {
  return {
    shop: sessionData.shop,
    accessToken: sessionData.accessToken,
    isEmbedded: false, // This is fallback/direct access
    expiresAt: sessionData.expires ? new Date(sessionData.expires).getTime() : Date.now() + (24 * 60 * 60 * 1000), // 24h expiry
    scope: sessionData.scope,
  };
};

// Generate OAuth URL
export const generateOAuthUrl = (shop: string, clientId: string, scopes: string[], redirectUri: string): string => {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(','),
    redirect_uri: redirectUri,
    state: crypto.randomUUID(),
  });
  
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
};