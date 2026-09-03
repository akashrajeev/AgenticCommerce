# MANDATE Context

Future Codex sessions must read this file before modifying architecture or implementing major features. Repository docs are more authoritative than conversation memory.

## Project
MANDATE

## Purpose
Agentic commerce platform for Razorpay Track 01: AI Growth & Agentic Commerce.

## Core Principle
"The AI has intelligence, but it does not have payment authority."

## Current Architecture
AI Buyer -> Merchant Discovery -> Agent-readable Catalog -> Model-backed Product Decision -> ACP Checkout Session -> Signed MANDATE Authorization -> Deterministic Policy Engine -> Transaction Authority -> Razorpay Test Mode -> Server Verification -> Webhooks -> Merchant Order -> Audit Trail

For delegated/autonomous buying:

User -> Delegated Mandate -> Buyer Agent -> Merchant Quote -> MANDATE Boundary -> Transaction Authority -> Razorpay

## Trust Zones
1. AI / probabilistic: reads merchant data and proposes/ranks purchases. It cannot authorize payment or expand authority.
2. ACP checkout / merchant zone: owns agent-readable checkout sessions and authoritative merchant quote construction. It cannot directly create Razorpay orders.
3. MANDATE trusted control plane: verifies mandates, binds checkout state, revalidates product/inventory/quote, enforces deterministic policy, owns transaction state, creates Razorpay orders, verifies payments/webhooks and confirms merchant orders.
4. Razorpay payment rail: Test Mode Orders, Standard Checkout, Payments, capture and Webhooks.

## Security Invariants
- LLM -> Razorpay = FORBIDDEN.
- ACP client -> Razorpay = FORBIDDEN.
- Frontend -> PAID = FORBIDDEN.
- Unverified payment -> confirmed order = FORBIDDEN.
- Policy BLOCK -> Razorpay order = FORBIDDEN.
- AI -> spending limit modification = FORBIDDEN.
- Razorpay API secret and webhook secret remain server-side.
- Checkout signature verification is performed by the gateway.
- Webhook signatures use the raw request body.
- Duplicate webhook events are idempotently handled.
- Webhook ordering is not assumed.
- Merchant order confirmation is performed by the trusted gateway.
- A signed mandate binds the exact merchant checkout identifier, cart, amount, currency and expiry.
- A successful mandate nonce cannot authorize a different checkout.
- ACP completion cannot bypass MANDATE authorization.
- A delegated agent cannot change its own mandate limits, merchants, products or expiry.
- Delegated spending is reserved before execution and counted as spent only after authoritative confirmation.

## Implemented

### Merchant
- Modern ecommerce storefront at `apps/merchant`.
- Structured catalog and seeded products.
- Agent-readable manifest at `/.well-known/agent-commerce`.
- Agent catalog/product/inventory endpoints.
- Deterministic checkout preview and quote generation.
- Quote revalidation endpoint.
- Trusted merchant-order confirmation endpoint.
- Merchant operations console at `/operations`.
- Transaction detail/audit view at `/operations/transactions/:id`.
- Agent-readable deterministic revenue recommendations.
- ACP-shaped checkout session create/retrieve/update/complete/cancel endpoints.
- ACP completion forwards signed mandate authorization to the gateway and returns a Razorpay Test Mode order reference as `ready_for_payment` rather than falsely claiming payment success.

### Buyer
- Modern transaction workspace UI.
- Model-backed structured purchase planning.
- Buyer planner reads merchant manifest/catalog over HTTP.
- Model output constrained with JSON Schema and live-product validation.
- Hard spending limit supplied by application, not the model.
- Live Razorpay Standard Checkout launcher.
- Failed-payment recovery flow creates a fresh transaction.
- New delegated-authority workspace at `/delegated-mandates` with mandate creation, budget view, autonomous execution, allow/block feedback and revocation.

### Gateway
- Deterministic policy engine with budget, quantity, inventory, merchant, quote-validity and amount-integrity checks.
- Server-side merchant revalidation.
- Strict transaction state machine.
- Transaction/audit timeline.
- Real Razorpay REST adapter.
- Razorpay order creation, payment retrieval, capture and verification.
- Raw-body webhook endpoint with signature validation and PostgreSQL dedupe.
- Late/out-of-order payment failure handling.
- Safe failed-payment retry endpoint.
- Merchant order reconciliation after payment verification.
- Signed Ed25519 user-mandate verification.
- SHA-256 canonical checkout/cart binding.
- Mandate nonce replay protection.
- Mandate authorization attached to and persisted with transactions.
- Internal MANDATE authorization endpoint at `/v1/mandates/authorize`.
- Internal mandate-gated Razorpay order endpoint at `/v1/mandates/:authorizationId/razorpay-order`.
- Reusable delegated mandate model with per-purchase and total budget limits.
- Merchant/product allow-lists, expiry and revocation.
- Atomic PostgreSQL budget reservation and delegated execution ledger.
- Delegated execution API at `/v1/delegated-mandates/:mandateId/execute`.
- Delegated mandate inspection/revocation APIs.
- Settlement boundary for delegated executions.

### Shared contracts
- `packages/types` contains normalized commerce, mandate, authorization and delegated execution types.
- `packages/schemas` contains corresponding Zod validation schemas.

### Infrastructure and validation
- Dockerfiles for merchant, buyer and gateway.
- Docker Compose services for PostgreSQL, merchant, buyer and gateway.
- CI workflow: install, typecheck, unit tests and build.
- Unit tests cover deterministic policy behavior, Razorpay signature validation, payment recovery, mandate binding/replay, delegated budget/revocation boundaries.

## Persistence Boundary
PostgreSQL is the durable gateway backing store when `DATABASE_URL` is configured. Gateway startup hydrates transactions, audit events and delegated mandates/executions into runtime maps.

Persistent gateway state includes:

```text
transactions
  + mandate_authorization JSONB

audit_events
webhook_events
merchant_orders
delegated_mandates
delegated_mandate_executions
```

Delegated budget reservations use an atomic SQL update so multiple gateway instances cannot reserve more than the remaining total budget.

Merchant quote and ACP checkout-session stores remain in-memory and separate from gateway durability.

## Failure Recovery Contract
- Policy block is terminal and creates no Razorpay order.
- Payment failure is terminal for that attempt.
- Payment retry creates a new transaction and re-runs merchant/policy validation.
- Late failed-payment observations after successful evidence do not regress state.
- Duplicate webhook deliveries do not duplicate state transitions.
- Changed ACP checkout bindings invalidate authorization.
- Replayed signed mandate nonces are rejected for different checkouts.
- Delegated executions that fail before payment-order creation release their budget reservation.
- Delegated payment attempts remain `reserved` until the underlying transaction reaches `order_confirmed` or `payment_failed`/`cancelled`, at which point the reservation is settled.

## ACP / Phase 4 Flow
ACP client
-> merchant `/checkout_sessions`
-> authoritative merchant quote + cart hash
-> signed user mandate
-> merchant mandate bridge
-> gateway Ed25519 verification
-> mandate expiry/identity/spend/merchant/product checks
-> fresh merchant quote/product/inventory
-> deterministic policy
-> transaction mandate authorization
-> Razorpay Test Mode order
-> ACP returns `ready_for_payment`
-> Standard Checkout / verify-payment / capture / webhook
-> payment verified
-> merchant order confirmed

## Phase 5 Delegated / Autonomous Flow
User issues a reusable delegated mandate:

```text
purpose
agent
merchant allow-list
product allow-list
max spend per purchase
total budget
expiry
constraints
```

The buyer agent then executes qualifying purchases without a new approval prompt:

```text
agent request
-> live merchant quote
-> canonical cart hash validation
-> delegated mandate boundary
-> atomic budget reservation
-> MANDATE transaction authorization
-> Razorpay Test Mode order
```

Budget accounting is:

```text
remaining = totalBudget - spent - reserved
```

A purchase outside any hard boundary is blocked before authorization/order creation.

Buyer demo page:

```text
http://localhost:3001/delegated-mandates
```

Judge-facing sequence:

```text
Issue mandate: ₹10,000 total / ₹5,000 per purchase / hp-001 only
        ↓
Run 1 × approved product
        ↓
ALLOWED + reservation
        ↓
Run 2 × approved product
        ↓
BLOCKED: per-purchase limit
        ↓
Revoke mandate
        ↓
Further execution BLOCKED
```

## Current Limitations
- Merchant quote and ACP checkout-session persistence is still in-memory.
- Delegated mandate creation/revocation is currently a demo-facing trusted control endpoint; a production deployment needs authenticated user/session identity and stronger multi-tenant authorization.
- Persistent mandate nonce uniqueness for cryptographic Phase 4 authorizations remains transaction-backed but a horizontally scaled production implementation should use a dedicated database uniqueness boundary.
- The Docker/Test Mode path still needs real local verification with developer-supplied Test credentials and public webhook delivery.
- Buyer UI should refresh/poll after webhook-only payment state changes.
- Revenue recommendations remain deterministic catalog intelligence rather than a complete campaign orchestrator.
- Full ACP wire conformance is not claimed.
- AP2 wire interoperability is not claimed.

## Next Step
Phase 6: buyer-agent ↔ merchant-agent negotiation using the existing protocol-neutral offer model, while keeping every accepted offer inside the same MANDATE policy and payment authority.
