import { useEffect } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  Link,
  InlineStack,
  Banner,
} from "@shopify/polaris";
import { ShopifySessionProvider, useShopifySessionContext } from "../components/ShopifySessionProvider";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // No authentication needed at loader level - handled by session provider
  return null;
};

function SessionInfo() {
  const { session, refreshSession, clearCurrentSession } = useShopifySessionContext();

  if (!session) {
    return null;
  }

  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingMd">
          Session Information
        </Text>
        <Text as="p" variant="bodyMd">
          Shop: <strong>{session.shop}</strong>
        </Text>
        <Text as="p" variant="bodyMd">
          Embedded: <strong>{session.isEmbedded ? 'Yes' : 'No'}</strong>
        </Text>
        <Text as="p" variant="bodyMd">
          Has Access Token: <strong>{session.accessToken ? 'Yes' : 'No'}</strong>
        </Text>
        {session.scope && (
          <Text as="p" variant="bodyMd">
            Scopes: <strong>{session.scope}</strong>
          </Text>
        )}
        {session.expiresAt && (
          <Text as="p" variant="bodyMd">
            Expires: <strong>{new Date(session.expiresAt).toLocaleString()}</strong>
          </Text>
        )}
        <InlineStack gap="200">
          <Button onClick={refreshSession}>
            Refresh Session
          </Button>
          <Button onClick={clearCurrentSession}>
            Clear Session
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function SessionDemo() {
  const { session } = useShopifySessionContext();

  const makeApiCall = async () => {
    if (!session?.accessToken) {
      console.error('No access token available');
      return;
    }

    try {
      // Example API call using the session token
      const response = await fetch(`https://${session.shop}/admin/api/2024-10/shop.json`, {
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Shop data:', data);
      } else {
        console.error('API call failed:', response.statusText);
      }
    } catch (error) {
      console.error('API call error:', error);
    }
  };

  return (
    <Page>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Session-Based OAuth Demo 🎉
                  </Text>
                  <Text variant="bodyMd" as="p">
                    This demonstrates session-based OAuth similar to the canvas-merchant-hub implementation.
                    Sessions are managed in browser storage with database fallback.
                  </Text>
                  <Banner tone="success" title="Session Active">
                    <p>Your session is active and you can make authenticated API calls.</p>
                  </Banner>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Test API Call
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Click the button below to make a test API call using your session token.
                    Check the browser console for the response.
                  </Text>
                </BlockStack>
                <InlineStack gap="300">
                  <Button variant="primary" onClick={makeApiCall}>
                    Test Shop API Call
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              <SessionInfo />
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Session Features
                  </Text>
                  <List>
                    <List.Item>
                      Browser storage for session persistence
                    </List.Item>
                    <List.Item>
                      Database fallback for session recovery
                    </List.Item>
                    <List.Item>
                      Automatic session refresh when near expiry
                    </List.Item>
                    <List.Item>
                      Embedded app detection and handling
                    </List.Item>
                    <List.Item>
                      OAuth flow for new installations
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

export default function SessionDemoPage() {
  return (
    <ShopifySessionProvider
      scopes={['read_products', 'write_products', 'read_orders']}
      redirectUri="/auth/shopify/callback"
    >
      <SessionDemo />
    </ShopifySessionProvider>
  );
}