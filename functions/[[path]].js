import { createPagesFunctionHandler } from "@remix-run/cloudflare-pages";

// Set up process.env polyfill for Cloudflare Workers
if (typeof process === 'undefined') {
  globalThis.process = { env: {} };
}

// We need to dynamically import the build to ensure process.env is set up first
let handler = null;

async function getHandler(context) {
  if (!handler) {
    console.log('Setting up environment variables...');
    
    // Set up environment variables in process.env
    process.env.SHOPIFY_API_KEY = context.env.SHOPIFY_API_KEY || '';
    process.env.SHOPIFY_API_SECRET = context.env.SHOPIFY_API_SECRET || '';
    process.env.SHOPIFY_APP_URL = context.env.SHOPIFY_APP_URL || '';
    process.env.SCOPES = context.env.SCOPES || '';
    process.env.SESSION_HMAC_SECRET = context.env.SESSION_HMAC_SECRET || '';
    process.env.NODE_ENV = context.env.NODE_ENV || 'production';
    
    // Also set them globally for Cloudflare Workers
    globalThis.SHOPIFY_API_KEY = context.env.SHOPIFY_API_KEY;
    globalThis.SHOPIFY_API_SECRET = context.env.SHOPIFY_API_SECRET;
    globalThis.SHOPIFY_APP_URL = context.env.SHOPIFY_APP_URL;
    globalThis.SCOPES = context.env.SCOPES;
    globalThis.SESSION_HMAC_SECRET = context.env.SESSION_HMAC_SECRET;
    globalThis.NODE_ENV = context.env.NODE_ENV || 'production';
    
    // Set up global DB for Prisma
    globalThis.DB = context.env.DB;
    globalThis.env = context.env;
    
    console.log('Environment variables set:', {
      SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ? 'SET' : 'MISSING',
      SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET ? 'SET' : 'MISSING',
      SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
      SCOPES: process.env.SCOPES,
      DB: globalThis.DB ? 'SET' : 'MISSING'
    });
    
    // Import build after environment is set up
    const build = await import("../build/server/index.js");
    
    handler = createPagesFunctionHandler({
      build: build.default || build,
      mode: "production",
      getLoadContext: (context) => ({
        env: context.env,
        DB: context.env.DB,
        cloudflare: {
          env: context.env,
        },
      }),
    });
  }
  return handler;
}

export async function onRequest(context) {
  try {
    const handlerFn = await getHandler(context);
    const response = await handlerFn(context);
    
    // Clone response to add headers
    const newResponse = new Response(response.body, response);
    
    // Add headers for Shopify embedding
    const shopUrl = context.request.headers.get('x-shop-domain') || 
                    new URL(context.request.url).searchParams.get('shop');
    
    if (shopUrl) {
      // Set CSP header to allow Shopify admin embedding
      newResponse.headers.set(
        'Content-Security-Policy',
        `frame-ancestors https://${shopUrl} https://admin.shopify.com;`
      );
    } else {
      // Default CSP for non-embedded contexts
      newResponse.headers.set(
        'Content-Security-Policy',
        `frame-ancestors https://*.myshopify.com https://admin.shopify.com;`
      );
    }
    
    // Add CORS headers if needed
    newResponse.headers.set('X-Frame-Options', 'ALLOWALL');
    
    return newResponse;
  } catch (error) {
    console.error('Function error:', error);
    console.error('Error stack:', error.stack);
    console.error('Environment check:', {
      SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ? 'SET' : 'MISSING',
      SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET ? 'SET' : 'MISSING',
      SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL || 'MISSING',
      SCOPES: process.env.SCOPES || 'MISSING',
      SESSION_HMAC_SECRET: process.env.SESSION_HMAC_SECRET ? 'SET' : 'MISSING',
      DB: globalThis.DB ? 'SET' : 'MISSING'
    });
    
    // Return a more detailed error response for debugging
    const errorResponse = {
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      env_check: {
        SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ? 'SET' : 'MISSING',
        SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET ? 'SET' : 'MISSING',
        SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL || 'MISSING',
        SCOPES: process.env.SCOPES || 'MISSING',
        DB: globalThis.DB ? 'SET' : 'MISSING'
      }
    };
    
    return new Response(JSON.stringify(errorResponse, null, 2), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Content-Security-Policy': 'frame-ancestors https://*.myshopify.com https://admin.shopify.com;',
        'X-Frame-Options': 'ALLOWALL'
      }
    });
  }
}