# MANDATE — Feature Inventory

This is the complete feature inventory for the submission. It is intended to answer a judge's first question:

> **What exactly did this project build, and where can I verify it?**

Status vocabulary:

- **Implemented** — present in the repository.
- **Tested** — exercised during development and/or covered by automated tests.
- **External setup** — depends on credentials, network access or external infrastructure.

---

## 1. Agentic buyer

### Natural-language purchase planning

**Implemented · Tested**

A user can describe what they want in natural language. The buyer turns the request into a structured plan containing requirements, ranked products, a selected product and an explanation.

Evidence:

```text
apps/buyer/src/app/api/agent/purchase-plan/route.ts
apps/buyer/src/app/BuyerWorkspace.tsx
```

### Merchant discovery through an agent contract

**Implemented · Tested**

The buyer reads a machine-readable merchant manifest and catalog instead of scraping the storefront.

Evidence:

```text
/.well-known/agent-commerce
apps/merchant/src/app/api/agent/
```

### Product ranking

**Implemented · Tested**

The buyer evaluates live merchant product facts and uses the model to rank suitable products.

Evidence:

```text
apps/buyer/src/app/api/agent/purchase-plan/route.ts
```

---

## 2. Merchant agent commerce

### Machine-readable catalog

**Implemented · Tested**

Products are exposed as structured data for software buyers.

### Inventory interface

**Implemented · Tested**

A buyer can retrieve current availability through the merchant API.

### Checkout quote interface

**Implemented · Tested**

The merchant calculates a fresh quote for the requested basket rather than accepting a client-declared amount.

### Product / inventory endpoints

**Implemented · Tested**

```text
GET  /api/agent/catalog
GET  /api/agent/products/:id
GET  /api/agent/inventory/:id
POST /api/agent/checkout/preview
GET  /api/agent/checkout/quotes/:id
```

---

## 3. Merchant growth

### Upsell / cross-sell recommendations

**Implemented · Tested**

The merchant-owned recommendation engine ranks complementary products using deterministic product signals such as category fit, shared tags, rating/review proof, price relationship and inventory.

Evidence:

```text
apps/merchant/src/lib/revenue.ts
apps/merchant/src/app/api/agent/recommendations/route.ts
```

### Explicit user approval

**Implemented · Tested**

Recommendations are presented as proposals. They are not silently inserted into a transaction.

Evidence:

```text
apps/buyer/src/app/BuyerWorkspace.tsx
```

### Basket uplift attribution

**Implemented · Tested**

The system records the base basket value, final basket value and incremental revenue after merchant-order confirmation.

### Merchant growth command center

**Implemented · Tested**

The merchant UI distinguishes:

```text
Potential lift  = opportunity
Realized uplift = confirmed order attribution
```

Evidence:

```text
apps/merchant/src/app/growth/page.tsx
```

### Campaign model

**Implemented · Tested**

Merchant-owned growth campaigns define objectives and eligible product pairings without gaining payment authority.

---

## 4. Deterministic payment authorization

### PurchaseIntent validation

**Implemented · Tested**

The gateway validates identifiers, quantities, basket shape and user spend limit before considering payment.

### Hard max-spend policy

**Implemented · Tested**

The gateway compares the complete fresh merchant quote against the user-provided hard limit.

### Quantity policy

**Implemented · Tested**

Per-line and aggregate quantity limits are enforced.

### Inventory revalidation

**Implemented · Tested**

The gateway independently re-reads merchant inventory for every line before authorization.

### Merchant identity validation

**Implemented · Tested**

The merchant represented by the quote must match the intended merchant.

### Quote expiry validation

**Implemented · Tested**

Expired quotes are rejected before payment.

### Amount integrity

**Implemented · Tested**

The gateway compares quote lines against current merchant pricing and line totals. Client-provided totals are not trusted.

Evidence:

```text
apps/gateway/src/transaction-core.ts
apps/buyer/src/app/tamper-lab/
```

---

## 5. Transaction state machine

### Valid transition enforcement

**Implemented · Tested**

Transaction state changes are centrally controlled. Invalid transitions are rejected.

Evidence:

```text
apps/gateway/src/transaction-core.ts
```

### Failed-attempt isolation

**Implemented · Tested**

A failed payment remains a failed attempt. Retry creates a new transaction and reruns authorization.

### Late-event safety

**Implemented · Tested**

Late payment failures do not regress transactions already captured, verified or confirmed.

---

## 6. Razorpay integration

### Razorpay Orders API

**Implemented · Tested in Test Mode**

The gateway creates a real Razorpay Test Mode order only after policy authorization.

### Standard Checkout

**Implemented · Tested in Test Mode**

The buyer can launch Razorpay Standard Checkout using the order created by the gateway.

### Server-side checkout verification

**Implemented · Tested**

The gateway verifies the checkout signature rather than trusting browser state.

### Payment retrieval and capture

**Implemented · Tested in Test Mode**

The gateway can retrieve payment state and capture authorized payments when required by the payment lifecycle.

### Test Mode dashboard evidence

**Observed during development**

Test payment activity was visible in the Razorpay Dashboard, providing an external payment-rail artifact alongside MANDATE transaction records.

**Production payment processing is not claimed.**

---

## 7. Webhook safety

### Raw-body signature verification

**Implemented · Tested**

Webhook signatures are verified before event processing.

### Persistent deduplication

**Implemented · Tested**

Webhook identities are claimed in PostgreSQL so duplicate deliveries cannot create another effect.

### In-flight duplicate protection

**Implemented · Tested**

An in-process processing key prevents concurrent duplicate handling while the persistent claim completes.

### Webhook replay lab

**Implemented · Tested**

The judge-facing lab deliberately submits the same synthetic event identity twice and surfaces:

```text
FIRST  = ACCEPTED
SECOND = DUPLICATE
```

Evidence:

```text
apps/buyer/src/app/webhook-lab/
apps/gateway/src/app.ts
```

### Failure recovery / claim release

**Implemented**

If webhook processing fails after a persistent claim, the gateway releases the claim so the event can be retried safely.

---

## 8. Durable evidence

### PostgreSQL transactions

**Implemented · Tested**

Transaction records persist outside process memory.

### PostgreSQL audit events

**Implemented · Tested**

Important intent, policy, payment and order events are persisted as an audit timeline.

### Merchant-order persistence

**Implemented · Tested**

Confirmed merchant orders and incremental revenue attribution survive gateway restart.

### Startup hydration

**Implemented · Tested**

Gateway startup initializes persistence and hydrates the runtime transaction/audit store.

### Persistence proof

**Implemented · Tested**

The judge-facing persistence flow demonstrates state surviving a gateway restart.

Evidence:

```text
apps/gateway/src/persistence.ts
database/init.sql
apps/merchant/src/app/operations/persistence/
```

---

## 9. Judge-facing evidence surfaces

### Golden Path

```text
/golden-path
```

Canonical Track 01 demonstration.

### Live Proof

```text
/live-proof
```

Auto-refreshing transaction/payment proof intended for webhook-driven state changes.

### Unified Proof

```text
/proof
```

One-screen transaction, Razorpay, webhook and merchant-order evidence.

### Policy Boundary Lab

```text
/policy-lab
```

Demonstrates over-limit blocking and recovery.

### Amount Integrity Lab

```text
/tamper-lab
```

Demonstrates resistance to manipulated client totals.

### Webhook Replay Lab

```text
/webhook-lab
```

Demonstrates duplicate-event protection.

### Demo Readiness

```text
/demo
```

Checks integration readiness before presentation.

### Judge Control Room

```text
/labs
```

Central launcher for the evidence suite.

---

## 10. Reliability / developer experience

### Docker Compose

**Implemented · Tested**

One stack contains:

```text
buyer
merchant
gateway
postgres
```

### Healthchecks

**Implemented · Tested**

Each service exposes a health signal used by Compose/runtime readiness checks.

### CI

**Implemented · Tested**

GitHub Actions validates:

```text
install
→ typecheck
→ unit tests
→ build
```

### Strict TypeScript

**Implemented · Tested**

The repository keeps strict type checking enabled rather than disabling checks to silence failures.

---

## 11. Security boundaries

### AI / payment separation

**Implemented**

The model cannot directly call Razorpay or authorize a transaction.

### Client / gateway separation

**Implemented**

The frontend cannot mark an order paid or provide the trusted payment amount.

### Internal merchant authorization

**Implemented**

Gateway-to-merchant order confirmation uses an internal gateway secret.

### Server-side secrets

**Implemented**

Razorpay API secrets, webhook secrets, internal gateway secret and model API credentials are kept server-side.

---

## 12. Deliberate boundaries

The submission intentionally does **not** claim:

```text
production payment processing
production-grade distributed catalog storage
unrestricted autonomous spending
real-world webhook connectivity without external setup
synthetic lab events = live Razorpay events
```

Those limits make the evidence set more credible: the repository distinguishes what is implemented, what has been exercised, and what requires external infrastructure.

---

## Final capability statement

MANDATE combines the two sides of Track 01 into one system:

```text
AGENTIC BUYING
AI intent → discovery → ranking → recommendation → approval

MERCHANT GROWTH
recommendation → basket expansion → confirmed order → realized uplift

SAFE PAYMENT
quote → deterministic policy → Razorpay → verification → webhook

PROOF
PostgreSQL → audit → replay protection → durable evidence
```

The result is not merely an AI shopping interface and not merely a payment wrapper. It is a **control plane for agentic commerce** with a deterministic financial boundary.
