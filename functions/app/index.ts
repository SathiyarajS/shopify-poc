export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop') || 'unknown-shop';
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shopify POC App v2</title>
    <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
    <link href="https://unpkg.com/@shopify/polaris@latest/build/esm/styles.css" rel="stylesheet">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #fafbfb;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .header {
            border-bottom: 1px solid #e1e3e5;
            padding-bottom: 16px;
            margin-bottom: 24px;
        }
        .success-banner {
            background-color: #d4f1d4;
            border: 1px solid #9acd32;
            border-radius: 4px;
            padding: 16px;
            margin-bottom: 24px;
            color: #0f5132;
        }
        .info-card {
            border: 1px solid #e1e3e5;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
        }
        .button {
            background-color: #008060;
            color: white;
            border: none;
            padding: 12px 16px;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
        }
        .button:hover {
            background-color: #006e52;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Shopify POC App v2</h1>
            <p>Your Shopify app is running successfully!</p>
        </div>

        <div class="success-banner">
            <h3>✅ Installation Complete!</h3>
            <p>Congratulations! Your Shopify app has been installed and is working correctly.</p>
        </div>

        <div class="info-card">
            <h3>📊 App Status</h3>
            <p><strong>Shop:</strong> ${shop}</p>
            <p><strong>Platform:</strong> Cloudflare Pages</p>
            <p><strong>Status:</strong> ✅ Active and Running</p>
            <p><strong>Version:</strong> v2.0</p>
        </div>

        <div class="info-card">
            <h3>🛠 Available Features</h3>
            <ul>
                <li>✅ OAuth Authentication System</li>
                <li>✅ Session Management</li>
                <li>✅ GraphQL API Proxy</li>
                <li>✅ Product Management (write_products scope)</li>
                <li>✅ Cloudflare D1 Database</li>
            </ul>
        </div>

        <div class="info-card">
            <h3>🔗 API Endpoints</h3>
            <ul>
                <li><strong>Auth Callback:</strong> <code>/auth/shopify/callback</code></li>
                <li><strong>Session Refresh:</strong> <code>/api/session/refresh</code></li>
                <li><strong>GraphQL Proxy:</strong> <code>/api/shopify/graphql</code></li>
            </ul>
        </div>

        <div style="margin-top: 24px;">
            <button class="button" onclick="testConnection()">
                🧪 Test API Connection
            </button>
            <a href="https://shopify.dev/docs/apps" class="button" target="_blank" style="margin-left: 8px;">
                📚 Documentation
            </a>
        </div>

        <div id="test-results" style="margin-top: 16px;"></div>
    </div>

    <script>
        // Initialize Shopify App Bridge for embedded context
        if (window.top !== window && window.ShopifyAppBridge) {
            try {
                const app = window.ShopifyAppBridge.createApp({
                    apiKey: '5810fe1357c5113bec8e8dec0ed9e374',
                    shop: '${shop}',
                    forceRedirect: true
                });
                console.log('✅ App Bridge initialized successfully');
            } catch (error) {
                console.warn('⚠️ App Bridge initialization failed:', error);
            }
        }

        async function testConnection() {
            const resultsDiv = document.getElementById('test-results');
            resultsDiv.innerHTML = '<div class="info-card"><p>🔄 Testing API connection...</p></div>';
            
            try {
                const response = await fetch('/api/session/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shop: '${shop}' })
                });
                
                const data = await response.json();
                resultsDiv.innerHTML = \`
                    <div class="info-card" style="border-color: #4caf50;">
                        <h4>✅ API Connection Successful!</h4>
                        <p><strong>Status:</strong> Connected</p>
                        <p><strong>Response:</strong></p>
                        <pre style="background: #f5f5f5; padding: 8px; border-radius: 4px; overflow-x: auto;">\${JSON.stringify(data, null, 2)}</pre>
                    </div>
                \`;
            } catch (error) {
                resultsDiv.innerHTML = \`
                    <div class="info-card" style="border-color: #f44336;">
                        <h4>❌ API Test Failed</h4>
                        <p><strong>Error:</strong> \${error.message}</p>
                        <p>Please check the console for more details.</p>
                    </div>
                \`;
            }
        }

        // Auto-test connection on page load
        setTimeout(testConnection, 1000);
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache'
    }
  });
};