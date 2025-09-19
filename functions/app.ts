export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop') || 'No shop specified';
  
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shopify App Working!</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f4f6f8;
        }
        .success {
            background: #d4f1d4;
            border: 2px solid #4caf50;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .info {
            background: white;
            border: 1px solid #ddd;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .btn {
            background: #008060;
            color: white;
            padding: 12px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <h1>🎉 Shopify App is Working!</h1>
    
    <div class="success">
        <h2>✅ Success!</h2>
        <p>Your Shopify app has been installed and is running correctly on Cloudflare Pages.</p>
    </div>

    <div class="info">
        <h3>📊 App Details</h3>
        <p><strong>Shop:</strong> ${shop}</p>
        <p><strong>Status:</strong> Active ✅</p>
        <p><strong>Platform:</strong> Cloudflare Pages</p>
        <p><strong>Version:</strong> POC v2</p>
    </div>

    <div class="info">
        <h3>🔧 Available APIs</h3>
        <ul>
            <li>✅ OAuth Callback: /auth/shopify/callback</li>
            <li>✅ Session Management: /api/session/refresh</li>
            <li>✅ GraphQL Proxy: /api/shopify/graphql</li>
        </ul>
        <button class="btn" onclick="testAPI()">Test API Connection</button>
    </div>

    <div id="results"></div>

    <script>
        // Initialize App Bridge if in iframe
        if (window.top !== window) {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@shopify/app-bridge@3';
            script.onload = function() {
                try {
                    const app = ShopifyAppBridge.createApp({
                        apiKey: '5810fe1357c5113bec8e8dec0ed9e374',
                        shop: '${shop}',
                        forceRedirect: true
                    });
                    console.log('App Bridge initialized');
                } catch (e) {
                    console.log('App Bridge failed:', e);
                }
            };
            document.head.appendChild(script);
        }

        async function testAPI() {
            const results = document.getElementById('results');
            results.innerHTML = '<div class="info">Testing API...</div>';
            
            try {
                const response = await fetch('/api/session/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shop: '${shop}' })
                });
                const data = await response.json();
                results.innerHTML = \`
                    <div class="success">
                        <h3>✅ API Test Successful!</h3>
                        <pre>\${JSON.stringify(data, null, 2)}</pre>
                    </div>
                \`;
            } catch (error) {
                results.innerHTML = \`
                    <div style="background: #ffebee; border: 1px solid #f44336; padding: 20px; border-radius: 8px;">
                        <h3>❌ API Test Failed</h3>
                        <p>\${error.message}</p>
                    </div>
                \`;
            }
        }
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