# MANDATE — Verification & Evidence

This document separates three things that are easy to confuse in an agentic-commerce submission:

1. **Repository validation** — automated checks that run on every push.
2. **Development verification** — flows exercised against the local Docker stack and Test Mode integrations during development.
3. **Production boundary** — capabilities that intentionally require external credentials or infrastructure and are not represented as guaranteed by source inspection alone.

The goal is to make every claim in the README traceable and honest.

---

## 1. Automated CI gate

The repository's GitHub Actions workflow validates the core build pipeline:

```text
npm ci
   ↓
shared package builds
   ↓
typecheck
   ↓
gateway / merchant / buyer type validation
   ↓
unit tests
   ↓
production builds
```

The workflow is treated as a merge-quality signal for the repository. Recent successful runs have completed all three validation stages:

```text
TYPECHECK   ✓
UNIT TESTS  ✓
BUILD       ✓
```

The README badge links directly to the live GitHub Actions workflow so a reviewer can inspect the current status rather than relying on a static claim.

---

## 2. Development verification matrix

| Capability | Verification evidence | Result / interpretation |
|---|---|---|
| Docker Compose stack | Buyer, merchant, gateway and PostgreSQL run together | Verified during development |
| Gateway health | `/health` endpoint + Compose healthcheck | Verified |
| Merchant agent contract | Manifest/catalog/product/inventory/checkout endpoints exercised by buyer flow | Verified |
| AI purchase planning | Natural-language request → structured plan with valid product IDs | Verified during development |
| Merchant recommendation | Merchant-owned upsell/cross-sell opportunity exposed to buyer | Verified |
| Explicit basket approval | Recommended lines remain outside transaction until user approval | Verified |
| Fresh checkout quote | Combined basket returns a merchant-generated quote | Verified |
| Hard spending policy | Over-limit basket becomes `policy_blocked` before Razorpay order creation | Verified |
| Quantity policy | Gateway validates line and basket quantities | Implemented and covered by policy tests |
| Inventory revalidation | Gateway re-reads current merchant inventory | Implemented and covered by policy tests |
| Merchant identity check | Quote merchant must match purchase intent | Implemented and covered by policy tests |
| Quote expiry | Expired quote is rejected | Implemented and covered by policy tests |
| Amount integrity | Current merchant prices/line totals are compared before authorization | Verified through tamper lab / policy code |
| Razorpay Test Mode order | Gateway creates real Test Mode Orders only after policy authorization | Exercised during development |
| Razorpay Standard Checkout | Browser launches Standard Checkout using the gateway-provided public key/order | Exercised during development |
| Payment verification | Checkout callback is verified server-side against gateway/Razorpay data | Implemented and exercised |
| Payment capture/reconciliation | Authorized/captured payment state is reconciled by gateway | Implemented and exercised |
| Webhook signature verification | Raw webhook body is verified before processing | Implemented |
| Webhook idempotency | Persistent dedupe key prevents duplicate effect | Verified by webhook replay lab |
| Webhook replay lab | Same synthetic event identity delivered twice | First accepted, second duplicate |
| Payment retry | Failed attempt stays intact; retry creates a new transaction | Implemented and exercised |
| Late failure protection | Successful terminal states do not regress on a late failure event | Covered by adversarial tests |
| State machine | Invalid transaction transitions are rejected | Covered by adversarial tests |
| PostgreSQL persistence | Transactions, audit events, webhooks and merchant order attribution persisted | Verified in persistence flow |
| Restart hydration | Gateway reconstructs runtime state from PostgreSQL on startup | Verified through persistence proof |
| Revenue attribution | Confirmed merchant orders distinguish base vs incremental value | Implemented and exercised |
| Merchant growth console | Potential catalog lift separated from realized confirmed revenue | Verified in merchant UI |
| Unified proof | Transaction + payment + webhook + revenue evidence shown together | Verified |
| Demo readiness | Server-side reachability/configuration checks surfaced in UI | Implemented and exercised |
| Judge control room | `/labs` collects proof surfaces in one place | Verified |

---

## 3. Razorpay Test Mode evidence

MANDATE has been exercised against Razorpay Test Mode during development rather than using a fake payment screen.

The development verification sequence is:

```text
MANDATE buyer
   ↓
MANDATE gateway
   ↓
Razorpay Orders API
   ↓
Razorpay Standard Checkout
   ↓
Test Mode payment
   ↓
Gateway verification / reconciliation
```

Test payment activity was observed in the Razorpay Dashboard during development, providing an external payment-rail artifact in addition to the MANDATE transaction and audit records.

### Important distinction

The dashboard evidence confirms **Test Mode integration behavior**, not production readiness. No production-money claim is made by this repository.

---

## 4. What the judge can inspect without running anything

A reviewer can reconstruct the architecture directly from source:

```text
README.md
   ↓
TRACK-01-COVERAGE.md
   ↓
ARCHITECTURE.md
   ↓
SECURITY-MODEL.md
   ↓
docs/GOLDEN-PATH.md
   ↓
docs/FINAL-DEMO.md
   ↓
docs/VERIFICATION.md
   ↓
implementation files
```

The most important implementation files are:

```text
apps/buyer/src/app/api/agent/purchase-plan/route.ts
apps/buyer/src/app/BuyerWorkspace.tsx
apps/merchant/src/lib/revenue.ts
apps/merchant/src/app/api/agent/recommendations/route.ts
apps/gateway/src/transaction-core.ts
apps/gateway/src/app.ts
apps/gateway/src/razorpay.ts
apps/gateway/src/persistence.ts
database/init.sql
```

---

## 5. Safety evidence

The submission contains judge-facing labs because some security properties are easier to prove visually than by asking a reviewer to infer them from code.

### Policy boundary

```text
Basket > user's hard limit
        ↓
MAX_SPEND = FAIL
        ↓
POLICY_BLOCKED
        ↓
NO RAZORPAY ORDER
```

### Amount tampering

```text
Client says amount = X
        ↓
Gateway ignores client amount
        ↓
Merchant quote + current price become authoritative
        ↓
Integrity check decides
```

### Webhook replay

```text
Event identity A
   ↓
first delivery = ACCEPTED
   ↓
second delivery = DUPLICATE
   ↓
no second transaction effect
```

### Persistence

```text
Transaction / audit / revenue
        ↓
PostgreSQL
        ↓
gateway restart
        ↓
hydration
        ↓
same durable evidence
```

---

## 6. Known boundaries

The following are deliberate boundaries and should not be removed from the documentation merely to make the project sound bigger:

### Real webhook connectivity

A true Razorpay webhook delivery requires a publicly reachable webhook URL or supported tunnel/staging host. Localhost by itself is not a public webhook target.

### Test Mode

The payment integration is configured for Razorpay Test Mode. Production payment processing is outside this submission's verified scope.

### Merchant quote storage

The merchant quote store is intentionally lightweight in the current reference implementation and is not presented as a production-grade distributed catalog/quote database.

### AI provider

The model-backed buyer requires an OpenAI-compatible inference endpoint and corresponding server-side credentials. The gateway remains deterministic regardless of model provider.

### Synthetic safety labs

The replay and tamper labs are controlled demonstrations of the corresponding deterministic mechanisms. They are not represented as real Razorpay event deliveries.

---

## 7. Evidence-first demo recommendation

For the strongest first impression, a reviewer should be shown these surfaces in order:

```text
/labs
   ↓
/golden-path
   ↓
/policy-lab       → prove the hard boundary
   ↓
/tamper-lab      → prove amount integrity
   ↓
/proof           → prove the payment/order/audit chain
   ↓
merchant /growth → prove revenue opportunity + realized uplift
   ↓
/webhook-lab     → prove replay safety
   ↓
persistence      → prove durable state
```

The complete operator script is in [`FINAL-DEMO.md`](./FINAL-DEMO.md).

---

## 8. Claim discipline

When presenting MANDATE, use language that distinguishes implementation from verified external execution:

**Good:**

> "The gateway is designed and tested to reject over-limit transactions before Razorpay order creation."

> "The project has been exercised against Razorpay Test Mode."

> "Webhook replay protection is demonstrated by a persistent dedupe lab."

**Avoid:**

> "This is production-ready payment infrastructure."

> "The model is trusted to make purchases autonomously without controls."

> "Synthetic webhook tests are the same thing as live Razorpay webhook delivery."

The credibility of the submission is part of the technical design: the repository should show what is implemented, what is verified, and what still depends on external infrastructure.
