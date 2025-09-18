import { useMemo } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  InlineStack,
  Spinner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useShopifySession } from "../hooks/useShopifySession";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const sessionState = useShopifySession();
  const { session, isLoading, error, needsOAuth, needsReload, buildOAuthUrl, refreshSession } = sessionState;

  const shopFromUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("shop");
  }, []);

  const shopDomain = session?.shop || shopFromUrl || undefined;

  const handleOAuthRedirect = () => {
    if (!shopDomain) return;
    const url = buildOAuthUrl(shopDomain);
    if (!url) return;
    if (window.top) {
      window.top.location.href = url;
    } else {
      window.location.href = url;
    }
  };

  const handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <Page>
      <TitleBar title="AI Bulk Edit" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {isLoading && (
              <Card>
                <BlockStack gap="300" align="center">
                  <Spinner accessibilityLabel="Loading session" size="large" />
                  <Text as="p" variant="bodyMd">
                    Establishing secure session…
                  </Text>
                </BlockStack>
              </Card>
            )}

            {!isLoading && needsReload && (
              <Banner title="Reload required" tone="critical">
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    Your embedded session expired. Reload to continue.
                  </Text>
                  <Button onClick={handleReload}>Reload app</Button>
                </BlockStack>
              </Banner>
            )}

            {!isLoading && needsOAuth && (
              <Banner title="Reconnect to Shopify" tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    We need permission to access your store before continuing.
                  </Text>
                  <InlineStack gap="200">
                    <Button onClick={handleOAuthRedirect} primary disabled={!shopDomain}>
                      Connect store
                    </Button>
                    <Button onClick={refreshSession} variant="secondary">
                      Try again
                    </Button>
                  </InlineStack>
                  {!shopDomain && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Launch the app from Shopify Admin so we know which shop to connect.
                    </Text>
                  )}
                </BlockStack>
              </Banner>
            )}

            {!isLoading && session && !needsOAuth && !needsReload && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Session established
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Shop: {session.shop}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Token expires at {session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "unknown"}.
                  </Text>
                  <InlineStack gap="200">
                    <Button onClick={refreshSession}>Refresh session</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {!isLoading && error && (
              <Banner title="Authentication error" tone="critical">
                <Text as="p" variant="bodyMd">{error}</Text>
              </Banner>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
