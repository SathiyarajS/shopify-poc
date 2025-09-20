// Advanced Shopify Worker with OAuth and D1 Session Storage

// Helper to generate random state for OAuth
function generateNonce() {
  return Math.random().toString(36).substring(2, 15);
}

// Helper to verify HMAC signature from Shopify
async function verifyShopifyHMAC(params, secret) {
  const message = Object.keys(params)
    .filter(key => key !== 'hmac' && key !== 'signature')
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
    
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const computedHmac = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
    
  return computedHmac === params.hmac;
}

// Session storage functions
async function saveSession(db, session) {
  const id = `${session.shop}_${Date.now()}`;
  await db.prepare(`
    INSERT OR REPLACE INTO sessions (id, shop, access_token, scope, state, is_online, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    session.shop,
    session.accessToken,
    session.scope || '',
    session.state || '',
    session.isOnline || false,
    session.expiresAt || null
  ).run();
  return id;
}

async function getSession(db, shop) {
  // First try to get OAuth session with real access token
  const result = await db.prepare(`
    SELECT * FROM sessions 
    WHERE shop = ? AND access_token IS NOT NULL AND access_token NOT LIKE 'eyJ%'
    ORDER BY created_at DESC 
    LIMIT 1
  `).bind(shop).first();
  
  if (result) return result;
  
  // Fallback to any session
  return await db.prepare(`
    SELECT * FROM sessions 
    WHERE shop = ? 
    ORDER BY created_at DESC 
    LIMIT 1
  `).bind(shop).first();
}

// Shopify GraphQL query function
async function shopifyGraphQL(shop, accessToken, query, variables = {}) {
  const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  
  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }
  
  return await response.json();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Check if this is an embedded app request from Shopify admin
    const shop = url.searchParams.get('shop');
    const embedded = url.searchParams.get('embedded') === '1';
    const sessionToken = url.searchParams.get('id_token');
    const hmac = url.searchParams.get('hmac');
    
    // If we have Shopify parameters on root, handle as app
    if (url.pathname === '/' && (shop || embedded || sessionToken || hmac)) {
      return handleApp(request, env);
    }
    
    // Basic routing
    if (url.pathname === '/') {
      return handleHome(request, env);
    }
    
    if (url.pathname === '/auth/shopify') {
      return handleAuthStart(request, env);
    }
    
    if (url.pathname === '/auth/shopify/callback') {
      return handleAuthCallback(request, env);
    }
    
    if (url.pathname === '/app') {
      return handleApp(request, env);
    }
    
    if (url.pathname === '/api/shop') {
      return handleShopAPI(request, env);
    }
    
    return new Response('Not Found', { status: 404 });
  },
};

// Home page
async function handleHome(request, env) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Shopify App</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background: #f4f6f8;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
          color: #333;
          border-bottom: 2px solid #008060;
          padding-bottom: 10px;
        }
        .install-form {
          margin-top: 20px;
        }
        input {
          width: 100%;
          padding: 10px;
          margin: 10px 0;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 16px;
        }
        button {
          background: #008060;
          color: white;
          padding: 12px 24px;
          border: none;
          border-radius: 4px;
          font-size: 16px;
          cursor: pointer;
        }
        button:hover {
          background: #006e52;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Shopify App Installation</h1>
        <div class="install-form">
          <form action="/auth/shopify" method="GET">
            <input type="text" name="shop" placeholder="yourstore.myshopify.com" required>
            <button type="submit">Install App</button>
          </form>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}

// Start OAuth flow
async function handleAuthStart(request, env) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  
  if (!shop || !shop.includes('.myshopify.com')) {
    return new Response('Invalid shop domain', { status: 400 });
  }
  
  const state = generateNonce();
  const redirectUri = `${url.origin}/auth/shopify/callback`;
  
  // Store state in D1 for verification
  await env.DB.prepare(`
    INSERT OR REPLACE INTO sessions (id, shop, state, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(
    `state_${state}`,
    shop,
    state,
    Math.floor(Date.now() / 1000)
  ).run();
  
  const authUrl = `https://${shop}/admin/oauth/authorize?` + new URLSearchParams({
    client_id: env.SHOPIFY_API_KEY,
    scope: 'read_products,write_products',
    redirect_uri: redirectUri,
    state: state,
  });
  
  return Response.redirect(authUrl, 302);
}

// Handle OAuth callback
async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const hmac = url.searchParams.get('hmac');
  
  if (!shop || !code || !state) {
    return new Response('Missing required parameters', { status: 400 });
  }
  
  // Verify state
  const storedState = await env.DB.prepare(`
    SELECT state FROM sessions WHERE id = ?
  `).bind(`state_${state}`).first();
  
  if (!storedState || storedState.state !== state) {
    return new Response('Invalid state parameter', { status: 403 });
  }
  
  // Exchange code for access token
  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      code: code,
    }),
  });
  
  if (!tokenResponse.ok) {
    return new Response('Failed to exchange code for token', { status: 500 });
  }
  
  const tokenData = await tokenResponse.json();
  
  // Save the session with access token
  await saveSession(env.DB, {
    shop: shop,
    accessToken: tokenData.access_token,
    scope: tokenData.scope,
    state: state,
    isOnline: false,
    expiresAt: null,
  });
  
  // Clean up the state entry
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(`state_${state}`).run();
  
  // Redirect to the app
  return Response.redirect(`https://${shop}/admin/apps/${env.SHOPIFY_API_KEY}`, 302);
}

// Handle the main app page
async function handleApp(request, env) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const sessionToken = url.searchParams.get('id_token'); // JWT session token from Shopify
  const hmac = url.searchParams.get('hmac');
  const embedded = url.searchParams.get('embedded') === '1';
  
  // Debug logging
  console.log('App request:', {
    shop,
    embedded,
    hasSessionToken: !!sessionToken,
    hasHmac: !!hmac,
    pathname: url.pathname,
    search: url.search
  });
  
  if (!shop) {
    return new Response('Missing shop parameter', { status: 400 });
  }
  
  // If we have a session token from Shopify admin (embedded app)
  // This indicates the app is loaded in Shopify admin, but we still need the OAuth access token
  let isEmbeddedWithSession = false;
  if (sessionToken && embedded) {
    isEmbeddedWithSession = true;
    // Note: The session token (JWT) is different from the OAuth access token
    // We'll check if we have a valid OAuth token stored for this shop
  }
  
  // Get session from D1
  const session = await getSession(env.DB, shop);
  const hasSession = !!session?.access_token;
  
  // Check if session is expired
  const isExpired = session?.expires_at && (session.expires_at < Math.floor(Date.now() / 1000));
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Shopify App</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background: #f4f6f8;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
          color: #333;
          border-bottom: 2px solid #008060;
          padding-bottom: 10px;
        }
        .shop-details {
          margin-top: 20px;
          padding: 20px;
          background: #f9f9f9;
          border-radius: 4px;
        }
        .loading {
          color: #666;
        }
        .error {
          color: #d72c0d;
          padding: 10px;
          background: #fbeae5;
          border-radius: 4px;
        }
        .success {
          color: #008060;
          padding: 10px;
          background: #e5f9f0;
          border-radius: 4px;
        }
        .detail-row {
          margin: 10px 0;
          display: flex;
          justify-content: space-between;
        }
        .detail-label {
          font-weight: 600;
          color: #555;
        }
        .detail-value {
          color: #333;
        }
        .auth-button {
          background: #008060;
          color: white;
          padding: 12px 24px;
          border: none;
          border-radius: 4px;
          font-size: 16px;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
          margin-top: 20px;
        }
        .auth-button:hover {
          background: #006e52;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Shopify Store Details</h1>
        <div id="shop-details" class="shop-details">
          ${isExpired ? 
            '<div class="error">Session expired. Please reload the page to refresh your session.</div>' : 
            hasSession ? 
              '<div class="loading">Loading shop details...</div>' : 
              isEmbeddedWithSession ? 
                '<div class="error">App needs to be authorized. Please click the button below to complete setup.</div>' :
                embedded ?
                  '<div class="error">Session not found. Please reload the app from Shopify admin.</div>' :
                  '<div class="error">No active session. Please install the app first.</div>'
          }
        </div>
        ${!hasSession && !embedded ? `<a href="/auth/shopify?shop=${shop}" class="auth-button">Authenticate with Shopify</a>` : ''}
        ${!hasSession && isEmbeddedWithSession ? `<a href="/auth/shopify?shop=${shop}" class="auth-button" target="_top">Complete App Setup</a>` : ''}
        ${(isExpired || (!hasSession && embedded && !isEmbeddedWithSession)) ? '<button onclick="window.location.reload()" class="auth-button">Reload Page</button>' : ''}
      </div>
      
      ${hasSession && !isExpired ? `
      <script>
        const shop = '${shop}';
        
        async function fetchShopDetails() {
          try {
            const response = await fetch('/api/shop?shop=' + shop);
            
            if (!response.ok) {
              throw new Error('Failed to fetch shop details');
            }
            
            const data = await response.json();
            
            if (data.error) {
              throw new Error(data.error);
            }
            
            displayShopDetails(data);
          } catch (error) {
            document.getElementById('shop-details').innerHTML = 
              '<div class="error">Error loading shop details: ' + error.message + '</div>';
          }
        }
        
        function displayShopDetails(data) {
          const shop = data.data.shop;
          const detailsHtml = \`
            <div class="success">✓ Successfully connected to Shopify</div>
            <div class="detail-row">
              <span class="detail-label">Shop Name:</span>
              <span class="detail-value">\${shop.name}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Shop Domain:</span>
              <span class="detail-value">\${shop.myshopifyDomain}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Email:</span>
              <span class="detail-value">\${shop.email}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Currency:</span>
              <span class="detail-value">\${shop.currencyCode}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Plan:</span>
              <span class="detail-value">\${shop.plan?.displayName || 'Development'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Primary Domain:</span>
              <span class="detail-value">\${shop.primaryDomain?.host || shop.myshopifyDomain}</span>
            </div>
          \`;
          
          document.getElementById('shop-details').innerHTML = detailsHtml;
        }
        
        // Fetch shop details when page loads
        fetchShopDetails();
      </script>
      ` : ''}
    </body>
    </html>
  `;
  
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
      'Content-Security-Policy': `frame-ancestors https://${shop} https://admin.shopify.com;`,
      'X-Frame-Options': 'ALLOWALL',
    },
  });
}

// API endpoint to get shop details using stored session
async function handleShopAPI(request, env) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  
  if (!shop) {
    return new Response(JSON.stringify({ error: 'Missing shop parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // Get session from D1
  const session = await getSession(env.DB, shop);
  
  if (!session || !session.access_token) {
    return new Response(JSON.stringify({ error: 'No active session found' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  try {
    // GraphQL query to get shop details
    const query = `
      query getShop {
        shop {
          id
          name
          myshopifyDomain
          primaryDomain {
            host
            url
          }
          email
          currencyCode
          plan {
            displayName
            partnerDevelopment
          }
        }
      }
    `;
    
    const result = await shopifyGraphQL(shop, session.access_token, query);
    
    return new Response(JSON.stringify(result), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('GraphQL error:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      details: 'Failed to fetch shop details from Shopify'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}