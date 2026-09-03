# MANDATE — Track 01 Coverage

## Purpose

This document maps the implementation in this repository to the Razorpay AI Buildathon **Track 01: AI Growth & Agentic Commerce** submission goals.

The central design claim is simple:

> **AI recommends and plans. The user controls the hard boundary. The gateway authorizes. Razorpay executes.**

A judge should be able to understand the coverage from this file without running the application first.

## Coverage matrix

| Track capability / evaluation concern | MANDATE implementation | Primary evidence in repository |
|---|---|---|
| AI buyer | Model-backed natural-language shopping planner interprets a request and returns a structured product plan. | `apps/buyer/src/app/api/agent/purchase-plan/route.ts` |
| Conversational commerce | Buyer accepts a natural-language request, discovers the merchant, ranks products and prepares checkout. | `apps/buyer/src/app/BuyerWorkspace.tsx` |
| Agent-readable merchant | Merchant publishes a machine-readable manifest, catalog, product, inventory and checkout interfaces. | `/.well-known/agent-commerce`, `apps/merchant/src/app/api/agent/` |
| Merchant discovery | Buyer reads the merchant agent manifest and catalog rather than scraping the storefront. | `apps/buyer/src/app/api/agent/purchase-plan/route.ts` |
| Product ranking | AI ranks eligible products using live merchant facts and checkout quotes. | `apps/buyer/src/app/api/agent/purchase-plan/route.ts` |
| Upsell / cross-sell | Merchant-owned recommendation engine proposes complementary products; buyer can present them for explicit approval. | `apps/merchant/src/lib/revenue.ts`, `apps/merchant/src/app/api/agent/recommendations/route.ts` |
| Revenue growth | Basket expansion is attributed to the confirmed transaction, separating potential opportunity from realized incremental revenue. | merchant operations + persisted merchant order records |
| Campaign / growth loop | Revenue recommendations are merchant-controlled and can be surfaced as agent-assisted opportunities without granting payment authority. | `apps/merchant/src/lib/revenue.ts` |
| End-to-end transaction | Intent → quote → deterministic policy → Razorpay order → checkout/payment → verification → merchant order. | `apps/gateway/src/app.ts`, `apps/gateway/src/transaction-core.ts` |
| Explainable money movement | Policy checks and audit events record why an intent was allowed or blocked and how payment state changed. | `apps/gateway/src/transaction-core.ts` |
| Bounded spending | A user-provided hard spending limit is evaluated against the complete merchant quote. | `evaluatePolicy()` in `apps/gateway/src/transaction-core.ts` |
| Quantity safety | Total basket quantity and per-line quantity are checked against the gateway policy. | `evaluatePolicy()` |
| Inventory safety | Gateway re-reads merchant inventory for every requested line before authorization. | `loadMerchantSnapshot()`, `evaluatePolicy()` |
| Merchant integrity | Quote merchant identity must match the purchase intent. | `evaluatePolicy()` |
| Quote validity | Expired quotes are blocked. | `evaluatePolicy()` |
| Amount integrity | Every quote line is compared with current merchant product price, quantity and line total before Razorpay order creation. | `evaluatePolicy()` |
| AI/payment separation | The model output is never used as the payment authority; Razorpay order creation occurs only from an authorized gateway transaction. | buyer planner + gateway transaction flow |
| User approval boundary | Recommended basket items are suggestions; basket expansion returns to the purchase-intent and policy gate. | buyer workspace + gateway intent API |
| Razorpay integration | Real Razorpay Test Mode Orders/Payments/Standard Checkout APIs are used; secrets remain server-side. | `apps/gateway/src/razorpay.ts`, `apps/gateway/src/app.ts` |
| Payment verification | Checkout signatures are verified server-side and payment state is reconciled from Razorpay. | `verify-payment` route in `apps/gateway/src/app.ts` |
| Webhook handling | Razorpay webhook signatures are verified before event processing. | `/v1/webhooks/razorpay` |
| Webhook idempotency | Persistent webhook event claiming/deduplication prevents the same delivery from creating a second effect. | gateway persistence + webhook replay lab |
| Failure handling | Failed payments become terminal attempts; retry creates a fresh transaction and re-evaluates the merchant quote and policy. | `retryFailedTransaction()` |
| Late-event safety | Late payment failures cannot regress already-captured/verified/confirmed transactions. | `recordPayment()` + adversarial tests |
| Transaction state machine | Only valid state transitions are accepted; invalid transitions are rejected. | `transitionTransaction()` |
| PostgreSQL persistence | Transactions, audit events, webhook dedupe and merchant-order attribution are persisted and hydrated on startup. | `apps/gateway/src/persistence.ts`, `database/` |
| Auditability | Every important intent, policy, payment and order transition gets an auditable event. | `AuditEvent` timeline |
| Restart resilience | Gateway state can be reconstructed from PostgreSQL rather than process memory alone. | persistence lab + startup hydration |
| Security / trust boundaries | Browser and LLM are treated as untrusted for money decisions; gateway is the deterministic authorization boundary. | README + architecture docs |
| Failure/recovery demonstration | Judge-facing policy lab shows an over-limit basket blocked before Razorpay, then authorized under a larger limit. | `apps/buyer/src/app/policy-lab/` |
| Amount tamper demonstration | Judge-facing tamper lab demonstrates client-provided amount cannot replace the trusted merchant quote. | `apps/buyer/src/app/tamper-lab/` |
| Webhook replay demonstration | Judge-facing webhook lab delivers the same synthetic webhook identity twice and shows the second delivery is a duplicate. | `apps/buyer/src/app/webhook-lab/` |
| Unified judge proof | One page connects transaction, payment IDs, webhook/audit evidence and merchant revenue attribution. | `apps/buyer/src/app/proof/` |
| Demo readiness | One page checks whether the merchant, gateway, agent manifest, Razorpay rail and persistence layers are reachable/configured. | `apps/buyer/src/app/demo/` |
| Reproducibility | Docker Compose provides a single local stack for buyer, merchant, gateway and PostgreSQL; CI validates typecheck, tests and build. | `docker-compose.yml`, `.github/workflows/ci.yml` |

## Trust model

### AI may do

- Interpret user intent.
- Rank products.
- Explain recommendations.
- Suggest complementary products.
- Prepare a structured purchase intent.

### AI may not do

- Increase the user's hard spending limit.
- Choose the final payment amount independently.
- Manufacture a merchant price.
- Claim a payment succeeded.
- Confirm a merchant order.

### Deterministic systems own

- Merchant price and quote.
- Inventory.
- Merchant identity.
- Spending limit.
- Quantity limits.
- Quote expiry.
- Amount integrity.
- Transaction state transitions.
- Razorpay order creation.
- Payment/signature verification.
- Webhook reconciliation.
- Merchant-order confirmation.
- Audit persistence.

## Golden-path scenario

The canonical Track 01 demonstration is:

```text
User request
  "Find me the best ANC headphones under ₹5,000."
        ↓
AI buyer discovers Mandate Market
        ↓
Merchant catalog + live checkout quote
        ↓
SoundMax Pro selected
        ↓
Merchant revenue engine recommends Arc Precision Mouse
        ↓
User explicitly approves the add-on
        ↓
Combined basket quote
        ↓
Gateway revalidates every line
        ↓
Hard-limit policy check
        ↓
Razorpay Test Mode order
        ↓
Checkout + payment
        ↓
Server-side payment verification
        ↓
Razorpay webhook reconciliation
        ↓
Merchant order confirmed
        ↓
Realized incremental revenue recorded
```

## Golden-path failure scenario

The same basket is intentionally tested against a lower hard limit:

```text
SoundMax Pro + approved add-on
        ↓
Fresh merchant quote
        ↓
Combined total exceeds ₹5,000
        ↓
MAX_SPEND = FAIL
        ↓
Transaction = policy_blocked
        ↓
Razorpay order = NOT CREATED
```

The recovery path increases the user's limit explicitly and reruns the same deterministic authorization process; the original blocked transaction remains part of the audit history.

## Evidence-first judging flow

A reviewer who does not run the full stack can start with these files/pages:

1. `README.md` — architecture and real Razorpay flow.
2. `TRACK-01-COVERAGE.md` — requirement-to-code mapping.
3. `ARCHITECTURE.md` — trust boundaries and state machine.
4. `/labs` — focused safety demonstrations.
5. `/proof` — one-screen transaction/payment/revenue evidence.
6. `/demo` — environment readiness checks.
7. `apps/gateway/src/transaction-core.ts` — deterministic financial policy boundary.
8. `apps/gateway/src/app.ts` — Razorpay + webhook lifecycle.

## What constitutes success

MANDATE is not positioned as "an LLM that can click Pay". The submission is positioned as an **agentic commerce control plane** in which:

- AI creates value through discovery, ranking and merchant revenue recommendations.
- The user remains the source of spending authority.
- The merchant remains the source of product, inventory and pricing truth.
- The gateway enforces deterministic transaction policy.
- Razorpay remains the payment execution rail.
- PostgreSQL and the audit timeline make the result durable and inspectable.

That separation is the core of the implementation and should remain intact as features are added.
