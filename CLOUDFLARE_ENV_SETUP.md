# Cloudflare Pages Environment Variables Setup

You need to set the following environment variables in your Cloudflare Pages project:

## Required Environment Variables

```bash
SHOPIFY_API_KEY=ce8bab18555211f12e95867a110eeaec
SHOPIFY_API_SECRET=346c23ad740c1eabcd81c9a259eb8a39
SHOPIFY_APP_URL=https://shopify-poc.pages.dev
SCOPES=read_products,write_products
SESSION_HMAC_SECRET=13fcf47ec4220c830a8ec2be14dce7646e2d028b11ec2d1c53760cd5b7598724
NODE_ENV=production
```

## How to Set in Cloudflare Pages

1. Go to Cloudflare Dashboard
2. Navigate to Pages > Your Project > Settings > Environment variables
3. Add each variable above as a production environment variable
4. Redeploy your application

## Using Wrangler CLI (Alternative)

```bash
# Set secrets one by one
wrangler pages secret put SHOPIFY_API_KEY
wrangler pages secret put SHOPIFY_API_SECRET
wrangler pages secret put SESSION_HMAC_SECRET

# Set regular environment variables
wrangler pages deployment create --env SHOPIFY_APP_URL=https://shopify-poc.pages.dev --env SCOPES=read_products,write_products --env NODE_ENV=production
```

## Verify D1 Database

Make sure the D1 database is created and bound:

```bash
# Create D1 database if not exists
wrangler d1 create shopify_poc

# Run migrations
wrangler d1 migrations apply shopify_poc --local
wrangler d1 migrations apply shopify_poc --remote
```