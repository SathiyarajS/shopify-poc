import { useState, useEffect, useCallback } from 'react';
import {
  ShopifySession,
  SessionAuthResult,
  isEmbeddedApp,
  getShopifySessionFromContext,
  saveSession,
  loadSession,
  clearSession,
  getLastValidShop,
  shouldRefreshSession,
  createSessionFromPrismaSession,
} from '../lib/shopifySession';

interface PrismaSession {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope: string | null;
  expires: Date | null;
  accessToken: string;
}

export interface UseShopifySessionResult {
  session: ShopifySession | null;
  isLoading: boolean;
  error: string | null;
  needsReload: boolean;
  needsOAuth: boolean;
  refreshSession: () => Promise<void>;
  handleSessionExpired: () => void;
  clearCurrentSession: () => void;
}

export const useShopifySession = (fallbackShopId?: string): UseShopifySessionResult => {
  const [session, setSession] = useState<ShopifySession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [needsOAuth, setNeedsOAuth] = useState(false);

  // Fetch session from server/database
  const fetchSessionFromServer = useCallback(async (shop: string): Promise<PrismaSession | null> => {
    try {
      const response = await fetch(`/api/session?shop=${encodeURIComponent(shop)}`);
      if (response.ok) {
        const data = await response.json();
        return data.session;
      }
    } catch (error) {
      console.warn('Failed to fetch session from server:', error);
    }
    return null;
  }, []);

  // Initialize session
  const initializeSession = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setNeedsReload(false);
    setNeedsOAuth(false);

    try {
      // Step 1: Check for existing session in storage
      const existingSession = loadSession();
      if (existingSession && !shouldRefreshSession(existingSession)) {
        setSession(existingSession);
        setIsLoading(false);
        return;
      }

      // Step 2: Try to get session from Shopify context (URL params)
      const contextSession = getShopifySessionFromContext();
      if (contextSession?.shop) {
        // For embedded apps, we need to get access token from database
        if (contextSession.isEmbedded) {
          try {
            const prismaSession = await fetchSessionFromServer(contextSession.shop);

            if (prismaSession?.accessToken) {
              const newSession: ShopifySession = {
                shop: contextSession.shop,
                sessionToken: contextSession.sessionToken,
                isEmbedded: contextSession.isEmbedded,
                accessToken: prismaSession.accessToken,
                scope: prismaSession.scope || undefined,
                expiresAt: prismaSession.expires ? new Date(prismaSession.expires).getTime() : Date.now() + (60 * 60 * 1000), // 1 hour for embedded sessions
              };

              saveSession(newSession);
              setSession(newSession);
              setIsLoading(false);
              return;
            }
          } catch (dbError) {
            console.warn('Failed to fetch session from server:', dbError);
          }
        }

        // If we have shop but no access token, need OAuth
        setNeedsOAuth(true);
        setSession({ ...contextSession } as ShopifySession);
        setIsLoading(false);
        return;
      }

      // Step 3: Try fallback shop ID
      const shopToTry = fallbackShopId || getLastValidShop();
      if (shopToTry) {
        try {
          const prismaSession = await fetchSessionFromServer(shopToTry);

          if (prismaSession?.accessToken) {
            const fallbackSession = createSessionFromPrismaSession(prismaSession);
            saveSession(fallbackSession);
            setSession(fallbackSession);
            setIsLoading(false);
            return;
          }
        } catch (dbError) {
          console.warn('Failed to load fallback shop:', dbError);
        }
      }

      // Step 4: No valid session found
      if (isEmbeddedApp()) {
        setNeedsReload(true);
        setError('Please reload the app to refresh your session');
      } else {
        setNeedsOAuth(true);
        setError('Authentication required');
      }

    } catch (err) {
      console.error('Session initialization failed:', err);
      setError(err instanceof Error ? err.message : 'Session initialization failed');
    } finally {
      setIsLoading(false);
    }
  }, [fallbackShopId, fetchSessionFromServer]);

  // Refresh session
  const refreshSession = useCallback(async (): Promise<void> => {
    await initializeSession();
  }, [initializeSession]);

  // Handle session expiration
  const handleSessionExpired = useCallback((): void => {
    clearSession();
    setSession(null);

    if (isEmbeddedApp()) {
      setNeedsReload(true);
      setError('Your session has expired. Please reload the app to continue.');
    } else {
      setNeedsOAuth(true);
      setError('Your session has expired. Please re-authenticate.');
    }
  }, []);

  // Clear current session
  const clearCurrentSession = useCallback((): void => {
    clearSession();
    setSession(null);
    setError(null);
    setNeedsReload(false);
    setNeedsOAuth(false);
  }, []);

  // Initialize on mount
  useEffect(() => {
    initializeSession();
  }, [initializeSession]);

  // Auto-refresh session if needed
  useEffect(() => {
    if (!session || !shouldRefreshSession(session) || isLoading) return;

    const refreshTimer = setTimeout(() => {
      refreshSession();
    }, 1000);

    return () => clearTimeout(refreshTimer);
  }, [session, refreshSession, isLoading]);

  return {
    session,
    isLoading,
    error,
    needsReload,
    needsOAuth,
    refreshSession,
    handleSessionExpired,
    clearCurrentSession,
  };
};