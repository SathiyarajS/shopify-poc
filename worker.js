export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Basic routing
    if (url.pathname === '/') {
      return new Response('Hello World! This is a Cloudflare Worker.', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    
    if (url.pathname === '/auth/shopify/callback') {
      return handleOAuthCallback(request, env);
    }
    
    if (url.pathname === '/app') {
      return handleApp(request, env);
    }
    
    if (url.pathname === '/api/shop') {
      return handleShopDetails(request, env);
    }
    
    return new Response('Not Found', { status: 404 });
  },
};

// Handle OAuth callback from Shopify
async function handleOAuthCallback(request, env) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  
  if (!shop || !code) {
    return new Response('Missing required parameters', { status: 400 });
  }
  
  try {
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
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    
    // Store the session (you'll need to implement proper session storage)
    // For now, we'll redirect to the app with the token in a secure way
    
    return Response.redirect(`https://${shop}/admin/apps/${env.SHOPIFY_API_KEY}`, 302);
  } catch (error) {
    console.error('OAuth error:', error);
    return new Response('Authentication failed', { status: 500 });
  }
}

// Handle the main app page
async function handleApp(request, env) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const sessionToken = url.searchParams.get('id_token'); // JWT session token from Shopify
  
  if (!shop) {
    return new Response('Missing shop parameter', { status: 400 });
  }
  
  // Basic HTML page with shop details fetching
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
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Shopify Store Details</h1>
        <div id="shop-details" class="shop-details">
          <div class="loading">Loading shop details...</div>
        </div>
      </div>
      
      <script>
        const shop = '${shop}';
        const sessionToken = '${sessionToken || ''}';
        
        async function fetchShopDetails() {
          try {
            const response = await fetch('/api/shop?shop=' + shop, {
              headers: {
                'Authorization': 'Bearer ' + sessionToken
              }
            });
            
            if (!response.ok) {
              throw new Error('Failed to fetch shop details');
            }
            
            const data = await response.json();
            displayShopDetails(data);
          } catch (error) {
            document.getElementById('shop-details').innerHTML = 
              '<div class="error">Error loading shop details: ' + error.message + '</div>';
          }
        }
        
        function displayShopDetails(data) {
          const detailsHtml = \`
            <div class="detail-row">
              <span class="detail-label">Shop Name:</span>
              <span class="detail-value">\${data.name}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Shop Domain:</span>
              <span class="detail-value">\${data.domain}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Email:</span>
              <span class="detail-value">\${data.email}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Currency:</span>
              <span class="detail-value">\${data.currency}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Plan:</span>
              <span class="detail-value">\${data.plan_name || 'Development'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Country:</span>
              <span class="detail-value">\${data.country_name}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Created At:</span>
              <span class="detail-value">\${new Date(data.created_at).toLocaleDateString()}</span>
            </div>
          \`;
          
          document.getElementById('shop-details').innerHTML = detailsHtml;
        }
        
        // Fetch shop details when page loads
        fetchShopDetails();
      </script>
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

// Handle GraphQL query to get shop details
async function handleShopDetails(request, env) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const authorization = request.headers.get('Authorization');
  
  if (!shop) {
    return new Response(JSON.stringify({ error: 'Missing shop parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // For embedded apps, we need to verify the session token and get the access token
  // For now, we'll use a mock response - you'll need to implement proper session handling
  
  try {
    // GraphQL query to get shop details
    const graphqlQuery = {
      query: `
        query {
          shop {
            name
            email
            currencyCode
            primaryDomain {
              url
              host
            }
            plan {
              displayName
            }
            billingAddress {
              country
              countryCodeV2
            }
            createdAt
            id
          }
        }
      `
    };
    
    // You'll need to get the actual access token from your session storage
    // This is a placeholder - in production, retrieve from D1 database
    const accessToken = env.TEST_ACCESS_TOKEN || 'your-access-token';
    
    const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify(graphqlQuery),
    });
    
    if (!response.ok) {
      // Return mock data for testing
      const mockData = {
        name: shop.replace('.myshopify.com', ''),
        domain: shop,
        email: 'shop@example.com',
        currency: 'USD',
        plan_name: 'Development',
        country_name: 'United States',
        created_at: new Date().toISOString(),
      };
      
      return new Response(JSON.stringify(mockData), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
    const data = await response.json();
    
    // Transform GraphQL response to simpler format
    const shopData = {
      name: data.data.shop.name,
      domain: data.data.shop.primaryDomain.host,
      email: data.data.shop.email,
      currency: data.data.shop.currencyCode,
      plan_name: data.data.shop.plan?.displayName,
      country_name: data.data.shop.billingAddress?.country,
      created_at: data.data.shop.createdAt,
    };
    
    return new Response(JSON.stringify(shopData), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('GraphQL error:', error);
    
    // Return mock data for testing
    const mockData = {
      name: shop.replace('.myshopify.com', ''),
      domain: shop,
      email: 'shop@example.com',
      currency: 'USD',
      plan_name: 'Development',
      country_name: 'United States',
      created_at: new Date().toISOString(),
    };
    
    return new Response(JSON.stringify(mockData), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}