# Quick POC Deployment to Cloudflare

## Minimal Setup (5 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Quick Deploy to Cloudflare Pages

#### Option A: GitHub Auto-Deploy (Easiest)
1. Push your code to GitHub
2. Go to [Cloudflare Pages](https://pages.cloudflare.com)
3. Connect your GitHub repo
4. Use these settings:
   - Build command: `npm run build`
   - Output directory: `build/client`
5. Deploy!

Your app will be at: `https://shopify-poc.pages.dev`

#### Option B: Direct Upload (No Git needed)
```bash
# Build locally
npm run build

# Upload the build/client folder directly to Cloudflare Pages dashboard
```

### 3. Update Shopify App Settings

In your [Shopify Partner Dashboard](https://partners.shopify.com):

1. Go to your app settings
2. Update these 2 URLs with your Cloudflare URL:
   - **App URL**: `https://shopify-poc.pages.dev`
   - **Allowed redirection URL**: `https://shopify-poc.pages.dev/api/auth`

### 4. Test Your App

1. Create a development store in Partner Dashboard
2. Install your app
3. Done!

## That's it! 🎉

No database setup, no complex configs. The app will use in-memory storage for the POC.

---

## Only If Needed:

**Environment Variables** (set in Cloudflare Pages dashboard):
- `SHOPIFY_API_KEY`: From Partner Dashboard
- `SHOPIFY_API_SECRET`: From Partner Dashboard
- `SCOPES`: "write_products"

**Having Issues?**
- Check Cloudflare Pages > Functions logs
- Verify your Shopify API credentials are correct