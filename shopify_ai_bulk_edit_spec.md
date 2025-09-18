# Shopify AI Bulk Edit App — Master Specification (Cloudflare + Shopify Embedded)

This master spec consolidates all finalized decisions and adds detailed implementation guidance for **high-accuracy, cost‑efficient** bulk editing via a **chat-first** UI. It is intended for direct handoff to implementation agents.

> **Stack**: Shopify Embedded Admin App • React + Polaris • GPT‑4o mini (planning/clarify only) • Cloudflare (Workers, Pages, D1, KV, R2, Queues, Cron, Durable Objects) • GDPR compliant.

---

## 1) Goals & Non‑Goals

### Goals

* **Accuracy** across the pipeline: user intent → correct selection (scope) → correct transformation (before→after) → executed exactly as previewed.
* **Efficiency**: one Shopify data pass per task; all refinements local; CSV compressed if large.
* **Merchant‑friendly UX**: chat + chips, inline preview (when small), CSV preview/export, floating progress popup.
* **Compliance**: Embedded app, Shopify Admin APIs, GDPR lifecycle, webhook validation.
* **Cost‑effective**: Cloudflare serverless everywhere.

### Non‑Goals (MVP)

* No traditional **CSV import** (input).
* No **one‑click revert/undo** in UI (data captured for future revert).
* No full semantic RAG in hot path; use **alias/lexicon** + deterministic filters.

---

## 2) Supported Operations (Bulk)

| Domain         | Operation                               | Params (OpSpec)                        | Notes                                  |                              |                                        |
| -------------- | --------------------------------------- | -------------------------------------- | -------------------------------------- | ---------------------------- | -------------------------------------- |
| Price          | Increase/Decrease by %/value; Set exact | \`mode: inc\_percent                   | inc\_value                             | set`, `value`, `round\`      | Applies to product/variant price.      |
| Compare-at     | Set/Adjust                              | same as price                          | Optional rounding.                     |                              |                                        |
| Tags           | Add / Remove / Replace                  | \`mode: add                            | remove                                 | replace`, `value(s)\`        | Δ shown in preview.                    |
| Inventory      | Set / Increment / Decrement             | \`mode: set                            | inc                                    | dec`, `value`, `locationId\` | Requires location chip; variant-level. |
| Status         | Publish / Unpublish / Archive           | \`status: ACTIVE                       | DRAFT                                  | ARCHIVED\`                   | Destructive ops get 2‑key confirm.     |
| SEO            | Title / Description                     | `seo: { title?, description? }`        | Truncate/validate lengths.             |                              |                                        |
| Metafield      | Create / Update / Delete                | `metafield: { ns, key, type, value? }` | Validate type; map to product/variant. |                              |                                        |
| Product fields | Vendor / Type / Weight                  | field‑specific params                  | Keep minimal set for MVP.              |                              |                                        |

> Extendable: collections assignment, sales channels visibility, etc., in v2.

---

## 3) Architecture Overview

**Front‑end (Cloudflare Pages, Embedded):**

* React + Polaris UI (Admin embedded via App Bridge).
* Chat composer, chip row, collapsible preview table, CSV download, floating progress popup (bottom‑right).
* Uses **SSE** (or WebSocket) to stream progress.

**API (Cloudflare Workers):**

* **Edge Router**: Auth/session, locale, feature gates, rate limits.
* **Planning**: LLM tool-call endpoint to return `OpSpec` + `FilterSpec` or `clarify` question.
* **Preview Service**: Shopify fetch → build snapshot → expose filtering + CSV.
* **Bulk Executor**: staged upload + Bulk Ops + polling + audit.

**State & Storage:**

* **D1 (SQL)**: shops, tokens, alias lexicon, product mirror, variant mirror, collections map, snapshot registry, operation logs, schedules, limits, conversations.
* **KV**: hot caches (facets per snapshot, settings, language packs).
* **R2**: preview CSVs (`.csv` or `.csv.gz`), NDJSON payloads, bulk results, downloadable artifacts.
* **Queues**: background jobs (indexing, preview build, CSV generation, bulk polling, daily sync).
* **Durable Objects**: per‑shop run state (one active bulk op), conversation/session fences.
* **Cron Triggers**: daily sync; cleanup TTLs.

**External**

* Shopify Admin GraphQL + Bulk Operations; Webhooks (products, collections, GDPR).
* OpenAI (GPT‑4o mini) for planning/clarify (no catalogs sent). Optional embeddings for alias curation (offline).

---

## 4) Data Contracts (strict, versioned)

### 4.1 OpSpec (v1)

```ts
import { z } from "zod";

export const OpSpecSchema = z.object({
  scope: z.enum(["product","variant"]),
  operation: z.enum(["price","compare_at","tags","inventory","status","metafield","seo"]),
  params: z.object({
    mode: z.enum(["inc_percent","inc_value","set","add","remove","replace"]).optional(),
    value: z.number().nullable().optional(),
    currency: z.string().optional(),
    round: z.object({ precision: z.number(), endWith: z.string(), mode: z.string() }).optional(),
    locationId: z.string().nullable().optional(),
    metafield: z.object({ ns: z.string(), key: z.string(), type: z.string(), value: z.any().nullable().optional() }).optional(),
    seo: z.object({ title: z.string().nullable().optional(), description: z.string().nullable().optional() }).optional(),
  }),
  schedule: z.any().nullable().optional()
});
```

### 4.2 FilterSpec (v1)

```ts
export const FilterSpecSchema = z.object({
  must: z.object({
    vendors: z.array(z.string()).optional(),
    types: z.array(z.string()).optional(),
    collections: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  mustNot: z.object({ tags: z.array(z.string()).optional() }).optional(),
  titleContains: z.string().nullable().optional(),
  numeric: z.object({
    priceGte: z.number().nullable().optional(),
    priceLte: z.number().nullable().optional(),
    inventoryEq: z.number().nullable().optional(),
  }).optional()
});
```

---

## 5) API Router Example (Hono on Workers)

```ts
import { Hono } from 'hono';
import { OpSpecSchema, FilterSpecSchema } from './schemas';

const app = new Hono();

app.post('/api/plan', async (c) => {
  const body = await c.req.json();
  // Call LLM, validate with OpSpecSchema/FilterSpecSchema
  return c.json({ action: "plan", opSpec: body.opSpec, filterSpec: body.filterSpec });
});

app.post('/api/preview/create', async (c) => {
  // Shopify fetch → snapshot build
  return c.json({ previewId: "p1", total: 42, facets: {}, sampleRows: [] });
});

app.post('/api/preview/csv', async (c) => {
  const { previewId } = await c.req.json();
  // Generate CSV or CSV.gz, upload to R2
  return c.json({ url: `https://r2/.../${previewId}.csv.gz`, format: "csv.gz" });
});

export default app;
```

---

## 6) CSV Generator (with gzip + R2)

```ts
import { gzipSync } from 'fflate';

async function generateCsv(previewId: string, rows: any[], r2: R2Bucket) {
  const header = Object.keys(rows[0]).join(',');
  const body = rows.map(r => Object.values(r).join(',')).join('\n');
  const csv = header + '\n' + body;

  let key = `previews/${previewId}.csv`;
  let format: "csv" | "csv.gz" = "csv";
  let data: Uint8Array | string = csv;

  if (rows.length > 500) {
    data = gzipSync(new TextEncoder().encode(csv));
    key += '.gz';
    format = "csv.gz";
  }

  await r2.put(key, data, { httpMetadata: { contentType: "text/csv" } });
  return { url: `https://r2.example.com/${key}`, format };
}
```

---

## 7) Integration Tests (Ngrok + Cloudflare)

### Setup

* Use **Ngrok** to tunnel local Worker dev (wrangler dev) to Shopify app.
* Cloudflare dev (wrangler dev) with Shopify test store.
* No mocks: call actual Shopify API with dev store and seed products.

### Stages to Test

1. **Auth**: OAuth handshake, token exchange, session JWT in embedded admin.
2. **Plan API**: send NL requests (e.g., "increase all tee prices by 10%"), validate `OpSpec` + `FilterSpec` JSON schema.
3. **Preview Create**: run snapshot builder; confirm row counts and facets from live Shopify store.
4. **Preview CSV**: request compressed CSV; validate headers, compression threshold, R2 link.
5. **Execute**: run bulk mutation on a small test set; confirm changes in Shopify admin UI.
6. **GDPR Hooks**: uninstall app from test store → confirm all shop data purged from D1/R2.

---

## 8) Parallel Efforts (Claude Code vs Codex)

* **Claude Code (Implementation Lead)**

  * Build API endpoints in Hono/Workers
  * D1 schema migrations
  * R2 CSV generator
  * Shopify GraphQL queries/mutations
  * UI components (Polaris chat, chips, table, popup)

* **Codex (Reviewer & QA)**

  * Review code for correctness and compliance
  * Write integration tests (Jest + wrangler dev + Ngrok)
  * Run live end-to-end flows with test store
  * Confirm CSV compression, chips behavior, GDPR purge

This division ensures **independent verification**: Claude implements, Codex validates + tests.

---

## 9) Final Summary

* Added **Zod schemas** for strict `OpSpec`/`FilterSpec` validation.
* Provided **Hono API router** skeleton.
* Included **CSV generator** with gzip + R2 storage.
* Planned **integration tests** using Ngrok + Cloudflare with real Shopify API.
* Defined **parallel workflow**: Claude Code builds, Codex reviews + tests.

This creates a robust architecture with accuracy, efficiency, and compliance built-in.

---

## 18) TypeScript Schemas (Zod)

> Single source of truth for both Planner output validation and server-side request validation.

```ts
import { z } from "zod";

export const RoundSchema = z.object({
  precision: z.number().positive().max(1), // e.g., 0.01
  endWith: z.string().optional(),          // e.g., ".99"
  mode: z.enum(["nearest","up","down"]).default("nearest"),
});

export const MetafieldSpecSchema = z.object({
  ns: z.string().min(1),
  key: z.string().min(1),
  type: z.string().min(1), // keep Shopify type string, validate in executor
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export const SEOSpecSchema = z.object({
  title: z.string().max(70).nullable().optional(),
  description: z.string().max(320).nullable().optional(),
});

export const OpSpecSchema = z.object({
  scope: z.enum(["product","variant"]),
  operation: z.enum(["price","compare_at","tags","inventory","status","metafield","seo"]),
  params: z.object({
    mode: z.enum(["inc_percent","inc_value","set","add","remove","replace"]).optional(),
    value: z.number().optional(),
    currency: z.string().length(3).optional(),
    round: RoundSchema.optional(),
    locationId: z.string().nullable().optional(),
    metafield: MetafieldSpecSchema.optional(),
    seo: SEOSpecSchema.optional(),
  }).refine(p => {
    // Minimal invariants: if inventory, require locationId; if price/compare_at with set/inc, require value
    return true; // further validated in executor by operation type
  }),
  schedule: z.string().datetime().nullable().optional(),
});

export const FilterNumericSchema = z.object({
  priceGte: z.number().nullable().optional(),
  priceLte: z.number().nullable().optional(),
  inventoryEq: z.number().nullable().optional(),
});

export const FilterSpecSchema = z.object({
  must: z.object({
    vendors: z.array(z.string()).default([]),
    types: z.array(z.string()).default([]),
    collections: z.array(z.string()).default([]), // collection GIDs
    tags: z.array(z.string()).default([]),
  }).default({ vendors: [], types: [], collections: [], tags: [] }),
  mustNot: z.object({ tags: z.array(z.string()).default([]) }).default({ tags: [] }),
  titleContains: z.string().nullable().optional(),
  numeric: FilterNumericSchema.default({}),
});

export type OpSpec = z.infer<typeof OpSpecSchema>;
export type FilterSpec = z.infer<typeof FilterSpecSchema>;
```

---

## 19) Hono Router (Workers) — API Skeleton

> Minimal endpoints wired to Cloudflare bindings (D1, KV, R2, Queues). Replace stubs with real services.

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { OpSpecSchema, FilterSpecSchema } from './schemas';

export const app = new Hono<{ Bindings: ENV }>();

// Planning: returns plan or clarify
app.post('/api/plan', zValidator('json', z.object({ text: z.string(), locale: z.string().optional() })), async (c) => {
  const { text, locale } = c.req.valid('json');
  // call LLM with few-shots -> {action, opSpec?, filterSpec?, question?}
  const result = await planWithLLM(c.env, { text, locale });
  return c.json(result);
});

// Create preview snapshot
app.post('/api/preview/create', zValidator('json', z.object({ opSpec: OpSpecSchema, filterSpec: FilterSpecSchema })), async (c) => {
  const { opSpec, filterSpec } = c.req.valid('json');
  const out = await createPreview(c.env, { opSpec, filterSpec });
  return c.json(out);
});

// Apply local filters on snapshot (chips)
app.post('/api/preview/applyFilters', zValidator('json', z.object({ previewId: z.string(), filterSpec: FilterSpecSchema, page: z.number().min(1).default(1), pageSize: z.number().min(10).max(200).default(25) })), async (c) => {
  const body = c.req.valid('json');
  const out = await applyFilters(c.env, body);
  return c.json(out);
});

// CSV generation (auto gzip)
app.post('/api/preview/csv', zValidator('json', z.object({ previewId: z.string() })), async (c) => {
  const { previewId } = c.req.valid('json');
  const out = await buildCsv(c.env, { previewId });
  return c.json(out);
});

// Execute bulk op
app.post('/api/execute', zValidator('json', z.object({ previewId: z.string() })), async (c) => {
  const { previewId } = c.req.valid('json');
  const out = await executeBulk(c.env, { previewId });
  return c.json(out);
});

// SSE for progress
app.get('/sse/progress/:shop', async (c) => {
  return streamProgress(c.env, c.req.param('shop'));
});

export default app;
```

> **Bindings (wrangler.toml)**: `D1` (DB), `KV` (facets/settings), `R2` (artifacts), `QUEUES` (indexing/csv/bulk), `AI_KEY`, `SHOPIFY_APP_*`.

---

## 20) CSV Builder with Auto‑Gzip + R2 Upload

```ts
import { stringify } from 'csv-stringify/sync';

export async function buildCsv(env: ENV, { previewId }: { previewId: string }) {
  const { rows, columns } = await loadFilteredRows(env, previewId); // from snapshot + current FilterSpec

  const headers = columns.map(c => c.label).concat(['Product ID','Variant ID']);
  const data = rows.map(r => [
    r.title, r.vendor, r.productType, (r.collections||[]).join(', '),
    formatPrice(r.price, env), formatPrice(r.after?.price, env),
    diffTags(r.tags, r.after?.tagsDelta), r.status,
    r.productId, r.variantId ?? ''
  ]);

  const csv = stringify([headers, ...data], { quoted: true });
  let body: ArrayBuffer | Uint8Array = new TextEncoder().encode(csv);
  let format: 'csv'|'csv.gz' = 'csv';

  if (rows.length > 500) {
    // @ts-ignore — Workers have CompressionStream
    const cs = new CompressionStream('gzip');
    const compressed = await new Response(new Blob([body]).stream().pipeThrough(cs)).arrayBuffer();
    body = new Uint8Array(compressed);
    format = 'csv.gz';
  }

  const key = `previews/preview_${previewId}.${format}`;
  await env.R2.put(key, body, {
    httpMetadata: {
      contentType: 'text/csv',
      contentEncoding: format === 'csv.gz' ? 'gzip' : undefined,
      contentDisposition: `attachment; filename=preview_${previewId}.${format}`,
    },
  });

  const url = signedR2Url(env, key, 7 * 24 * 3600); // 7 days
  return { url, format };
}
```

---

## 21) Integration Tests (Real Shopify, No Mocks)

> Purpose: Validate each stage end‑to‑end using a **Shopify dev store** with real Admin API, through **ngrok**/**Cloudflare Tunnel**, without UI.

### 21.1 Environment

* **Dev store** with sample products/variants, collections, tags, test locations.
* **App** installed on dev store with required scopes.
* **Secrets**: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `APP_URL`, `NGROK_URL` or `CLOUDFLARE_TUNNEL`, `ADMIN_TOKEN` stored in Wrangler secrets.

### 21.2 Test Runner

* Use **Vitest** or **Jest** from a Worker‑compatible test harness (Miniflare or cloudflared dev).
* Run tests against deployed preview (`wrangler dev` + tunnel) to avoid mocks.

### 21.3 Test Stages

1. **Auth & Webhooks**

   * Install flow completes (simulate OAuth callback to `/auth/callback`).
   * Webhook HMAC validation accepts product/create event.
2. **/api/plan**

   * Input: "increase summer tees by 10%" → returns `action=plan` with valid `OpSpec`+`FilterSpec`.
   * Low‑confidence phrase → returns `action=clarify` with single question.
3. **/api/preview/create**

   * Creates snapshot, returns `previewId`, `total > 0`, `facets`.
   * Asserts snapshot rows persisted in D1/R2 depending on size.
4. **/api/preview/applyFilters**

   * Apply chip filters (vendor, tag, title) → count decreases, sample changes.
   * Numeric post‑filters behave (priceGte/Lte, inventoryEq with `locationId`).
5. **/api/preview/csv**

   * <500 rows → `format=csv` with correct headers.
   * ≥500 rows → `format=csv.gz`, `Content-Encoding: gzip` set; file downloadable and valid after gunzip.
6. **/api/execute**

   * Pre‑flight drops archived rows when not included; returns `taskId`.
   * Poll `/bulk/status` until complete; verify counts match preview and random spot‑check via Admin API readback.
7. **GDPR Uninstall**

   * Call uninstall webhook → verify shop rows purged (D1), snapshots/CSV/NDJSON removed (R2), KV cleared.

### 21.4 CI Steps (GitHub Actions)

* Spin up **cloudflared** tunnel to `wrangler dev`.
* Seed dev store (optional step that creates sample products via Admin API).
* Run test suite with real secrets (Org‑level secrets with environment protections).
* Artifacts: store logs, downloaded CSV/CSV.GZ for inspection.

---

## 22) Parallel Agent Plan (Claude Code ↔️ Codex)

> Two‑track workflow so one agent builds while the other reviews/tests.

### 22.1 Claude Code — *Implementation Lead*

* Stand up **Hono router** + bindings; implement `/plan`, `/preview/*`, `/execute`, `/bulk/status`.
* Implement **Snapshot service** (GraphQL/Bulk query + D1/R2 persistence + facets in KV).
* Implement **OpSpec apply** (pure transforms for before→after).
* Implement **CSV builder** with auto‑gzip + R2 signed URLs.
* Implement **Bulk executor** (staged upload, mutation, poller via Queues).
* Wire **SSE progress** via Durable Object.

### 22.2 Codex — *QA & Infra Reviewer*

* Write **Zod conformance tests** for OpSpec/FilterSpec edge cases.
* Author **integration tests** (Section 21) with tunnel; add CI workflow.
* Load‑test **chip filtering** on snapshots (perf target: <80 ms).
* Verify **GDPR** delete paths; confirm webhook signatures.
* Review PRs for Shopify query builder safety and rounding math correctness.

### 22.3 Daily Hand‑off

* Claude pushes implementation branch w/ trace logs.
* Codex reviews, runs integration suite, files issues; merges on green.
* Shared checklist: performance budgets, error messages i18n, log redaction.

---

**Done.** These additions include Zod schemas, a Hono API skeleton, CSV auto‑gzip to R2, real‑Shopify integration testing steps with ngrok/Cloudflare tunnel, and a clear parallel plan for Claude Code & Codex.

---

## 23) UI Details (Polaris Embedded)

### 23.1 Chat + Chips

* **Chat box**: full-width, embedded in Admin; auto-scrolls; supports markdown.
* **Chips row**: directly under chat; implemented with Polaris `Tag` component.

  * Active filters: solid pill + `×` to remove.
  * Suggested filters: subdued outline with `+` to add.
* **Interactions**: clicking chip mutates FilterSpec locally, triggers `/preview/applyFilters`.

### 23.2 Preview Table

* **Collapsible card** below chat; shows sample rows by default.
* **Paged table** (Polaris `DataTable`) with sticky header.
* Columns: Product (thumb + title + link), Vendor, Type, Collections, Tags (with before/after delta), Price (before→after), Compare‑at (before→after), Inventory (before→after), Status, Variant (options, SKU, Barcode).
* **Inline sample**: 3 rows when collapsed.

### 23.3 Floating Progress Popup

* Fixed bottom‑right; header “AI Processing” + pulsing dot.
* Status messages slide up, shimmer sweep effect, fade after 2–3s.
* Non-blocking, ARIA live region.

### 23.4 Accessibility & Responsiveness

* ARIA labels for chips, table updates.
* Keyboard navigation through chips and table.
* Mobile: responsive layout for Shopify app (collapsible panels by default).

---

## 24) Feature Flags

### 24.1 Types of Flags

* **Plan gating**: feature availability based on subscription plan (`ops:*`, `scheduler`, `revert`, `all_langs`).
* **Rollout flags**: gradual enablement of new operations (e.g., metafields, SEO edits).
* **Experiment flags**: A/B test UI flows (chip order, preview collapse default).

### 24.2 Implementation

* Store flags in D1 (`features(shop, key, enabled, variant)`) with fallback defaults.
* Cache in KV for fast lookups.
* Evaluate flags at **Router** level (deny unsupported operations early) and **UI rendering** (hide controls).
* Support remote overrides for developer testing.

---

## 25) Alias & Lexicon Building Per Store

### 25.1 Trigger

* Run **post-installation** immediately after OAuth success.
* Also refresh periodically (daily Cron) to capture new vendors/tags/types/collections.

### 25.2 Index Seeding

* Fetch from Shopify Admin:

  * Vendors, product types, collections (names + IDs), tags, top product titles.
* Store canonicals in D1 tables: `aliases`, `products`, `variants`, `product_tags`, `product_collections`.
* Normalize: lowercase, remove diacritics, NFKD fold.

### 25.3 Alias Expansion (with GPT)

* Use GPT‑4o mini once per shop at install time to generate **synonym sets**:

  * Input: vendor/type/tag/collection names.
  * Output: list of synonyms/colloquialisms.
* Store as alias rows `{alias, canonicalType, canonicalValue, score}`.
* Validate and score: keep high‑confidence only.
* Result is used in **FilterSpec resolution** during planning.

### 25.4 Vector Index (Optional)

* For fuzzy matching, embed canonical terms and aliases using small embedding model.
* Store in local vector DB (Cloudflare D1 + HNSW via library, or external vector service if needed).
* Used only for fallback resolution when lexicon fails.

### 25.5 Guardrail

* User **cannot** perform operations until alias/lexicon build completes.
* UI state: “Building your catalog index… This may take a few minutes.”
* Once ready, unlock chat and operations.

---

## 26) UI Testing at Each Stage (Shopify)

### 26.1 Preview/Test Harness

* Wrap UI in Shopify Embedded app frame.
* Use **ngrok/Cloudflare Tunnel** to expose Worker locally.
* Install app on **dev store**.

### 26.2 Test Checklist

1. **Post-install state**

   * Alias/lexicon job runs; UI shows “Building index…”
   * No operations allowed until index built.
2. **Chat parsing**

   * Enter query → see Plan (chips populated, preview table updates).
   * Clarify flow triggers question & continues after answer.
3. **Chips interaction**

   * Add/remove chips updates preview counts instantly.
   * Chips reflect facets from snapshot.
4. **Preview table**

   * Collapsible works; inline sample visible when collapsed.
   * Paging functional; data consistent with CSV.
5. **CSV download**

   * Small sets: plain CSV.
   * Large sets: gzip CSV; test decompress.
6. **Progress popup**

   * Shows shimmer messages during preview build & bulk execution.
   * Non-blocking, dismissible.
7. **Execute**

   * Safety confirmations appear for destructive ops.
   * Bulk job runs; counts match preview.
8. **Uninstall (GDPR)**

   * Data purged; UI inaccessible.

---

## 27) Final Summary (Additions)

* **UI details**: chat + chips, preview table, progress popup.
* **Feature flags**: plan gating, rollouts, experiments; enforced server + UI.
* **Alias/lexicon building**: post-install GPT-assisted expansion + optional vector fallback.
* **Index seeding**: fetch vendors/types/tags/collections/titles into D1 + KV.
* **Guardrail**: no operations until alias/index build complete.
* **UI testing**: stepwise verification on Shopify dev store via tunnel.

---

## 23) Detailed UI Specification (Testable, Shopify Embedded)

> The UI must be verifiable on a Shopify dev store at each stage. All screens/components are Polaris-based, responsive, and accessible.

### 23.1 Global Shell

* **Embedded** via App Bridge; respects Admin theme (light/dark).
* **Topbar**: App name, plan badge, locale switcher (shop default ↔ English), help menu.
* **Toasts**: success/warn/error; non-blocking.
* **Banners**: show gating (indexing in progress) and hard-cap warnings.

### 23.2 Chat Workspace

* **Left column (optional on desktop)**: Recent tasks (last 20), status chips (Complete/Failed/Running).
* **Main column**:

  * **Composer** with examples dropdown; disabled if `shop.ready=false`.
  * **Message list** with compact assistant bubbles.
  * **Action row** inside assistant replies: \[Preview], \[CSV], \[Proceed], \[Cancel].

**States**

* **Onboarding/Indexing**: Composer disabled; show a **Progress card**:

  * Steps: *Sync products → Build lexicon → Build vector index → Facets ready.*
  * Per-step spinner + logs link; ETA badge; retry button when a step fails.
* **Ready**: Composer enabled; chip suggestions appear after first preview.

### 23.3 Filter Chips

* Components: **Polaris Tag** pills; Active (solid) / Suggested (outline).
* Interactions: click to add/remove; support `-tag` via long‑press context or small toggle in chip.
* **Keyboard**: arrows move focus; delete/backspace removes; enter toggles.
* **A11y**: each chip has `aria-pressed` state; live region announces “Filter applied: vendor=ACME (214 results)”.

### 23.4 Preview Panel (Collapsible)

* **Card header**: Title, count badge, \[Show/Hide], \[Download CSV].
* **Controls**: quick filter (Title/SKU), pager, columns toggle (advanced).
* **Table**: Polaris IndexTable with sticky header; rows show:

  * Thumb + Title (Admin link), Vendor, Type, Collections, Tags (Δ), Price (before→after), Compare-at (before→after), Inventory (before→after, if relevant), Status, Variant (Title/Options/SKU/Barcode when scope=variant).
* **No IDs** in UI. CSV contains IDs at end.
* **Empty/Zero state**: “No matches — try removing `-tag=Clearance` or adding `vendor=…`” with suggested chips.

### 23.5 Floating Progress Popup

* Fixed bottom-right; **Header** “AI Processing” + pulsing dot.
* **Message stream**: slide‑up, 2–3s dwell, fade‑up, shimmer sweep on text.
* **Non-blocking**; can be collapsed to a dot; persists across navigation via App Bridge session.

### 23.6 Error & Edge States

* Clarify question inline with **quick reply buttons** for common options.
* Oversized results banner with suggested facet chips to narrow.
* Staleness badge on preview (e.g., “Built 12m ago”).
* Permission/plan errors render as inline callouts with upgrade CTA.

### 23.7 Visual / Motion Guidelines

* Motion durations: 150–250ms; easing `ease-out` for enter, `ease-in` for exit.
* Colors: Polaris tokens; diff colors: green (#10B981) for additions/increases, red (#EF4444) for removals/decreases.
* Typography: Title cells `headingSm`, data cells `bodySm`.

### 23.8 Testability Hooks

* Add `data-testid` on chips, table rows, action buttons, popup messages.
* Export a **“Preview-only”** route (`/debug/preview/:previewId`) for CI to open without chat.
* Feature-flag a **“Fake shop”** mode that points to a real dev store but uses a small, known subset for assertions.

---

## 24) Feature Flags & Kill Switches

> Progressive delivery and safe rollouts using Cloudflare KV + D1.

### 24.1 Flag Model

* **Scopes**: global, per‑environment (dev/stage/prod), per‑shop, per‑user.
* **Storage**: KV for fast reads (`flags:<env>:<shopId>`), mirrored in D1 for audit/history.
* **Types**: boolean, enum (e.g., rounding strategy), numeric (caps), JSON (experimental config).

### 24.2 Core Flags (examples)

* `ui.inlinePreview` (default: true) — enable preview table.
* `ui.csvCompression` (default: true) — enable gzip > 500 rows.
* `ops.inventory.requireLocation` (default: true) — block execution without location.
* `lang.nonEnglish` (plan‑gated) — allow non‑default locale parsing.
* `search.vector.indexing` — enable vector index build & alias via embeddings.
* `guard.hardCap` (default: 10000) — execution cap.
* `guard.twoKeyConfirm` — enforce typed confirmation for risky ops.

### 24.3 Evaluation

* Middleware loads flags (KV) once per request; memoize per session.
* UI reads flags to conditionally render components and tests can flip flags via admin endpoint.

### 24.4 Kill Switches

* Global switch to disable **Execute** while keeping **Preview**.
* Per‑operation kill: price, inventory, tags, etc.
* OpenAI outage switch: fallback to template prompts or maintenance banner.

---

## 25) Post-Install Bootstrap (Lexicon + Index Seeding)

**User cannot start operations** until bootstrap is complete. Composer disabled; onboarding progress card shown.

### 25.1 Steps

1. **Sync Catalog** (Shopify Admin GraphQL / Bulk): products, variants, collections, tags, vendors, types; store minimal mirrors in D1.
2. **Alias/Lexicon Build (Primary Path)**

   * Sources: vendor/type/tag/collection names; top title n-grams; historical tags.
   * Normalize → dedupe → generate candidate synonyms.
   * Use GPT-4o mini once (per install) to propose safe alias → canonical mappings, locale-aware; assign confidence.
   * Persist `aliases` in D1 with provenance, locale, score; expose to runtime resolver.

3. **Facet Cache**

   * Precompute vendor/type/tag/collection counts for first-run suggested chips; store in KV.

4. **Optional Vector Index (Secondary / Fallback)**

   * If enabled by feature flag, compute embeddings for canonicals and aliases.
   * Store in lightweight vector store (D1 + cosine index or Cloudflare Vectorize).
   * Used only for fuzzy fallback if lexicon lookup fails.

5. **Gate Lift**

   * When alias/lexicon complete (and optional vector index if enabled), set `shop.ready = true`.
   * UI unblocks composer.

### 25.2 Failure/Retry

* Each step retries with backoff; failure shows banner with “Retry” button; logs in ops table.

### 25.3 Performance Targets

* Small shops (<5k variants): < 2 minutes total.
* Large shops: Bulk query async with progress; UI shows remaining counters.


## 26) UI Testing at Each Stage (No Mocks)

> E2E checks against a dev store using **Playwright** + **cloudflared** tunnel.

### Stages

1. **Post‑Install Gated**: confirm composer disabled; progress card shows steps advancing as Workers complete bootstrap.
2. **Ready State**: composer enabled; send sample intent → `/api/plan` returns plan; preview table renders; counts stable.
3. **Chips**: add/remove vendor/tag/title chips; verify count updates locally without network re‑query (assert XHRs).
4. **CSV**: generate <500 (csv) and ≥500 (csv.gz) previews; download and validate headers/row counts.
5. **Execute**: run a small bulk edit; poll status; verify Shopify Admin reflects changes on a couple of SKUs.
6. **Kill Switch**: flip `Execute` off via flags; UI hides button; attempt returns 403.

### Playwright Tips

* Launch Admin with embedded app URL; wait for iframe; use `data-testid` hooks.
* Use App Bridge methods to simulate navigation and ensure state persists.

---

## 27) Runtime Alias Resolution (Fast Path)

### Algorithm

* Input terms → normalize (lowercase, NFKD).
* Try exact canonical matches (vendor/type/tag/collection).
* Lookup in `aliases` table (score ≥ τ).
* If miss → edit-distance within canonicals (<=1–2 edits).
* If still miss:
  * If **vector index enabled** → nearest neighbor search on canonical embeddings.
  * If similarity < τ_low → return `confidence=low` (trigger clarify).
* Always emit `confidence: high|med|low`. Low confidence must not auto-apply — triggers clarify flow.

### Accuracy vs Cost

* **Primary path**: D1 lookups + alias table (fast, deterministic, zero per-query cost).
* **Optional fallback**: vector NN, only if flag enabled; adds accuracy for fuzzy synonyms at modest cost.
* **No RAG in hot path**: embeddings never used to retrieve live catalog rows; only for alias enrichment.

### Telemetry

* Log alias hits/misses and clarifications.
* Mine corrections weekly; reinforce/demote alias scores automatically.

## 28) Shopify Verification Checklist (Per Feature)

* **Embedded & OAuth**: App renders inside Admin; session JWT validated; storage access correct.
* **GraphQL/Bulk**: Query limits respected; pagination at 250; bulk uploads signed.
* **Webhooks**: HMAC checked; product/collection updates reflected in mirrors.
* **Permissions**: Only required scopes requested; reject if missing.
* **GDPR**: Uninstall webhook purges D1/R2/KV; logs record purge timestamp.
* **UI i18n**: Locale switch affects currency & messages; right-to-left layouts tested if needed.
* **Accessibility**: Chip keyboard ops; live region updates; contrast meets WCAG 2.1 AA.

---

*These additions cover the missing UI details, feature flags, and per‑store alias/index bootstrapping with gating. The UI is fully testable on a dev store at each stage, and operations remain blocked until indexing + lexicon build complete.*

---

## 29) Admin GraphQL vs Bulk Operations — When to Use What (and How to Avoid Rate Limits)

> Objective: maximize throughput and accuracy while minimizing throttling. This policy is enforced in the Preview Service and Bulk Executor.

### 29.1 Quick Decision Matrix

| Use case                                                 |         Use **Admin GraphQL (paged)** | Use **Bulk Operation – Query** |      Use **Bulk Operation – Mutation** |
| -------------------------------------------------------- | ------------------------------------: | -----------------------------: | -------------------------------------: |
| Read small sets (≤ 2,500 nodes) with quick user feedback |                                     ✅ |                                |                                        |
| Read medium sets (2,500–25,000) for preview/snapshot     |                                       |                              ✅ |                                        |
| Read very large sets (> 25,000) or whole catalog         |                                       |                              ✅ |                                        |
| Write small updates (≤ 200 targets) immediately          | ✅ (single/multiple mutations batched) |                                |                                        |
| Write medium/large updates (> 200 targets)               |                                       |                                | ✅ (`bulkOperationRunMutation` + JSONL) |
| Long‑running, offline‑tolerant jobs                      |                                       |                              ✅ |                                      ✅ |

> Thresholds are tunable via feature flags: `read.bulkThreshold`, `write.bulkThreshold`.

### 29.2 Admin GraphQL (paged reads)

* **Use when** preview target is small and latency matters.
* **Pagination**: request up to `first: 250` per page using cursor‑based pagination.
* **Query cost aware**: keep requested cost low by selecting only fields needed for snapshot (no nested connections unless required).
* **Adaptive backoff**: if remaining cost is insufficient for next page, wait until budget replenishes.

### 29.3 Bulk Operation – Query (large reads)

* **Use when** snapshot scope exceeds a few thousand nodes, or when you need whole‑catalog facets.
* **Flow**: `bulkOperationRunQuery` → poll → download **NDJSON** from result URL → hydrate snapshot rows.
* **Fields**: select only snapshot fields (see §5.4). Avoid expensive nested edges where possible; emit a second pass if needed.

### 29.4 Bulk Operation – Mutation (large writes)

* **Use when** > 200 targets, or any operation likely to hit throttling in per‑row mutations.
* **Flow**: build per‑row **JSONL** payload → `stagedUploadsCreate` to get a signed URL → upload → `bulkOperationRunMutation` referencing the staged file → poll to completion.
* **Atomicity**: bulk ops are best‑effort; failed rows are reported in result file. Executor should requeue failures (idempotent design).

### 29.5 Rate‑Limit Strategy (GraphQL Admin)

* **Cost bucket policy** (Planner/Preview):

  * Track **requested** and **actual** cost from `extensions.cost` in responses.
  * Proceed only if `currentlyAvailable` ≥ `nextEstimatedCost` + safety margin (e.g., 50).
  * Else, sleep `ceil((nextEstimatedCost - currentlyAvailable)/restoreRate)` seconds.
* **Keep queries small**: slice fields by need; prefer separate lightweight queries over one heavy multi‑edge query.
* **Use Bulk for fan‑out**: any query that would require >10 pages (2,500 nodes) should consider Bulk Query.

### 29.6 Practical Patterns

* **Variant‑heavy previews**: fetch product IDs via Admin GraphQL, then run a **Bulk Query** for variants by product ID for speed.
* **Collections**: prefer collection **IDs** in queries; when you only have names, resolve once and cache mapping.
* **Presentment/markets**: compute localized price deltas in app; avoid requesting multi‑market pricing fields unless required.

### 29.7 Executor Choices by Operation

* **Price/Compare‑at**: `bulkOperationRunMutation` using per‑variant updates is preferred at scale; for ≤200 variants, use batched `productVariantUpdate`.
* **Tags**: product‑level `productUpdate` with tags array or `tagsAdd/tagsRemove` typed input; bulk for large sets.
* **Inventory**: `inventoryAdjustQuantity` or `inventorySetOnHandQuantities` with required `locationId`; bulk for large sets.
* **Status**: `productUpdate` fields (`status`, `published` etc.); bulk for large sets.
* **Metafields/SEO**: use typed inputs; bulk for large sets.

### 29.8 Telemetry & Flags

* Log **route** chosen (Paged vs Bulk) and response costs.
* Feature flags: `read.bulkThreshold`, `write.bulkThreshold`, `graphql.restoreMargin`, `bulk.maxParallelDownloads`.

---

## 30) Anti‑Throttling Techniques (Implementation Notes)

* **Measure**: record `extensions.cost.requestedQueryCost`, `actualQueryCost`, `throttleStatus`, `currentlyAvailable`, `restoreRate` per call.
* **Budgeting**: centralized cost manager (Durable Object) per shop to serialize bursts and calculate minimal sleep.
* **Pre‑filter server‑side**: always add exact filters in search string (vendor/product\_type/tag/collection\_id/title) to reduce result size.
* **Shard work**: for huge catalogs, split by vendor/type/tag and run Bulk Queries sequentially.
* **Retry on 429/Throttled**: exponential backoff with jitter; honor `Retry‑After` if provided.
* **Idempotency keys**: for execute endpoints to avoid duplicate bulk runs after retries.

---

*This section defines exactly when to use Admin GraphQL vs Bulk Operations for reads and writes, and how we avoid rate limits in both.*

---

## 31) Internationalization & Text Management Policy

### 31.1 No Hardcoded English Patterns in Code

* **Forbidden**: embedding English brand/product/tag/type strings in source code.
* **Instead**: all canonical values must be fetched from Shopify API mirrors (vendor/type/tag/collection) and stored in D1.
* **Lexicon/Alias seeds**: generated from store data only; never from static English lists.
* **Vector/embedding inputs**: use store‑specific values (with locale info) only.

### 31.2 All User‑Visible Text From Locale Files

* **No inline English UI text**: every button, label, tooltip, message must come from locale files.
* **Locale storage**: KV key `i18n:<locale>` with JSON payload.
* **Runtime**: UI components load translations via App Bridge locale or shop default; fallback = English only if locale not available.
* **Server messages**: API errors return `code` + `params`; UI layer translates using locale files.

### 31.3 Locale File Structure

```json
{
  "chat": {
    "composer.placeholder": "Describe your bulk edit…",
    "clarify.prefix": "I need more details: {question}",
    "error.generic": "Something went wrong.",
    "banner.indexing": "Building your store index, please wait…"
  },
  "preview": {
    "header": "Preview ({count} items)",
    "stale": "Preview built {minutes}m ago",
    "download.csv": "Download CSV"
  },
  "execute": {
    "button": "Apply Changes",
    "confirm.risky": "Type CONFIRM to continue with {count} changes"
  },
  "progress": {
    "header": "AI Processing",
    "msg.analyzing": "Analyzing {count} products…",
    "msg.preview_ready": "Preview ready ({count} rows)",
    "msg.bulk_running": "Processing {done}/{total}…",
    "msg.done": "Bulk edit complete"
  }
}
```

### 31.4 Implementation

* **UI**: React components wrap `t(key, params)` hook; locale JSON injected at build or fetched from KV.
* **Server**: returns only codes (`error.MISSING_LOCATION`, `guard.HARD_CAP`); UI translates via locale file.
* **Tests**: integration tests assert key presence; lint rule forbids hardcoded English strings in JSX/TS.

### 31.5 Locale Lifecycle

* Default locales: `en`, `fr`, `de`, `es`, `ja`, `zh`, etc.
* Extendable by merchants uploading custom JSON.
* CI validates all keys present in every locale file.

---

*This ensures no English brand/product patterns are hardcoded, and all user‑facing text is served from locale files.*

---

## 31) Internationalization (i18n) & No Hard‑coded English Policy

> **Requirement:** **No English strings** (or any language) hard‑coded in UI or business logic. **All user‑visible text must come from locale files.** No brand/product pattern seeds in code; they must be derived from the store’s own data and locale.

### 31.1 Policy

* **Zero hard‑coded text** in React/Workers code. Use `t('key', vars)` for every label, message, button, banner, error, CSV header, and tooltip.
* **No English brand/product patterns** compiled into code. Alias/lexicon seeds only from **store data** (vendors, types, tags, collections, titles) gathered post‑install and processed in the **store locale**.
* **Planner/LLM prompts**: server‑side only; not shown to users. Any LLM‑returned user‑facing text must be **mapped to keys** before display (or replaced with deterministic UI strings from locale files).

### 31.2 Locale Resolution

* Default to **shop primary locale** from Shopify Admin; allow user override in settings.
* `i18n.locale` stored per shop in D1 + KV; read on each request.
* Fallback chain: `shopLocale → en` (configurable) with **missing‑key telemetry**.

### 31.3 Locale Files Structure

```
/locales/
  en.json
  es.json
  fr.json
  hi.json
  …
```

* Namespaces (suggested):

  * `app.*` (chrome, titles)
  * `chat.*` (prompts, confirmations)
  * `chips.*` (filter labels)
  * `preview.*` (table headers, CSV headers)
  * `progress.*` (floating popup messages)
  * `errors.*` (validation, rate‑limit, missing perms)
  * `guard.*` (two‑key confirm, caps)
  * `install.*` (bootstrap/indexing steps)

**Example** (`en.json`):

```json
{
  "app.title": "AI Bulk Edit",
  "chat.compose.placeholder": "Describe your bulk change…",
  "chips.vendor.eq": "vendor = {name}",
  "preview.headers.product": "Product",
  "preview.headers.vendor": "Vendor",
  "preview.headers.price": "Price",
  "preview.headers.tagsDelta": "Tags Δ",
  "preview.csv.note.gz": "Large preview (compressed). Unzip to open in Excel/Sheets.",
  "progress.analyzing": "Analyzing {count} products…",
  "progress.previewReady": "Preview ready ({count} rows)",
  "guard.cap": "Result too large. Narrow your filters before proceeding.",
  "errors.requireLocation": "Select an inventory location to continue."
}
```

### 31.4 i18n Helper

```ts
export function t(key: string, vars?: Record<string, string|number>) {
  const dict = CURRENT_LOCALE_DICT; // loaded from KV or bundled
  let s = dict[key] ?? key; // show key if missing (dev only)
  if (vars) for (const [k,v] of Object.entries(vars)) s = s.replace(new RegExp(`{${k}}`, 'g'), String(v));
  return s;
}
```

* Use ICU/MessageFormat if pluralization/gender is needed.

### 31.5 CSV & UI Text

* **CSV headers** sourced from `preview.headers.*` keys.
* **UI table headers** and **floating popup messages** sourced from locale keys.
* **IDs** in CSV remain raw; **numbers/currency/dates** formatted using `Intl` with `shop.locale` + `shop.currency`.

### 31.6 Linting & CI Guards

* ESLint rule to **ban string literals** in JSX/TS when not wrapped by `t()`.

  * Use or author a rule (e.g., `eslint-plugin-no-hardcoded-strings`) with allow‑list for non‑user text (e.g., enum names, keys).
* CI step: **key coverage test** — scan compiled app for string literals; compare used keys vs locale files.
* CI step: **missing translation fail** in prod build; allow in dev with console warn.

### 31.7 Logs & Telemetry

* Logs avoid PII and user‑visible sentences; use **codes** and **key names**.
* If a user‑visible error occurs, only the **localized key** + variables are stored.

---

## 32) Alias & Lexicon Building — Locale‑Aware, Per‑Store

> No English seeds in code. Build alias/lexicon **per store, post‑install**, from **store data** and in the **store locale**.

### 32.1 Inputs

* Vendors, product types, tags, collection names, frequent title n‑grams.
* Normalize: lowercase, NFKD fold; remove punctuation.

### 32.2 Pipeline

1. **Candidate Extraction**: unique canonicals from store data.
2. **Embedding Pass** (Workers AI or OpenAI embeddings): vectorize canonicals + frequent terms in the store’s language.
3. **Clustering**: group near‑duplicates; suggest alias→canonical pairs.
4. **LLM Vetting (batch, offline)**: feed clusters to GPT to propose safe, locale‑aware alias pairs (never shown to user).
5. **Confidence Scoring**: cosine similarity + prior usage.
6. **Persistence**: write to D1 `aliases(shop, alias, canonicalType, canonicalValue, score, locale)`.

### 32.3 Runtime Resolution

* Resolver tries: **canonical match → alias table (score≥τ) → edit‑distance within canonicals → vector NN**.
* Emit `confidence: high|med|low`. `low` triggers a **clarify** prompt (localized key + variables).
* Store corrections the user makes (e.g., clicked a different vendor chip) as **reinforcement** (increment score).

### 32.4 Governance

* Weekly job to **promote/demote** aliases by usage/success.
* Export/import endpoint for admins to review alias pairs per shop (behind feature flag).

---

## 33) Index Seeding & Gating — Post‑Install

> **Composer remains disabled** until seeding finishes. All texts are localized via `install.*` keys.

### 33.1 Seeding Steps

1. **Catalog Mirror** (GraphQL/Bulk)
2. **Alias/Lexicon Build** (Section 32)
3. **Vector Index** (optional) for discovery and alias fallback
4. **Facet Cache** (vendors/types/tags/collections)
5. **Ready Gate**: set `shop.ready=true` when all pass; UI enables composer.

### 33.2 Failure UX

* Localized progress card shows which step failed; **Retry** button calls bootstrap worker again.

---

## 34) UI Testability with i18n

* Playwright tests use **locale fixture** (e.g., `hi-IN`) and assert **localized text** via keys → value mapping.
* `data-testid` remains language‑agnostic; assertions avoid literal English.
* Snapshot tests verify **CSV headers** match locale keys.

---

*These sections enforce: no hard‑coded English, full locale‑driven UI, and per‑store alias/index building post‑installation with gating until complete.*
