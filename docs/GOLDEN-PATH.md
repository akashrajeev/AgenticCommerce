# MANDATE — Track 01 Golden Path

## Objective

This is the canonical demonstration for the submission. It is intentionally short enough to perform live, while exercising the actual architecture rather than a mock flow.

## 30-second judge story

> A user asks an AI buyer for the best ANC headphones under ₹5,000. The buyer discovers a real agent-ready merchant, selects the best product, and receives a merchant-owned complementary recommendation. The user explicitly approves the add-on. MANDATE then builds a combined quote and runs deterministic policy checks against the user's hard limit. Only an allowed basket can reach Razorpay. Payment is verified, the webhook is reconciled, and the merchant gets a durable order plus realized revenue attribution.

## Canonical data

Primary product:

- **SoundMax Pro**
- Product ID: `hp-001`
- Demonstration price: ₹3,999

Complementary product:

- **Arc Precision Mouse**
- Product ID: `ms-001`
- Demonstration price: ₹2,499

The live merchant quote is always the source of truth for the final basket amount. Do not hard-code a total into the payment path.

## Happy path

### 1. Buyer request

Input:

```text
Find me the best ANC headphones under ₹5,000.
```

Expected AI behavior:

```text
Discover Mandate Market
Read manifest + catalog + live checkout quote
Rank eligible products
Select SoundMax Pro
```

### 2. Merchant growth opportunity

The merchant recommendation layer proposes a complementary product for the selected item.

Expected presentation:

```text
Recommended add-on
Arc Precision Mouse

Why:
Complementary category + available inventory + merchant-defined recommendation
```

The recommendation is **not** an authorization.

### 3. User approval

The buyer asks for or receives explicit approval before adding the recommendation to the purchase intent.

The final intent contains the complete basket, not a model-controlled amount.

### 4. Fresh combined quote

Merchant calculates:

```text
SoundMax Pro × 1
Arc Precision Mouse × 1

subtotal
shipping
correct tax/discount treatment
final total
quote expiry
```

### 5. Gateway authorization

Gateway independently re-reads:

- merchant quote
- product prices
- inventory
- merchant identity
- quote expiry

Then evaluates:

```text
MAX_SPEND
QUANTITY_LIMIT
INVENTORY
MERCHANT
QUOTE_VALIDITY
AMOUNT_INTEGRITY
```

All checks must pass before a Razorpay order may be created.

### 6. Razorpay

Only after authorization:

```text
Razorpay Orders API
→ Standard Checkout
→ Test Mode payment
→ server-side verification
```

The browser cannot set the gateway's authorized amount.

### 7. Webhook reconciliation

The payment lifecycle should show:

```text
CHECKOUT_STARTED
→ PAYMENT_CAPTURED
→ WEBHOOK_RECEIVED
→ WEBHOOK_RECONCILIATED
→ PAYMENT_VERIFIED
→ ORDER_CONFIRMED
```

### 8. Revenue attribution

After the merchant order is confirmed:

```text
Base basket value
Final basket value
Incremental revenue
```

Only confirmed orders count as **realized** revenue.

## Failure path

Run the exact same basket against a ₹5,000 hard limit.

Expected:

```text
Combined quote > ₹5,000
        ↓
MAX_SPEND = FAIL
        ↓
POLICY = BLOCK
        ↓
NO RAZORPAY ORDER
```

The important point is that the AI can recommend the add-on, but cannot use that recommendation to override the user's limit.

## Recovery path

Raise the user-controlled limit to ₹8,000 and run the same basket again.

Expected:

```text
MAX_SPEND         ✓
QUANTITY_LIMIT    ✓
INVENTORY         ✓
MERCHANT          ✓
QUOTE_VALIDITY    ✓
AMOUNT_INTEGRITY  ✓
        ↓
POLICY_AUTHORIZED
        ↓
RAZORPAY ORDER CREATED
```

The blocked attempt remains auditable; recovery creates a fresh authorized transaction.

## Proof pages

Use these in order:

1. **`/labs`** — launch pad for the safety demos.
2. **`/policy-lab`** — demonstrate hard-limit block and recovery.
3. **`/tamper-lab`** — demonstrate amount integrity.
4. **`/webhook-lab`** — demonstrate duplicate-event handling.
5. **`/proof`** — show the successful transaction, Razorpay IDs, audit trail and realized revenue.
6. **`/demo`** — show environment readiness.
7. **Persistence page** — restart the gateway and demonstrate state reconstruction from PostgreSQL.

## Golden-path judge script

Say this while operating the app:

```text
1. "The buyer is an LLM, but it does not own the money."
2. Submit the natural-language shopping request.
3. "The merchant exposes a machine-readable catalog, so the buyer does not scrape the storefront."
4. Show SoundMax Pro and the merchant's recommended add-on.
5. Approve the add-on.
6. "Now the gateway rebuilds and validates the complete basket."
7. Run the ₹5,000 policy scenario.
8. "The basket is over the user's hard limit, so Razorpay is never called."
9. Raise the limit to ₹8,000.
10. Create the Razorpay Test Mode order.
11. Complete test checkout.
12. Show webhook reconciliation and the final merchant order.
13. Open `/proof` and point to the realized incremental revenue.
14. Optional: replay the webhook and show the duplicate is ignored.
15. Optional: restart the gateway and show persisted state remains.
```

## What to show in GitHub even without execution

A reviewer who only reads the repository should still be able to trace the scenario through:

```text
README.md
↓
TRACK-01-COVERAGE.md
↓
docs/GOLDEN-PATH.md
↓
apps/buyer/src/app/api/agent/purchase-plan/route.ts
↓
apps/merchant/src/lib/revenue.ts
↓
apps/gateway/src/transaction-core.ts
↓
apps/gateway/src/app.ts
↓
apps/gateway/src/persistence.ts
```

The code and documentation should tell the same story: **AI creates and recommends; deterministic controls authorize; Razorpay executes; durable records prove what happened.**
