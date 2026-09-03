# MANDATE Delegated / Autonomous Buying

## Purpose

Phase 5 adds bounded autonomous buying. A user can issue a reusable delegated mandate to a buyer agent. The agent may execute qualifying purchases without another approval prompt, but every purchase still passes through the trusted MANDATE gateway.

The key invariant is:

```text
User grants authority once
        ↓
Reusable delegated mandate
        ↓
Agent proposes a qualifying purchase
        ↓
Fresh merchant quote
        ↓
Deterministic mandate + policy checks
        ↓
Reservation against total budget
        ↓
Transaction authority
        ↓
Razorpay Test Mode
```

The delegated mandate is not a payment credential. It is a bounded authorization policy. The gateway remains the only component allowed to create the Razorpay order.

## Bounds

A delegated mandate contains:

```text
subject
agent
purpose
allowed merchants
allowed products
maximum spend per purchase
total budget
constraints
issuedAt / expiresAt
nonce
status
```

The gateway tracks three separate budget quantities:

```text
spent     = confirmed autonomous purchases
reserved  = pending authorized executions
remaining = total budget - spent - reserved
```

A new execution must satisfy:

```text
active mandate
AND not expired
AND amount <= per-purchase limit
AND amount <= remaining budget
AND merchant is allowed
AND every product is allowed
AND checkout binding is valid
AND merchant quote/policy validation passes
```

## Durable spend reservation

When PostgreSQL is configured, the budget reservation is guarded with an atomic SQL update. This prevents two gateway instances from both spending the same remaining budget.

The database stores:

```text
delegated_mandates
delegated_mandate_executions
```

An execution begins as `reserved`. It becomes `confirmed` after the underlying transaction reaches `order_confirmed`, or `released` after an authorized attempt fails or is canceled.

## API

### Create a delegated mandate

```http
POST /v1/delegated-mandates
Content-Type: application/json
```

Example:

```json
{
  "subjectId": "user_001",
  "agentId": "buyer_001",
  "purpose": "Buy approved office electronics",
  "merchantIds": ["mandate-market"],
  "allowedProductIds": ["hp-001"],
  "maxSpendPerPurchase": { "currency": "INR", "amountPaise": 500000 },
  "totalBudget": { "currency": "INR", "amountPaise": 1000000 },
  "expiresAt": "2030-01-01T00:00:00.000Z"
}
```

### Execute inside a mandate

```http
POST /v1/delegated-mandates/:mandateId/execute
Content-Type: application/json
```

The request contains a merchant-derived checkout binding:

```text
checkoutId
merchantId
quoteId
currency
exact total
line items
quote expiry
cartHash
```

The gateway reconstructs the canonical binding and rejects a hash mismatch before authorization.

A successful execution returns:

```text
mode: delegated_autonomous
authorization
transaction
execution
mandate state
Razorpay order, when Test Mode credentials are configured
```

### Revoke

```http
POST /v1/delegated-mandates/:mandateId/revoke
```

Revocation immediately closes the execution boundary. Existing reservations are not silently converted into new authority.

### Inspect

```http
GET /v1/delegated-mandates
GET /v1/delegated-mandates/:mandateId
```

The response exposes the remaining budget, reserved amount, execution count, blocked count, status and expiry so a buyer UI can show the delegated authority explicitly.

## Failure behavior

```text
Amount above per-purchase limit
    → BLOCK

Amount above remaining total budget
    → BLOCK

Merchant not allowed
    → BLOCK

Product not allowed
    → BLOCK

Mandate expired/revoked/exhausted
    → BLOCK

Merchant quote or deterministic policy fails
    → BLOCK

Razorpay order creation fails after reservation
    → RELEASE reservation
```

A block increments `blockedCount`. A blocked request cannot create a transaction authorization or Razorpay order.

## Judge-facing demonstration

The buyer application exposes `/delegated-mandates`.

Recommended demo:

```text
1. Issue a mandate:
   “Office electronics, max ₹5,000 per purchase,
    total ₹10,000, mandate-market, hp-001 only.”

2. Run qualifying purchase:
   → ALLOWED
   → execution reserved
   → transaction created

3. Run an over-limit basket:
   → BLOCKED
   → reason shows the mandate boundary
   → blocked count increments
   → no reservation is created

4. Revoke mandate:
   → ACTIVE → REVOKED
   → subsequent autonomous execution is BLOCKED
```

The important visual distinction is that the agent is autonomous only inside a human-defined boundary. The model does not get a tool that can modify `maxSpendPerPurchase`, `totalBudget`, merchants, products or expiry.

## Relationship to Phase 4

Phase 4 creates a cryptographically bound authorization for one checkout. Phase 5 creates a reusable delegated policy and issues a fresh execution nonce for each purchase.

```text
Phase 4
one mandate
→ one checkout binding
→ one payment authorization

Phase 5
one delegated mandate
→ many bounded execution attempts
→ each attempt gets fresh checkout binding + execution nonce
```

The underlying Phase 4 merchant revalidation, deterministic policy engine, transaction state machine and Razorpay authority are reused rather than bypassed.

## Status

```text
Reusable delegated mandate      IMPLEMENTED
Per-purchase spend ceiling      IMPLEMENTED
Total spend ceiling             IMPLEMENTED
Merchant/product allow-lists   IMPLEMENTED
Durable budget reservation      IMPLEMENTED with PostgreSQL
Execution ledger                IMPLEMENTED
Revocation                      IMPLEMENTED
Buyer delegated-authority UI    IMPLEMENTED
Autonomous no-click path        IMPLEMENTED at gateway boundary
```

### Current limitation

The current buyer dashboard demonstrates the autonomous authorization boundary and can create a Razorpay Test Mode order when credentials are configured. Final payment capture and webhook reconciliation still use the existing MANDATE payment lifecycle. The delegated execution can therefore remain `reserved` until the underlying transaction reaches an authoritative terminal state.
