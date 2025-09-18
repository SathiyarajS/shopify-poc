import { useState, useEffect, useCallback } from "react";
import {
  ShopifySession,
  isEmbeddedApp,
  getShopifySessionFromContext,
  saveSession,
  loadSession,
  clearSession,
  getLastValidShop,
  shouldRefreshSession,
  generateOAuthUrl,
} from "../lib/shopifySession";

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

export interface UseShopifySessionResult {
  session: ShopifySession | null;
  isLoading: boolean;
  error: string | null;
  needsReload: boolean;
  needsOAuth: boolean;
  refreshSession: () => Promise<void>;
  handleSessionExpired: () => void;
  clearCurrentSession: () => void;
  buildOAuthUrl: (shop: string) => string | null;
}

const SHOPIFY_SCOPES = ["write_products"];

async function requestSessionRefresh(shop: string, sessionToken?: string): Promise<RefreshResponse> {
  const response = await fetch("/api/session/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shop, sessionToken }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Session refresh failed (${response.status})`);
  }

  return (await response.json()) as RefreshResponse;
}

export const useShopifySession = (fallbackShopId?: string): UseShopifySessionResult => {
  const [session, setSession] = useState<ShopifySession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [needsOAuth, setNeedsOAuth] = useState(false);

  const buildOAuthUrl = useCallback((shop: string): string | null => {
    if (typeof window === "undefined") return null;
    const env = (window as unknown as { ENV?: Record<string, string | undefined> }).ENV;
    const clientId = env?.SHOPIFY_API_KEY;
    const appUrl = env?.SHOPIFY_APP_URL ?? window.location.origin;
    if (!clientId) {
      console.warn("SHOPIFY_API_KEY not provided in window.ENV");
      return null;
    }
    const state = crypto.randomUUID();
    sessionStorage.setItem("shopify_oauth_state", state);
    return generateOAuthUrl(shop, clientId, SHOPIFY_SCOPES, `${appUrl}/auth/shopify/callback`, state);
  }, []);

  const initializeSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNeedsReload(false);
    setNeedsOAuth(false);

    try {
      const inMemory = loadSession();
      const contextSession = getShopifySessionFromContext();

      if (inMemory && !shouldRefreshSession(inMemory)) {
        setSession(inMemory);
        setIsLoading(false);
        return;
      }

      const candidateShop =
        contextSession?.shop ||
        inMemory?.shop ||
        fallbackShopId ||
        getLastValidShop();

      if (!candidateShop) {
        setNeedsOAuth(true);
        setError("No shop context available. Start the app from Shopify Admin.");
        setIsLoading(false);
        return;
      }

      const existingToken = contextSession?.sessionToken || inMemory?.sessionToken;
      const refreshResult = await requestSessionRefresh(candidateShop, existingToken);

      if (refreshResult.needsOAuth) {
        setNeedsOAuth(true);
        setSession(contextSession ? { ...contextSession } : null);
        setIsLoading(false);
        return;
      }

      if (refreshResult.session) {
        const nextSession: ShopifySession = {
          shop: refreshResult.session.shop,
          sessionToken: refreshResult.session.sessionToken,
          expiresAt: refreshResult.session.expiresAt,
          isEmbedded: isEmbeddedApp(),
        };
        saveSession(nextSession);
        setSession(nextSession);
        setIsLoading(false);
        return;
      }

      setNeedsReload(true);
      setError("Unable to establish session");
    } catch (err) {
      console.error("Session initialization failed", err);
      setError(err instanceof Error ? err.message : "Session initialization failed");
      if (isEmbeddedApp()) {
        setNeedsReload(true);
      } else {
        setNeedsOAuth(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [fallbackShopId]);

  const refreshSession = useCallback(async () => {
    await initializeSession();
  }, [initializeSession]);

  const handleSessionExpired = useCallback(() => {
    clearSession();
    setSession(null);
    if (isEmbeddedApp()) {
      setNeedsReload(true);
      setError("Session expired. Reload the app.");
    } else {
      setNeedsOAuth(true);
      setError("Session expired. Please re-authenticate.");
    }
  }, []);

  const clearCurrentSession = useCallback(() => {
    clearSession();
    setSession(null);
    setError(null);
    setNeedsReload(false);
    setNeedsOAuth(false);
  }, []);

  useEffect(() => {
    initializeSession();
  }, [initializeSession]);

  useEffect(() => {
    if (!session || !shouldRefreshSession(session) || isLoading) return;
    const timer = setTimeout(() => {
      refreshSession();
    }, 1_000);
    return () => clearTimeout(timer);
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
    buildOAuthUrl,
  };
};
