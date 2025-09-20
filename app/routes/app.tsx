import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { getShopify } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { authenticate } = getShopify();
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/additional">Additional page</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  
  // Log error details for debugging
  console.error('App Error Boundary:', error);
  
  // Check if it's an environment configuration error
  if (error instanceof Error && error.message.includes('environment variable')) {
    return (
      <div style={{ padding: '20px', fontFamily: 'monospace' }}>
        <h1>Configuration Error</h1>
        <p style={{ color: 'red' }}>{error.message}</p>
        <details>
          <summary>Required Environment Variables</summary>
          <ul>
            <li>SHOPIFY_API_KEY</li>
            <li>SHOPIFY_API_SECRET</li>
            <li>SHOPIFY_APP_URL</li>
            <li>SCOPES</li>
            <li>SESSION_HMAC_SECRET</li>
          </ul>
        </details>
        <p>Please ensure these are set in Cloudflare Pages environment variables.</p>
      </div>
    );
  }
  
  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
