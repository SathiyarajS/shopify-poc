# Shopify Bulk Operation – Run Once per Store (Spec)

## Problem
Shopify Bulk Operations run every time `bulkOperationRunQuery` is called. For a post-installation POC, we want **only one bulk run per store** (unless explicitly reset).

## Solution
Use a tiny DB table to record installation + bulk status. Gate bulk start by checking this state.

---

## Table Design

```sql
CREATE TABLE app_install_state (
  shop_id TEXT PRIMARY KEY,          -- from GraphQL `shop.id` or myshopifyDomain
  installed_at TIMESTAMPTZ NOT NULL,
  bulk_started_at TIMESTAMPTZ,
  bulk_operation_id TEXT,
  bulk_status TEXT,                  -- RUNNING | COMPLETED | FAILED | CANCELED
  bulk_completed_at TIMESTAMPTZ,
  bulk_result_url TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
```

---

## Flow

### On Install
- Insert `shop_id` + `installed_at=NOW()`.

### On First Dashboard Load
- If `bulk_started_at IS NULL`, trigger bulk, update row.

### Repeated Loads
- Read DB row.
- If bulk already started, do not trigger again.
- Instead, show current `bulk_status` + poll Shopify.

### On Bulk Completion
- Poll `currentBulkOperation` until terminal.
- Update row with `bulk_status`, `bulk_completed_at`, `bulk_result_url`.

---

## Node/Express Pseudocode

```js
async function startBulkOnce(db, shopId) {
  return await db.tx(async t => {
    const s = await t.oneOrNone('SELECT * FROM app_install_state WHERE shop_id=$1 FOR UPDATE', [shopId]);

    if (!s) {
      await t.none('INSERT INTO app_install_state (shop_id, installed_at) VALUES ($1, NOW())', [shopId]);
    } else if (s.bulk_started_at && !['FAILED','CANCELED'].includes(s.bulk_status)) {
      return { alreadyStarted: true, state: s };
    }

    // Check if Shopify already has a running bulk
    const status = await shopifyGql(`query { currentBulkOperation { id status url } }`);
    if (status.currentBulkOperation?.status === 'RUNNING') {
      await t.none('UPDATE app_install_state SET bulk_started_at=NOW(), bulk_operation_id=$2, bulk_status=$3 WHERE shop_id=$1',
                  [shopId, status.currentBulkOperation.id, 'RUNNING']);
      return { attachedToExisting: true };
    }

    // Start fresh bulk
    const start = await shopifyGql(`mutation { bulkOperationRunQuery(query: "{ orders(first: 10) { edges { node { id name createdAt } } } }") { bulkOperation { id status } userErrors { message } } }`);
    if (start.bulkOperationRunQuery.userErrors?.length) throw new Error(start.bulkOperationRunQuery.userErrors[0].message);

    await t.none('UPDATE app_install_state SET bulk_started_at=NOW(), bulk_operation_id=$2, bulk_status=$3 WHERE shop_id=$1',
                [shopId, start.bulkOperationRunQuery.bulkOperation.id, start.bulkOperationRunQuery.bulkOperation.status]);

    return { started: true };
  });
}
```

---

## Edge Cases
- **Concurrent bulk**: Shopify allows only one active bulk per store. Attach to existing instead of starting new.
- **Uninstall/reinstall**: Clear row on `app/uninstalled` webhook or reset `bulk_started_at`.
- **Retry**: If status is FAILED or CANCELED, allow retry.

---

## Success Criteria
- Exactly one bulk run per store unless explicitly reset.
- Clear visibility of status in DB.
- Idempotent + safe under concurrent requests.
