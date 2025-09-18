# Skupilot Development Phases

> Note: Verify the detailed system design in `shopify_ai_bulk_edit_spec.md`.

This document outlines the development phases for Skupilot AI Bulk Editor, designed with **vertical integration** and **full UI testability** at each phase.

## 🎯 **Phase Strategy**

Each phase is:
- **Vertically integrated**: Complete feature from UI to database
- **Independently testable**: Can be tested end-to-end through the UI
- **Incrementally valuable**: Adds meaningful functionality users can interact with
- **Small scope**: 1-3 days of development each

---

## ✅ **Phase 1: MVP Foundation** (COMPLETED)

### **Features**
- Basic Shopify OAuth integration
- Simple price operations (set, increase %, decrease %)
- Pattern matching for intent recognition
- Individual GraphQL mutations (max 10 products)
- Simple HTML UI with JavaScript

### **Testing**
- ✅ App installs successfully in Shopify admin
- ✅ Price changes work end-to-end  
- ✅ Preview shows correct before/after
- ✅ Execute button updates real products
- ✅ No errors in deployment

### **Limitations**
- Price operations only
- No bulk operations (individual GraphQL mutations)
- No progress tracking
- No CSV export
- Simple HTML UI

---

## 🚀 **Phase 2A: Enhanced Planning with UI** (IN PROGRESS)

### **Scope**
Enhanced AI-powered planning with strict schema validation and localized clarifications.

### **Features**
- **GPT-4o mini integration** for natural language parsing (no catalog data sent)
- **Strict OpSpec/FilterSpec** schemas (Zod validation) on server
- **Deterministic fallback** pattern matching when LLM confidence is low
- **Clarification issues (codes)** returned by API; UI maps codes → localized text (no freeform questions)
- **Improved UI feedback** with structured clarification handling and i18n

### **New Operation Support**
- Price operations (enhanced)
- Tag operations (add/remove/replace)
- Inventory operations (set/increment/decrement) — may require location clarification
- Status operations (publish/unpublish/archive) — destructive ops require two‑key confirm
- SEO operations (placeholder)

### **API Changes**
```typescript
POST /api/plan
{
  "text": "Add summer tag to all dresses",
  "locale": "optional"
}

Response:
{
  "action": "plan",
  "opSpec": {
    "scope": "product",
    "operation": "tags",
    "params": { "mode": "add", "value": ["summer"] }
  },
  "filterSpec": {
    "must": { "types": ["dress"] },
    "mustNot": { "tags": [] },
    "titleContains": null,
    "numeric": {}
  }
}
```

### **UI Testing**
- ✅ Enter "Set all hoodie prices to $50" → get structured plan
- ✅ Enter "Add summer tag to dresses" → get tag operation plan
- ✅ Enter "Set inventory to 100" → get clarification issue for location (code), UI renders localized prompt
- ✅ Enter "Update products" → get clarification with structured codes

### **Success Criteria**
- All operation types return proper OpSpec/FilterSpec
- Clarifications use structured codes; UI maps codes → localized messages
- UI renders localized clarification text
- GPT-4o mini integration works (with pattern matching fallback)

---

## 🧭 **Phase 2A‑Bootstrap: Post‑Install Lexicon + Index Seeding**

### **Scope**
Run immediately after successful OAuth. Build per‑shop alias/lexicon and seed indices; gate the UI until ready.

### **Features**
- **Catalog Sync (minimal mirror)**: vendors, types, tags, collections, top titles
- **Alias/Lexicon Build (locale‑aware)**: derive aliases from store data only; score and persist
- **Optional Vector Index**: embed canonicals/aliases for fuzzy fallback
- **Facet Cache**: precompute vendor/type/tag/collection counts in KV
- **Gate Lift**: set `shop.ready=true` when all steps succeed; composer unblocked

### **API & Jobs**
- Trigger: post‑install (OAuth callback) → queue bootstrap job
- Queue worker runs: `syncCatalog → buildAliases → buildFacetCache`
- KV keys: `facets:shop:<shopId>`; aliases persisted in D1
- UI state: show “Building index…” with step progress; block operations until ready

### **Success Criteria**
- Composer gated until bootstrap completes; clear progress feedback in UI
- Alias/lexicon built from store data in shop locale; no static English seeds
- Facets cached and chips available on first run
- Performance: small shops <2 minutes; large shops use Bulk Query with visible progress

> Note: Verify the detailed system design in `shopify_ai_bulk_edit_spec.md` (Sections 25, 32, 33).

---

## 📊 **Phase 2B: Local Snapshot & Simple Preview** 

### **Scope**
Build snapshot system for fast local filtering and preview generation, with size‑aware storage.

### **Features**
- **Snapshot Builder**: One Shopify read per task (Admin GraphQL ≤2.5k; Bulk Query above) → build task‑scoped snapshot
- **Storage**: Small snapshots stored in D1; large snapshots stored in R2 (TTL); facets cached in KV
- **Preview Calculation**: Apply OpSpec to snapshot → compute deterministic "after" values
- **Basic Preview Table**: Simple table with before/after values
- **Local Filtering**: Title/vendor/type/tag/collection filters applied in‑snapshot (no extra Shopify calls)

### **New Tables**
```sql
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  preview_id TEXT UNIQUE NOT NULL,
  op_spec TEXT NOT NULL, -- JSON
  filter_spec TEXT NOT NULL, -- JSON
  total_count INTEGER NOT NULL,
  storage_url TEXT,          -- null for small (in-DB), R2 URL for large
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME
);
```

Facets are cached in KV using key pattern `facets:<preview_id>`.

### **API Changes**
```typescript
POST /api/preview/create
{
  "opSpec": { /* from phase 2A */ },
  "filterSpec": { /* from phase 2A */ }
}

Response:
{
  "previewId": "p_abc123",
  "total": 150,
  "preview": 25,  // After filtering
  "sampleRows": [
    {
      "productId": "gid://shopify/Product/123",
      "title": "Summer Dress",
      "currentPrice": 29.99,
      "newPrice": 50.00,
      "change": "+66.7%"
    }
  ]
}
```

### **UI Testing**
- ✅ Enter "Set hoodie prices to $50" → see preview table with price changes
- ✅ See "150 products found, 25 hoodies will be updated"
- ✅ Preview table shows: Product | Current Price | New Price | Change
- ✅ All calculations are correct

### **Success Criteria**
- Single Shopify data pass per task; no re-fetch for chip changes
- Preview calculations match OpSpec exactly (deterministic)
- UI shows clear before/after comparison
- Performance: local filter apply <80 ms; Admin GraphQL used for ≤2.5k nodes

### Rate‑limit Policy
- Reads: use Admin GraphQL for small snapshots (≤2.5k nodes); switch to Bulk Query beyond.
- Track `extensions.cost` (requested/actual/currentlyAvailable); back off until budget ≥ nextEstimatedCost + safety margin.
- Keep queries minimal; avoid heavy nested edges; prefer multiple light queries over one heavy query.

---

## 🏷️ **Phase 2C: Filter Chips & Dynamic Filtering**

### **Scope** 
Add interactive filter chips for dynamic product selection (local only).

### **Features**
- **Filter Chips Row**: Vendor, Type, Collection, Tag chips (+ title quick filter)
- **Dynamic Chip Generation**: Auto-suggest chips from snapshot facets
- **Local Filtering**: Update preview without Shopify calls (in-snapshot set/substring logic)
- **Chip Interactions**: Add/remove chips → instant preview update (AND across types, OR within each type)
- **Exclusion**: MustNot tags supported (e.g., -tag)
- **Numeric**: priceGte/priceLte, inventoryEq post-filters

### **UI Components**
- **Chip Row**: Horizontal scrollable chips with counts
- **Suggested Chips**: Generated from snapshot data
- **Active Chips**: Currently applied filters
- **Exclusion Chips**: "-tag" support for negative filtering

### **API Changes**
```typescript
POST /api/preview/applyFilters
{
  "previewId": "p_abc123",
  "filterSpec": {
    "must": {
      "vendors": ["ACME"],
      "types": ["Hoodie"]
    },
    "mustNot": {
      "tags": ["clearance"]
    }
  }
}

Response:
{
  "total": 45,  // Filtered count
  "facets": {
    "vendors": [{"name": "ACME", "count": 45}],
    "types": [{"name": "Hoodie", "count": 45}]
  },
  "rows": [ /* filtered preview rows */ ],
  "page": 1,
  "pageSize": 25,
  "totalPages": 6
}
```

### **UI Testing**
- ✅ Click "+Vendor: ACME" chip → preview updates to show only ACME products
- ✅ Click "+Type: Hoodie" chip → preview further filtered to ACME hoodies
- ✅ Click "-Tag: clearance" chip → exclude clearance items
- ✅ Remove chip → preview expands back
- ✅ Counts update dynamically: "45 of 150 products selected"

### **Success Criteria**
- Chips generate from actual store data (vendors, types, etc.)
- Filtering is instant (<80ms target)
- Multiple filter types work together (AND logic)
- Exclusion filters work properly
- UI shows clear selected vs total counts

---

## 📄 **Phase 2D: CSV Export & R2 Storage**

### **Scope**
Add CSV export functionality with compression and R2 storage, localized headers.

### **Features**
- **CSV Generation**: Export filtered preview data to CSV (headers from locale keys)
- **Auto Compression**: gzip for ≥500 rows; set `Content-Encoding: gzip`
- **R2 Storage**: Upload to Cloudflare R2 bucket; return signed URL (e.g., 7‑day expiry)
- **Download UI**: Download button with progress indicator

### **CSV Format**
```csv
Product Title,SKU,Current Price,New Price,Change %,Product ID,Variant ID
Summer Dress,DRESS-001,29.99,50.00,+66.7%,gid://shopify/Product/123,gid://shopify/ProductVariant/456
```

### **API Changes**
```typescript
POST /api/preview/csv
{
  "previewId": "p_abc123"
}

Response:
{
  "url": "https://r2.signed/url/previews/p_abc123.csv.gz",
  "format": "csv.gz"
}
```

### **UI Testing**
- ✅ Click "Download CSV" → get properly formatted CSV file
- ✅ Large datasets (>500 rows) → get compressed .csv.gz file
- ✅ CSV includes all preview columns; Product/Variant IDs as last columns
- ✅ Download completes within 10 seconds for 5000 rows

### **Success Criteria**
- CSV format matches preview exactly; localized headers
- Large files compressed automatically (≥500 rows)
- Signed URL expiry configured (e.g., 7 days)
- IDs included as last columns
- Performance: <10 seconds for ~5k rows

---

## 🏷️ **Phase 2E: Tag Operations (Add/Remove)**

### **Scope**
Implement full tag operations with execution.

### **Features**
- **Tag Addition**: Add tags to filtered products
- **Tag Removal**: Remove specific tags from products
- **Tag Preview**: Show current tags → new tags in preview
- **Execution Mode**: Batched GraphQL for small sets (≤200); Bulk Mutation for large

### **UI Testing**
- ✅ Enter "Add 'summer-2024' tag to all dresses" → see tag preview
- ✅ Preview shows: Product | Current Tags | New Tags
- ✅ Execute → tags actually added in Shopify admin
- ✅ Enter "Remove 'clearance' tag from hoodies" → see tag removal preview

### **Success Criteria**
- Tag operations work with filtered products
- Preview shows tag changes clearly
- Execution updates actual Shopify products
- Performance: <30 seconds for 100 products

---

## 📦 **Phase 2F: Inventory Operations**

### **Scope**
Implement inventory quantity management.

### **Features**
- **Inventory Setting**: Set specific quantities
- **Inventory Adjustment**: Increment/decrement quantities
- **Location Support**: Handle multiple inventory locations
- **Variant-level**: Inventory operates on product variants
- **Execution Mode**: Batched GraphQL for small sets (≤200); Bulk Mutation for large

### **UI Testing**
- ✅ Enter "Set inventory to 50 for hoodies" → see inventory preview
- ✅ If multiple locations → get clarification for location selection
- ✅ Preview shows: Variant | Current Qty | New Qty | Location
- ✅ Execute → inventory actually updated in Shopify

### **Success Criteria**
- Inventory operations respect location requirements
- Preview shows per-variant inventory changes
- Location selection required for multi-location stores
- Execution updates actual Shopify inventory

---

## 📋 **Phase 2G: Status Operations (Publish/Draft)**

### **Scope**
Implement product status management.

### **Features**
- **Publish Products**: Change status from DRAFT to ACTIVE
- **Unpublish Products**: Change status from ACTIVE to DRAFT  
- **Archive Products**: Change status to ARCHIVED
- **Confirmation UI**: Require confirmation for destructive operations
- **Execution Mode**: Batched GraphQL for small sets (≤200); Bulk Mutation for large

### **UI Testing**
- ✅ Enter "Publish all draft products" → see status preview
- ✅ Preview shows: Product | Current Status | New Status
- ✅ Destructive operations (archive) → require explicit confirmation
- ✅ Execute → product status actually changed in Shopify

### **Success Criteria**
- Status operations work on product level
- Destructive operations require confirmation
- Preview shows status changes clearly
- Execution updates actual Shopify product status

---

## ⚡ **Phase 2H: Bulk Operations API Integration**

### **Scope**
Replace individual mutations with Shopify Bulk Operations API for large datasets.

### **Features**
- **Bulk Mutation API**: Use Shopify's bulk operations for >200 changes
- **Progress Tracking**: Real-time progress updates via SSE
- **Staging & Upload**: Upload JSONL to Shopify for bulk processing
- **Result Processing**: Handle bulk operation results and errors
- **Durable Objects**: Per‑shop DO manages job state and SSE fan‑out
- **Artifacts in R2**: Staged JSONL, bulk results, logs stored with TTL and signed access

### **New Components**
- **Progress Popup**: Floating bottom-right progress indicator
- **SSE Connection**: Server-sent events via Durable Object per shop
- **Background Jobs**: Queue-based bulk operation monitoring and retries

### **API Changes**
```typescript
POST /api/execute
{
  "previewId": "p_abc123"
}

Response:
{
  "taskId": "task_xyz789",
  "estimatedTime": "2-3 minutes",
  "totalItems": 1247
}

SSE /sse/progress/shop123
data: {"status": "preparing", "message": "Preparing bulk operation..."}
data: {"status": "uploading", "message": "Uploading changes..."}
data: {"status": "processing", "progress": {"done": 245, "total": 1247}}
data: {"status": "completed", "message": "✅ 1247 products updated successfully"}
```

### **UI Testing**
- ✅ Execute large operation (>200 items) → see floating progress popup
- ✅ Progress updates in real-time: "Processing 245/1247..."
- ✅ Bulk operation completes successfully
- ✅ Can handle failures gracefully with retry options

### **Success Criteria**
- Bulk operations handle >1000 items efficiently
- Progress updates in real-time
- Error handling and retry mechanisms
- Performance: 1000 items in <5 minutes

### Rate‑limit Policy
- Writes: batched Admin GraphQL for small sets (≤200); Bulk Mutation above that threshold.
- Handle 429/ throttling with backoff; chunk uploads; ensure idempotent retries for failed rows.
- Respect Bulk Operation constraints; requeue failures reported in result file.

---

## 🎯 **Phase 3: Advanced Features** (Future)

### **Planned Features**
- **Compare-at Price Operations**
- **SEO Field Management**
- **Metafield Operations** 
- **Collection Assignment**
- **Multi-location Inventory**
- **Scheduled Operations**
- **Operation History & Audit**
- **Revert Functionality**

---

## 🧪 **Testing Strategy**

### **Per-Phase Testing**
Each phase includes:
1. **Unit Tests**: API endpoints and business logic
2. **Integration Tests**: Database operations and Shopify API calls
3. **E2E Tests**: Complete user flows through UI
4. **Performance Tests**: Response times and load handling

### **Acceptance Criteria**
Every phase must pass:
- ✅ All UI flows work end-to-end
- ✅ Data persists correctly in database
- ✅ Shopify integration works with real API
- ✅ No regression in previous phases
- ✅ Performance meets targets

### **Test Data**
- **Development Store**: Shopify Partner dev store with sample products
- **Test Products**: Various product types, vendors, prices, inventory
- **Edge Cases**: Empty results, large datasets, special characters

---

## 📈 **Success Metrics**

### **Phase Completion Criteria**
- **Functionality**: All features work as specified
- **Performance**: Meets response time targets
- **Reliability**: No critical bugs or errors
- **UX**: Intuitive user experience with proper feedback
- **Testing**: Full test coverage with passing tests

### **Overall Goal**
Build a production-ready AI bulk editor that merchants can use confidently to manage thousands of products efficiently through natural language commands.
