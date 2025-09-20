export async function onRequest(context) {
  try {
    console.log('Test function called');
    console.log('Environment variables available:', Object.keys(context.env));
    
    const envInfo = {
      has_db: !!context.env.DB,
      has_shopify_api_key: !!context.env.SHOPIFY_API_KEY,
      has_shopify_api_secret: !!context.env.SHOPIFY_API_SECRET,
      has_shopify_app_url: !!context.env.SHOPIFY_APP_URL,
      has_scopes: !!context.env.SCOPES,
      has_session_secret: !!context.env.SESSION_HMAC_SECRET,
      shopify_app_url: context.env.SHOPIFY_APP_URL,
      scopes: context.env.SCOPES,
      env_keys: Object.keys(context.env)
    };
    
    return new Response(JSON.stringify(envInfo, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
      stack: error.stack
    }, null, 2), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}