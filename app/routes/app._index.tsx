import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form as RemixForm, useActionData } from "@remix-run/react";
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
  TextField,
  FormLayout,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { z } from "zod";

import { authenticate } from "../shopify.server";
import { useShopifySession } from "../hooks/useShopifySession";
import { useI18n, formatSummary } from "../lib/i18n";
import type { PlanResponse, PlanSuccess, PlanClarify } from "../../shared/planning/schemas";
import { PlanResponseSchema } from "../../shared/planning/schemas";

/**
 * Phase 1 — simple price operations configuration
 */
type Phase1OperationMode = "inc_percent" | "inc_value" | "set";

interface Phase1Operation {
  mode: Phase1OperationMode;
  value: number;
  filterTerm?: string | null;
}

interface Phase1PreviewItem {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle?: string | null;
  currentPrice: number;
  newPrice: number;
}

interface Phase1Plan {
  prompt: string;
  operation: Phase1Operation;
  filterTerm?: string | null;
  items: Phase1PreviewItem[];
}

type ActionData =
  | { result: "plan"; plan: Phase1Plan }
  | { result: "applied"; applied: number }
  | { result: "error"; message: string };

const Phase1PlanSchema = z.object({
  prompt: z.string(),
  operation: z.object({
    mode: z.enum(["inc_percent", "inc_value", "set"]),
    value: z.number(),
    filterTerm: z.string().nullable().optional(),
  }),
  filterTerm: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        productId: z.string(),
        productTitle: z.string(),
        variantId: z.string(),
        variantTitle: z.string().nullable().optional(),
        currentPrice: z.number(),
        newPrice: z.number().optional(),
      }),
    )
    .max(10),
});

const MAX_PREVIEW_VARIANTS = 10;

const PREVIEW_QUERY = `#graphql
  query Phase1Preview($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          variants(first: 10) {
            edges {
              node {
                id
                title
                price
              }
            }
          }
        }
      }
    }
  }
`;

const UPDATE_MUTATION = `#graphql
  mutation Phase1Update($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function extractPercentage(text: string): number | null {
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return parseFloat(match[1]);
}

function extractAmount(text: string): number | null {
  const match = text.match(/[\$€£¥₹]?\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractFilterTerm(text: string): string | null {
  const match = text.match(/(?:for|of|on|in)\s+([A-Za-z0-9\s'\-]+)/i);
  if (!match) return null;
  const term = match[1]?.replace(/[.,!?]+$/g, "").trim();
  return term?.length ? term : null;
}

function buildProductQuery(term?: string | null): string | undefined {
  if (!term) return undefined;
  const sanitized = term.replace(/[^A-Za-z0-9\s-]/g, " ").trim();
  if (!sanitized) return undefined;
  const tokens = sanitized.split(/\s+/).slice(0, 3);
  if (tokens.length === 0) return undefined;
  return tokens.map((t) => `title:*${t}*`).join(" AND ");
}

function computeNewPrice(current: number, operation: Phase1Operation): number {
  let next = current;
  switch (operation.mode) {
    case "inc_percent":
      next = current * (1 + operation.value / 100);
      break;
    case "inc_value":
      next = current + operation.value;
      break;
    case "set":
      next = operation.value;
      break;
  }
  const rounded = Math.max(0, parseFloat(next.toFixed(2)));
  return Number.isFinite(rounded) ? rounded : current;
}

function parsePriceIntent(prompt: string): { ok: true; operation: Phase1Operation } | { ok: false; message: string } {
  const text = prompt.trim();
  if (!text) return { ok: false, message: "Enter a description of the price change." };

  const lower = text.toLowerCase();
  let mode: Phase1OperationMode | null = null;
  let value: number | null = null;

  if (/increase|raise|mark\s*up/.test(lower)) {
    const percent = extractPercentage(text);
    if (percent !== null) {
      mode = "inc_percent";
      value = Math.abs(percent);
    } else {
      const amount = extractAmount(text);
      if (amount !== null) {
        mode = "inc_value";
        value = Math.abs(amount);
      }
    }
  }

  if (!mode && /decrease|reduce|drop|lower|discount/.test(lower)) {
    const percent = extractPercentage(text);
    if (percent !== null) {
      mode = "inc_percent";
      value = -Math.abs(percent);
    } else {
      const amount = extractAmount(text);
      if (amount !== null) {
        mode = "inc_value";
        value = -Math.abs(amount);
      }
    }
  }

  if (!mode && /set|change|update/.test(lower)) {
    const amount = extractAmount(text);
    if (amount !== null) {
      mode = "set";
      value = amount;
    }
  }

  if (mode === null || value === null) {
    return { ok: false, message: "Could not determine the price adjustment. Include a number or percentage." };
  }

  const filterTerm = extractFilterTerm(text);

  return {
    ok: true,
    operation: {
      mode,
      value,
      filterTerm,
    },
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "plan") {
    const prompt = formData.get("prompt");
    if (typeof prompt !== "string") {
      return json<ActionData>({ result: "error", message: "Prompt is required." });
    }

    const parsed = parsePriceIntent(prompt);
    if (!parsed.ok) {
      return json<ActionData>({ result: "error", message: parsed.message });
    }

    try {
      const query = buildProductQuery(parsed.operation.filterTerm ?? undefined);
      const response = await admin.graphql(PREVIEW_QUERY, {
        variables: {
          first: MAX_PREVIEW_VARIANTS,
          query: query ?? undefined,
        },
      });
      const payload = await response.json();

      if (payload.errors?.length) {
        console.error("Phase1 preview errors", payload.errors);
        return json<ActionData>({ result: "error", message: "Shopify preview query failed." });
      }

      const products = payload?.data?.products?.edges ?? [];
      const items: Phase1PreviewItem[] = [];

      for (const productEdge of products) {
        if (!productEdge?.node) continue;
        const productId = productEdge.node.id as string;
        const productTitle = productEdge.node.title as string;
        const variants = productEdge.node.variants?.edges ?? [];

        for (const variantEdge of variants) {
          if (!variantEdge?.node) continue;
          const priceString = variantEdge.node.price as string;
          const currentPrice = parseFloat(priceString);
          if (!Number.isFinite(currentPrice)) continue;

          const newPrice = computeNewPrice(currentPrice, parsed.operation);
          items.push({
            productId,
            productTitle,
            variantId: variantEdge.node.id as string,
            variantTitle: (variantEdge.node.title as string) ?? null,
            currentPrice,
            newPrice,
          });

          if (items.length >= MAX_PREVIEW_VARIANTS) break;
        }

        if (items.length >= MAX_PREVIEW_VARIANTS) break;
      }

      if (items.length === 0) {
        return json<ActionData>({
          result: "error",
          message: parsed.operation.filterTerm
            ? `No variants matched "${parsed.operation.filterTerm}".`
            : "No variants found to update.",
        });
      }

      const plan: Phase1Plan = {
        prompt,
        operation: parsed.operation,
        filterTerm: parsed.operation.filterTerm,
        items,
      };

      return json<ActionData>({ result: "plan", plan });
    } catch (error) {
      console.error("Phase1 plan failure", error);
      return json<ActionData>({ result: "error", message: "Failed to build preview." });
    }
  }

  if (intent === "apply") {
    const planRaw = formData.get("plan");
    if (typeof planRaw !== "string") {
      return json<ActionData>({ result: "error", message: "Missing plan data." });
    }

    try {
      const parsedPlan = Phase1PlanSchema.parse(JSON.parse(planRaw));
      const updates = new Map<
        string,
        { productTitle: string; variants: { id: string; price: string }[] }
      >();

      parsedPlan.items.forEach((item) => {
        const newPrice = computeNewPrice(item.currentPrice, parsedPlan.operation);
        const group = updates.get(item.productId) ?? {
          productTitle: item.productTitle,
          variants: [],
        };
        group.variants.push({ id: item.variantId, price: newPrice.toFixed(2) });
        updates.set(item.productId, group);
      });

      let applied = 0;
      const errors: string[] = [];

      for (const [productId, group] of updates) {
        const response = await admin.graphql(UPDATE_MUTATION, {
          variables: {
            productId,
            variants: group.variants,
          },
        });
        const payload = await response.json();
        const userErrors = payload?.data?.productVariantsBulkUpdate?.userErrors ?? [];
        if (userErrors.length > 0) {
          userErrors.forEach((err: { message?: string }) => {
            if (err?.message) errors.push(err.message);
          });
        } else {
          applied += group.variants.length;
        }
      }

      if (errors.length > 0) {
        return json<ActionData>({
          result: "error",
          message: errors.join("; "),
        });
      }

      return json<ActionData>({ result: "applied", applied });
    } catch (error) {
      console.error("Phase1 apply failure", error);
      return json<ActionData>({ result: "error", message: "Failed to apply price changes." });
    }
  }

  return json<ActionData>({ result: "error", message: "Unsupported action." });
};

function renderFilterList(filterSpec: PlanSuccess["filterSpec"], t: ReturnType<typeof useI18n>["t"]) {
  const filters: string[] = [];
  if (filterSpec.titleContains) {
    filters.push(`${t("plan.result.filters")}: ${filterSpec.titleContains}`);
  }
  if (filterSpec.must.tags.length > 0) {
    filters.push(`tags: ${filterSpec.must.tags.join(", ")}`);
  }
  if (filterSpec.must.vendors.length > 0) {
    filters.push(`vendors: ${filterSpec.must.vendors.join(", ")}`);
  }
  if (filterSpec.must.types.length > 0) {
    filters.push(`types: ${filterSpec.must.types.join(", ")}`);
  }
  if (filterSpec.must.collections.length > 0) {
    filters.push(`collections: ${filterSpec.must.collections.join(", ")}`);
  }
  if (filterSpec.mustNot.tags.length > 0) {
    filters.push(`exclude tags: ${filterSpec.mustNot.tags.join(", ")}`);
  }
  if (Object.keys(filterSpec.numeric).length > 0) {
    const numericEntries = Object.entries(filterSpec.numeric)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}: ${value}`);
    filters.push(...numericEntries);
  }

  if (filters.length === 0) {
    return (
      <Text as="p" variant="bodySm" tone="subdued">
        {t("plan.result.filters")}: —
      </Text>
    );
  }

  return (
    <BlockStack gap="100">
      {filters.map((entry) => (
        <Text key={entry} as="p" variant="bodySm">
          {entry}
        </Text>
      ))}
    </BlockStack>
  );
}

function getSummaryVars(plan: PlanSuccess): Record<string, string | number> | undefined {
  switch (plan.opSpec.operation) {
    case "price":
    case "compare_at":
      return { value: Math.abs(plan.opSpec.params.value) };
    case "tags":
      return { tags: plan.opSpec.params.values.join(", ") };
    default:
      return undefined;
  }
}

function PlanResultCard({
  plan,
  t,
  locale,
}: {
  plan: PlanSuccess;
  t: ReturnType<typeof useI18n>["t"];
  locale: string;
}) {
  const summary = formatSummary(plan.summaryKey, getSummaryVars(plan), locale);
  const confidenceLabel = t(`plan.confidence.${plan.confidence}`);

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {t("plan.result.heading")}
        </Text>
        {summary && (
          <Text as="p" variant="bodyMd">
            {summary}
          </Text>
        )}
        <Divider />
        <Text as="p" variant="bodySm">
          {t("plan.result.operation")}: {plan.opSpec.operation}
        </Text>
        <Text as="p" variant="bodySm">
          {t("plan.result.scope")}: {plan.opSpec.scope}
        </Text>
        <Text as="p" variant="bodySm">
          {t("plan.result.params")}:
        </Text>
        <pre
          style={{
            margin: 0,
            padding: "12px",
            backgroundColor: "var(--p-color-bg-surface-secondary)",
            borderRadius: "8px",
          }}
        >
          {JSON.stringify(plan.opSpec.params, null, 2)}
        </pre>
        {renderFilterList(plan.filterSpec, t)}
        <Text as="p" variant="bodySm">
          {t("plan.result.confidence", { confidence: confidenceLabel })}
        </Text>
      </BlockStack>
    </Card>
  );
}

function ClarifyCard({ clarify, t }: { clarify: PlanClarify; t: ReturnType<typeof useI18n>["t"] }) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {t("plan.clarify.heading")}
        </Text>
        <Text as="p" variant="bodyMd">
          {t("plan.clarify.instructions")}
        </Text>
        <BlockStack gap="200">
          {clarify.issues.map((issue) => (
            <Banner key={issue.code} tone="warning">
              <Text as="p" variant="bodyMd">
                {t(issue.messageKey)}
              </Text>
            </Banner>
          ))}
        </BlockStack>
        {clarify.draft?.opSpec && (
          <BlockStack gap="200">
            <Divider />
            <Text as="p" variant="bodySm" tone="subdued">
              Draft operation:
            </Text>
            <pre
              style={{
                margin: 0,
                padding: "12px",
                backgroundColor: "var(--p-color-bg-surface-secondary)",
                borderRadius: "8px",
              }}
            >
              {JSON.stringify(clarify.draft.opSpec, null, 2)}
            </pre>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

export default function Index() {
  const sessionState = useShopifySession();
  const { t, locale } = useI18n();
  const actionData = useActionData<typeof action>();

  const phase1Plan = actionData?.result === "plan" ? actionData.plan : null;
  const phase1AppliedCount = actionData?.result === "applied" ? actionData.applied : null;
  const phase1ErrorMessage = actionData?.result === "error" ? actionData.message : null;

  const { session, isLoading, error, needsOAuth, needsReload, buildOAuthUrl, refreshSession } = sessionState;

  const [phase1Prompt, setPhase1Prompt] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);

  useEffect(() => {
    if (phase1Plan) {
      setPhase1Prompt(phase1Plan.prompt);
    }
  }, [phase1Plan]);

  useEffect(() => {
    if (phase1AppliedCount !== null) {
      setPhase1Prompt("");
    }
  }, [phase1AppliedCount]);

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

  const submitPlan = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    setIsPlanning(true);
    setPlanError(null);
    setPlanResponse(null);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiPrompt, locale: locale ?? "en" }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const jsonPayload = await response.json();
      const parsed = PlanResponseSchema.safeParse(jsonPayload);
      if (!parsed.success) {
        throw new Error("Invalid response format");
      }

      if (parsed.data.action === "error") {
        setPlanResponse(null);
        setPlanError(parsed.data.message ?? t("plan.error.unexpected"));
      } else {
        setPlanResponse(parsed.data);
      }
    } catch (err) {
      console.error("Failed to generate plan", err);
      setPlanError(t("plan.error.unexpected"));
    } finally {
      setIsPlanning(false);
    }
  }, [aiPrompt, locale, t]);

  const phase1PlanHidden = phase1Plan ? JSON.stringify(phase1Plan) : "";

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
                    {t("session.established.title")}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    {t("session.established.shop", { shop: session.shop })}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {session.expiresAt
                      ? t("session.established.expires", {
                          timestamp: new Date(session.expiresAt).toLocaleString(),
                        })
                      : ""}
                  </Text>
                  <InlineStack gap="200">
                    <Button onClick={refreshSession}>{t("session.established.refresh")}</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {!isLoading && session && !needsOAuth && !needsReload && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Phase 1 · Simple price editor
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Natural-language parsing with per-variant previews. Limited to the first {MAX_PREVIEW_VARIANTS} variants.
                  </Text>
                  {phase1AppliedCount !== null && (
                    <Banner tone="success" title="Price updates applied">
                      <Text as="p" variant="bodyMd">
                        {phase1AppliedCount} variants updated successfully.
                      </Text>
                    </Banner>
                  )}
                  {phase1ErrorMessage && (
                    <Banner tone="critical" title="Unable to complete action">
                      <Text as="p" variant="bodyMd">
                        {phase1ErrorMessage}
                      </Text>
                    </Banner>
                  )}
                  <RemixForm method="post">
                    <input type="hidden" name="intent" value="plan" />
                    <FormLayout>
                      <TextField
                        label="Describe the price change"
                        name="prompt"
                        value={phase1Prompt}
                        onChange={setPhase1Prompt}
                        autoComplete="off"
                        placeholder="e.g. Increase hoodie prices by 10%"
                        multiline={3}
                        requiredIndicator
                      />
                      <Button submit primary disabled={!phase1Prompt.trim()}>
                        Preview price change
                      </Button>
                    </FormLayout>
                  </RemixForm>

                  {phase1Plan && (
                    <BlockStack gap="300">
                      <Divider />
                      <Text as="h3" variant="headingSm">
                        Preview ({phase1Plan.items.length} variants)
                      </Text>
                      <div style={{ overflowX: "auto" }}>
                        <table
                          style={{
                            width: "100%",
                            borderCollapse: "collapse",
                          }}
                        >
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid var(--p-color-border)" }}>
                                Product / Variant
                              </th>
                              <th style={{ textAlign: "right", padding: "8px", borderBottom: "1px solid var(--p-color-border)" }}>
                                Current price
                              </th>
                              <th style={{ textAlign: "right", padding: "8px", borderBottom: "1px solid var(--p-color-border)" }}>
                                New price
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {phase1Plan.items.map((item) => (
                              <tr key={item.variantId}>
                                <td style={{ padding: "8px", borderBottom: "1px solid var(--p-color-border-subdued)" }}>
                                  <Text as="p" variant="bodySm">
                                    {item.productTitle}
                                  </Text>
                                  {item.variantTitle && (
                                    <Text as="p" variant="bodyXs" tone="subdued">
                                      {item.variantTitle}
                                    </Text>
                                  )}
                                </td>
                                <td style={{ padding: "8px", textAlign: "right", borderBottom: "1px solid var(--p-color-border-subdued)" }}>
                                  {item.currentPrice.toFixed(2)}
                                </td>
                                <td style={{ padding: "8px", textAlign: "right", borderBottom: "1px solid var(--p-color-border-subdued)" }}>
                                  {(item.newPrice ?? computeNewPrice(item.currentPrice, phase1Plan.operation)).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <InlineStack gap="200">
                        <RemixForm method="post">
                          <input type="hidden" name="intent" value="apply" />
                          <input type="hidden" name="plan" value={phase1PlanHidden} />
                          <Button submit primary>
                            Apply to {phase1Plan.items.length} variants
                          </Button>
                        </RemixForm>
                      </InlineStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            )}

            {/* Phase 2 planning prototype remains available */}
            {!isLoading && session && !needsOAuth && !needsReload && (
              <Card sectioned>
                <FormLayout>
                  <TextField
                    label={t("plan.composer.placeholder")}
                    value={aiPrompt}
                    onChange={setAiPrompt}
                    autoComplete="off"
                    placeholder={t("plan.composer.placeholder")}
                    multiline={4}
                  />
                  <Button onClick={submitPlan} primary loading={isPlanning} disabled={!aiPrompt.trim()}>
                    {t("plan.composer.submit")}
                  </Button>
                </FormLayout>
              </Card>
            )}

            {isPlanning && (
              <Card>
                <BlockStack gap="200" align="center">
                  <Spinner accessibilityLabel={t("plan.status.processing")} size="large" />
                  <Text as="p" variant="bodyMd">
                    {t("plan.status.processing")}
                  </Text>
                </BlockStack>
              </Card>
            )}

            {planError && (
              <Banner title={t("session.error.title")} tone="critical">
                <Text as="p" variant="bodyMd">
                  {planError}
                </Text>
              </Banner>
            )}

            {planResponse?.action === "plan" && (
              <PlanResultCard plan={planResponse} t={t} locale={locale ?? "en"} />
            )}

            {planResponse?.action === "clarify" && (
              <ClarifyCard clarify={planResponse} t={t} />
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
