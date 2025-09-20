// No adapter needed for Cloudflare Pages
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { getDatabase } from "./db.server";

// Custom session storage for Cloudflare D1
class D1SessionStorage {
  async storeSession(session: any) {
    const db = getDatabase();
    try {
      await db.session.upsert({
        where: { id: session.id },
        update: {
          shop: session.shop,
          state: session.state,
          isOnline: session.isOnline || false,
          scope: session.scope,
          expires: session.expires,
          accessToken: session.accessToken,
          userId: session.userId ? BigInt(session.userId) : null,
          firstName: session.firstName,
          lastName: session.lastName,
          email: session.email,
          accountOwner: session.accountOwner || false,
          locale: session.locale,
          collaborator: session.collaborator,
          emailVerified: session.emailVerified,
        },
        create: {
          id: session.id,
          shop: session.shop,
          state: session.state,
          isOnline: session.isOnline || false,
          scope: session.scope,
          expires: session.expires,
          accessToken: session.accessToken,
          userId: session.userId ? BigInt(session.userId) : null,
          firstName: session.firstName,
          lastName: session.lastName,
          email: session.email,
          accountOwner: session.accountOwner || false,
          locale: session.locale,
          collaborator: session.collaborator,
          emailVerified: session.emailVerified,
        },
      });
      return true;
    } catch (error) {
      console.error('Error storing session:', error);
      return false;
    }
  }

  async loadSession(id: string) {
    const db = getDatabase();
    try {
      const session = await db.session.findUnique({
        where: { id },
      });
      if (!session) return undefined;
      
      return {
        ...session,
        userId: session.userId ? Number(session.userId) : undefined,
      };
    } catch (error) {
      console.error('Error loading session:', error);
      return undefined;
    }
  }

  async deleteSession(id: string) {
    const db = getDatabase();
    try {
      await db.session.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  }

  async deleteSessions(ids: string[]) {
    const db = getDatabase();
    try {
      await db.session.deleteMany({
        where: {
          id: {
            in: ids,
          },
        },
      });
      return true;
    } catch (error) {
      console.error('Error deleting sessions:', error);
      return false;
    }
  }

  async findSessionsByShop(shop: string) {
    const db = getDatabase();
    try {
      const sessions = await db.session.findMany({
        where: { shop },
      });
      return sessions.map(session => ({
        ...session,
        userId: session.userId ? Number(session.userId) : undefined,
      }));
    } catch (error) {
      console.error('Error finding sessions by shop:', error);
      return [];
    }
  }
}

// Shopify app instance (lazy initialized)
let shopify: any = null;

// Initialize shopify app instance with environment variables from request context
function initializeShopify() {
  if (!shopify) {
    // Try multiple sources for env vars in Cloudflare Pages context
    let apiKey = process.env?.SHOPIFY_API_KEY || globalThis.SHOPIFY_API_KEY || globalThis.env?.SHOPIFY_API_KEY;
    let apiSecret = process.env?.SHOPIFY_API_SECRET || globalThis.SHOPIFY_API_SECRET || globalThis.env?.SHOPIFY_API_SECRET;
    let appUrl = process.env?.SHOPIFY_APP_URL || globalThis.SHOPIFY_APP_URL || globalThis.env?.SHOPIFY_APP_URL;
    let scopes = process.env?.SCOPES || globalThis.SCOPES || globalThis.env?.SCOPES;
    let hmacSecret = process.env?.SESSION_HMAC_SECRET || globalThis.SESSION_HMAC_SECRET || globalThis.env?.SESSION_HMAC_SECRET;
    
    
    // Validate required environment variables
    if (!apiKey) {
      throw new Error('SHOPIFY_API_KEY environment variable is required');
    }
    if (!apiSecret) {
      throw new Error('SHOPIFY_API_SECRET environment variable is required');
    }
    if (!appUrl) {
      throw new Error('SHOPIFY_APP_URL environment variable is required');
    }

    shopify = shopifyApp({
      apiKey: apiKey,
      apiSecretKey: apiSecret,
      apiVersion: ApiVersion.January25,
      scopes: scopes?.split(",") || [],
      appUrl: appUrl,
      authPathPrefix: "/auth",
      sessionStorage: new D1SessionStorage(),
      distribution: AppDistribution.AppStore,
      future: {
        unstable_newEmbeddedAuthStrategy: true,
        removeRest: true,
      },
      ...(process.env?.SHOP_CUSTOM_DOMAIN || globalThis.SHOP_CUSTOM_DOMAIN
        ? { customShopDomains: [process.env?.SHOP_CUSTOM_DOMAIN || globalThis.SHOP_CUSTOM_DOMAIN] }
        : {}),
    });
  }
  return shopify;
}

// Export function to get shopify instance
export function getShopify() {
  return initializeShopify();
}

export const apiVersion = ApiVersion.January25;

// Export lazy getters for Shopify functions
export function addDocumentResponseHeaders(...args: any[]) {
  return getShopify().addDocumentResponseHeaders(...args);
}

export function authenticate(...args: any[]) {
  return getShopify().authenticate;
}

export function unauthenticated(...args: any[]) {
  return getShopify().unauthenticated;
}

export function login(...args: any[]) {
  return getShopify().login;
}

export function registerWebhooks(...args: any[]) {
  return getShopify().registerWebhooks(...args);
}

export function sessionStorage() {
  return getShopify().sessionStorage;
}
