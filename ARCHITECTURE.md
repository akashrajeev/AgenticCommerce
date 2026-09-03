# MANDATE Architecture

## One-line architecture

**AI proposes. Merchant APIs provide truth. The gateway authorizes. Razorpay executes. PostgreSQL proves what happened.**

## System flow

```text
                     ┌─────────────────────┐
                     │      AI BUYER       │
                     │ intent + ranking    │
                     │ recommendations    │
                     └─────────┬───────────┘
                               │
                     merchant discovery
                               │
                               ▼
                     ┌─────────────────────┐
                     │  MERCHANT CONTRACT  │
                     │ manifest / catalog  │
                     │ inventory / quotes  │
                     │ revenue opportunity │
                     └─────────┬───────────┘
                               │
                     explicit user approval
                               │
                               ▼
                     ┌─────────────────────┐
                     │  MANDATE GATEWAY    │
                     │                     │
                     │ policy              │
                     │ state machine       │
                     │ Razorpay adapter    │
                     │ verification        │
                     │ webhook reconcile   │
                     │ audit               │
                     └──────┬───────┬──────┘
                            │       │
                         writes   executes
                            │       │
                            ▼       ▼
                   ┌────────────┐  ┌──────────────┐
                   │ PostgreSQL │  │ Razorpay     │
                   │ durable    │  │ Test Mode    │
                   │ evidence   │  │ payment rail │
                   └────────────┘  └──────┬───────┘
                                         │
                                      webhook
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │   Gateway    │
                                  │ verify +     │
                                  │ reconcile    │
                                  └──────┬───────┘
                                         │
                                         ▼
                                  merchant order
                                         │
                                         ▼
                                  realized revenue
```

## Trust boundaries

There are three practical trust zones.

### 1. Probabilistic / untrusted: AI buyer

The model may:

- interpret natural-language intent;
- rank products;
- explain its recommendation;
- suggest a complementary product;
- prepare structured purchase intent data.

The model does **not** own the spending limit, payment secret, final payment amount, payment result or merchant-order confirmation.

### 2. Trusted control plane: MANDATE gateway

The gateway is the financial authorization boundary. It independently re-reads merchant truth and evaluates deterministic policies before invoking Razorpay.

Responsibilities include:

- purchase-intent validation;
- merchant quote revalidation;
- product and inventory revalidation;
- merchant identity validation;
- quote-expiry validation;
- amount integrity validation;
- hard spending limit validation;
- quantity validation;
- transaction state transitions;
- Razorpay order creation;
- server-side checkout signature verification;
- payment retrieval/capture;
- webhook signature verification and deduplication;
- merchant-order confirmation;
- audit persistence.

### 3. Payment execution: Razorpay Test Mode

Razorpay is an execution rail, not the policy engine. The gateway creates the order only after authorization and keeps Razorpay API credentials server-side.

## Golden transaction state machine

```text
intent_proposed
      │
      ▼
price_verified
      │
      ▼
policy_pending
      │
      ├───────────────► policy_blocked
      │
      ▼
policy_authorized
      │
      ▼
razorpay_order_created
      │
      ▼
checkout_started
      │
      ├───────────────► payment_failed
      │
      ▼
payment_authorized
      │
      ▼
payment_captured
      │
      ▼
payment_verified
      │
      ▼
order_confirmed
```

Terminal failure and cancellation states are deliberately non-regressible. A retry creates a new transaction rather than mutating a failed attempt into success.

## Basket / revenue flow

```text
source product
      ↓
merchant recommendation engine
      ↓
AI presents opportunity
      ↓
explicit user approval
      ↓
multi-line PurchaseIntent
      ↓
fresh merchant quote
      ↓
gateway revalidation
      ↓
Razorpay order
      ↓
confirmed merchant order
      ↓
realized incremental revenue
```

A recommendation is an opportunity, not authorization.

## Persistence architecture

PostgreSQL stores:

- transactions;
- audit events;
- webhook dedupe records;
- merchant-order attribution.

Gateway startup hydrates the runtime transaction/audit store from PostgreSQL. Merchant-order attribution is also reconstructed for revenue reporting.

The merchant's checkout quote store is intentionally separate and remains an in-memory service concern in the current implementation.

## Public interfaces

Merchant:

```text
GET  /.well-known/agent-commerce
GET  /api/agent/catalog
GET  /api/agent/products/:id
GET  /api/agent/inventory/:id
POST /api/agent/checkout/preview
GET  /api/agent/checkout/quotes/:id
GET  /api/agent/recommendations?productId=:id&maxSpendPaise=:limit
POST /api/agent/orders/confirm
```

Gateway:

```text
GET  /health
POST /v1/purchase-intents
POST /v1/transactions/:id/razorpay-order
POST /v1/transactions/:id/checkout-started
POST /v1/transactions/:id/verify-payment
POST /v1/transactions/:id/capture
POST /v1/transactions/:id/retry-payment
POST /v1/webhooks/razorpay
GET  /v1/transactions/:id/timeline
GET  /v1/merchant/orders
```

Judge-facing buyer surfaces:

```text
/golden-path
/live-proof
/proof
/labs
/policy-lab
/tamper-lab
/webhook-lab
/demo
```

## Design invariants

```text
LLM → Razorpay API                         forbidden
Frontend → paid state                      forbidden
Policy BLOCK → Razorpay order              forbidden
Unverified payment → merchant order        forbidden
AI → spending-limit modification            forbidden
Client amount → trusted order amount        forbidden
Duplicate webhook → duplicate order         forbidden
Late failure → successful state regression  forbidden
```

## Why this architecture fits agentic commerce

Traditional storefront logic assumes a human controls the browser. MANDATE assumes the buyer can be an autonomous software agent while keeping the financial boundary deterministic.

That means the system separates **decision quality** from **financial authority**:

- AI provides flexible reasoning where probabilistic intelligence adds value.
- Merchant systems provide product, inventory and pricing truth.
- Deterministic gateway rules decide whether money may move.
- Razorpay handles payment execution.
- PostgreSQL and the audit trail provide durable evidence.
