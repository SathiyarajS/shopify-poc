import { useCallback, useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
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
import { useI18n } from "../lib/i18n";

const SHOP_QUERY = `#graphql
  query BasicShopInfo {
    shop {
      id
      name
      email
      myshopifyDomain
      currencyCode
      plan {
        displayName
        partnerDevelopment
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

interface ShopInfo {
  id: string;
  name: string;
  email: string | null;
  myshopifyDomain: string;
  currencyCode: string;
  planDisplayName: string | null;
  partnerDevelopment: boolean;
}

export default function Index() {
  const { t, locale } = useI18n();
  const sessionState = useShopifySession();
  const { session, isLoading, needsOAuth, needsReload, buildOAuthUrl, refreshSession } = sessionState;

  const [shopInfo, setShopInfo] = useState<ShopInfo | null>(null);
  const [shopError, setShopError] = useState<string | null>(null);
  const [loadingShop, setLoadingShop] = useState(false);

  const shopFromUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("shop");
  }, []);

  const shopDomain = session?.shop || shopFromUrl || undefined;

  const handleOAuthRedirect = useCallback(() => {
    if (!shopDomain) return;
    const url = buildOAuthUrl(shopDomain);
    if (!url) return;
    if (window.top) {
      window.top.location.href = url;
    } else {
      window.location.href = url;
    }
  }, [buildOAuthUrl, shopDomain]);

  const handleReload = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    async function fetchShopInfo() {
      if (!session) return;
      setLoadingShop(true);
      setShopError(null);
      try {
        const response = await fetch("/api/shopify/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: session.sessionToken ? `Bearer ${session.sessionToken}` : "",
          },
          body: JSON.stringify({ query: SHOP_QUERY, shop: session.shop }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const payload = await response.json();
        if (payload.errors?.length) {
          throw new Error(payload.errors[0].message || "Unknown Shopify error");
        }

        const shop = payload.data?.shop;
        if (!shop) {
          throw new Error("No shop data returned");
        }

        setShopInfo({
          id: shop.id,
          name: shop.name,
          email: shop.email ?? null,
          myshopifyDomain: shop.myshopifyDomain,
          currencyCode: shop.currencyCode,
          planDisplayName: shop.plan?.displayName ?? null,
          partnerDevelopment: Boolean(shop.plan?.partnerDevelopment),
        });
      } catch (error) {
        console.error("Failed to load shop info", error);
        setShopError((error as Error).message);
      } finally {
        setLoadingShop(false);
      }
    }

    fetchShopInfo();
  }, [session]);

  return (
    <Page>
      <TitleBar title={t("app.title")} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {isLoading && (
              <Card>
                <BlockStack gap="300" align="center">
                  <Spinner accessibilityLabel={t("session.loading")} size="large" />
                  <Text as="p" variant="bodyMd">
                    {t("session.loading")}
                  </Text>
                </BlockStack>
              </Card>
            )}

            {!isLoading && needsReload && (
              <Banner title={t("session.reload.title")} tone="critical">
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    {t("session.reload.body")}
                  </Text>
                  <Button onClick={handleReload}>{t("session.reload.button")}</Button>
                </BlockStack>
              </Banner>
            )}

            {!isLoading && needsOAuth && (
              <Banner title={t("session.oauth.title")} tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    {t("session.oauth.body")}
                  </Text>
                  <InlineStack gap="200">
                    <Button onClick={handleOAuthRedirect} primary disabled={!shopDomain}>
                      {t("session.oauth.button")}
                    </Button>
                    <Button onClick={refreshSession} variant="secondary">
                      {t("session.oauth.retry")}
                    </Button>
                  </InlineStack>
                  {!shopDomain && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("session.oauth.missingShop")}
                    </Text>
                  )}
                </BlockStack>
              </Banner>
            )}

            {!isLoading && session && !needsOAuth && !needsReload && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {shopInfo ? `Welcome, ${shopInfo.name}!` : "Welcome"}
                  </Text>
                  {loadingShop && (
                    <InlineStack gap="200" align="center">
                      <Spinner size="small" accessibilityLabel="Loading shop details" />
                      <Text as="p" variant="bodySm">
                        Fetching shop details…
                      </Text>
                    </InlineStack>
                  )}
                  {shopError && (
                    <Banner tone="critical" title="Unable to load shop">
                      <Text as="p" variant="bodyMd">{shopError}</Text>
                    </Banner>
                  )}
                  {shopInfo && (
                    <BlockStack gap="200">
                      <Text as="p" variant="bodyMd">
                        Store domain: {shopInfo.myshopifyDomain}
                      </Text>
                      <Text as="p" variant="bodyMd">
                        Email: {shopInfo.email ?? "—"}
                      </Text>
                      <Text as="p" variant="bodyMd">
                        Currency: {shopInfo.currencyCode}
                      </Text>
                      <Text as="p" variant="bodyMd">
                        Plan: {shopInfo.planDisplayName ?? "Unknown"}
                        {shopInfo.partnerDevelopment ? " (Development store)" : ""}
                      </Text>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
