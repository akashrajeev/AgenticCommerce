# MANDATE — Final Judge Demo Runbook

## Objective

Run one deterministic, evidence-first demonstration of Track 01:

```text
Natural-language request
→ merchant discovery
→ model selection
→ merchant recommendation
→ explicit user approval
→ fresh basket quote
→ deterministic policy
→ Razorpay Test Mode
→ server verification
→ webhook reconciliation
→ merchant order
→ realized revenue
```

The core claim remains:

> **AI recommends and plans. The user controls the hard boundary. The gateway authorizes. Razorpay executes.**

## Before the demo

Start the complete Docker Compose stack:

```bash
docker compose up --build
```

Expected local services:

```text
Buyer     http://localhost:3001
Merchant  http://localhost:3000
Gateway   http://localhost:4000
Postgres  localhost:5432
```

Configure Test Mode credentials on the gateway and a public webhook delivery target before attempting the real payment portion. Never place Razorpay secrets in the buyer environment.

## 90-second golden path

Open the buyer at `http://localhost:3001`.

Enter:

```text
Find me the best ANC headphones under ₹5,000.
```

Keep the hard limit at ₹5,000.

Run **Evaluate purchase**.

Say:

> "The buyer is an LLM, but it does not own payment authority. It discovers the merchant through the machine-readable contract and proposes a product."

The canonical product is SoundMax Pro (`hp-001`). The merchant may expose a complementary recommendation such as Arc Precision Mouse (`ms-001`).

Approve the recommended basket.

Say:

> "This recommendation is only a suggestion. The basket changes only after explicit user approval, then the merchant generates a fresh quote."

The combined basket should exceed the ₹5,000 hard limit.

Run the policy result and point to:

```text
MAX_SPEND = FAIL
POLICY = BLOCK
RAZORPAY ORDER = NOT CREATED
```

Then raise the user-controlled hard limit to ₹8,000 and repeat the same basket approval.

Expected:

```text
MAX_SPEND         PASS
QUANTITY_LIMIT    PASS
INVENTORY         PASS
MERCHANT          PASS
QUOTE_VALIDITY    PASS
AMOUNT_INTEGRITY  PASS
```

Create the Razorpay Test Mode order and open Standard Checkout.

Complete a Razorpay Test Mode payment with the configured test credentials.

The trusted path should then produce:

```text
PAYMENT_CAPTURED
→ PAYMENT_VERIFIED
→ WEBHOOK_RECEIVED
→ WEBHOOK_RECONCILIATED
→ ORDER_CONFIRMED
```

## Evidence screen

Open:

```text
http://localhost:3001/proof
```

The page now auto-refreshes every 2.5 seconds so webhook-only state changes appear without a manual refresh.

Show the judge:

- transaction ID
- final quoted basket amount
- authority chain
- Razorpay order ID
- Razorpay payment ID
- merchant order ID
- base basket value
- final basket value
- realized incremental revenue
- audit events

Do not describe an order as successful unless the gateway state and merchant order evidence show it.

## Safety labs

Open:

```text
http://localhost:3001/labs
```

Run the focused demonstrations in this order:

1. `Policy boundary` — prove an over-limit basket stops before Razorpay.
2. `Amount integrity` — send a false client amount and show the merchant quote remains authoritative.
3. `Webhook safety` — replay one event identity twice and show the second delivery is a duplicate.
4. `Persistence` — restart the gateway and show transactions/audit/revenue attribution are reconstructed from PostgreSQL.

## Merchant growth proof

Open the merchant operations console and the growth command center.

The growth view distinguishes:

```text
Potential lift = catalog opportunity
Realized uplift = confirmed order attribution
```

Use this language with judges. Recommendations never receive payment authority; only the existing gateway transaction flow can authorize a payment.

## Failure handling

### Policy block

Expected behavior:

```text
Basket over hard limit
→ transaction policy_blocked
→ no Razorpay order
→ blocked attempt stays auditable
```

### Payment failure

Expected behavior:

```text
payment_failed
→ no merchant order
→ retry creates a fresh transaction
→ merchant quote + policy are re-evaluated
```

### Duplicate webhook

Expected behavior:

```text
same dedupe identity
→ first delivery accepted
→ second delivery acknowledged as duplicate
→ no second state transition
```

### Late payment failure

A late failure event must not regress a transaction that is already captured, verified or confirmed. The event should remain auditable without changing the successful terminal evidence.

## What not to claim

Do not claim that MANDATE is a production payment platform, autonomous unrestricted purchasing system, or fully persistent merchant catalog.

The repository currently treats the merchant quote store as in-memory and the real Test Mode path still requires local credentials plus reachable webhook delivery. These are explicit implementation boundaries, not hidden assumptions.

## Final judge sentence

End with:

> **"We did not build an LLM that clicks Pay. We built an agentic commerce control plane where AI creates the recommendation, the user owns the limit, the merchant owns price and inventory, the gateway owns authorization, Razorpay executes the payment, and the audit trail proves what happened."**
