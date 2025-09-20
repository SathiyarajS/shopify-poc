#!/bin/bash

echo "Setting up Cloudflare Pages environment variables..."

# Secrets (already done)
echo "✓ SHOPIFY_API_KEY (secret) - already set"
echo "✓ SHOPIFY_API_SECRET (secret) - already set" 
echo "✓ SESSION_HMAC_SECRET (secret) - already set"

echo ""
echo "Please add these environment variables in Cloudflare Dashboard:"
echo "1. Go to https://dash.cloudflare.com"
echo "2. Navigate to Workers & Pages > shopify-poc > Settings > Environment variables"
echo "3. Add these production variables:"
echo ""
echo "SHOPIFY_APP_URL = https://shopify-poc.pages.dev"
echo "SCOPES = read_products,write_products"
echo "NODE_ENV = production"
echo ""
echo "After adding, redeploy the application for changes to take effect."