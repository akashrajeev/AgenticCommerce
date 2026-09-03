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

## Trust Zones
1. AI / probabilistic: reads the live merchant contract/catalog and produces a structured product plan. It cannot authorize payment.
2. ACP checkout / merchant zone: owns agent-readable checkout session state and authoritative merchant quote construction. It cannot directly create a Razorpay order.
3. MANDATE trusted control plane: verifies the signed user mandate, binds it to the checkout, revalidates product/inventory/quote, enforces deterministic policy, owns transaction state, creates Razorpay orders, verifies payments/webhooks, and confirms merchant orders.
4. Razorpay payment rail: Test Mode Orders, Standard Checkout, Payments, capture and Webhooks.

## Security Invariants
- LLM -> Razorpay = FORBIDDEN.
- ACP client -> Razorpay = FORBIDDEN.
- Frontend -> PAID = FORBIDDEN.
- Unverified payment -> confirmed order = FORBIDDEN.
- Policy BLOCK -> Razorpay order = FORBIDDEN.
- AI -> spending limit modification = FORBIDDEN.
- Razorpay API secret and webhook secret must remain server-side.
- Checkout signature verification must be performed by the gateway.
- Webhook signature verification uses the raw request body.
- Duplicate webhook events must be idempotently handled.
- Webhook ordering must not be assumed.
- Merchant order confirmation is performed by the trusted gateway using an internal shared secret.
- A signed mandate must bind the exact merchant checkout identifier, cart, amount, currency and expiry.
- A successful mandate nonce cannot be reused for another authorization transaction.
- ACP completion cannot bypass MANDATE authorization.

## Implemented

### Merchant
- Modern ecommerce storefront at `apps/merchant`.
- Structured catalog and realistic seeded products.
- Agent-readable manifest at `/.well-known/agent-commerce`.
- Agent catalog/product/inventory endpoints.
- Deterministic checkout preview and quote generation.
- Quote revalidation endpoint.
- Trusted merchant-order confirmation endpoint.
- Merchant operations console at `/operations`.
- Transaction detail/audit view at `/operations/transactions/:id`.
- Agent-readable revenue recommendation endpoint at `/api/agent/recommendations?productId=:id&maxSpendPaise=:limit`.
- Deterministic upsell/cross-sell scoring based on catalog fit, ratings, tags, inventory and customer budget.
- ACP-shaped checkout session create/retrieve/update/complete/cancel endpoints.
- ACP checkout completion is wired through the MANDATE authorization and Razorpay order bridge.

### Buyer
- Modern transaction workspace UI.
- Model-backed structured purchase planning via `/api/agent/purchase-plan`.
- Buyer planner reads merchant manifest/catalog over HTTP rather than importing merchant source code.
- Model output is constrained with JSON Schema and product IDs are validated against the live catalog.
- Hard spending limit is supplied by the application and is not editable by the model.
- Live checkout totals are used when evaluating budget-constrained product choices.
- Real Razorpay Standard Checkout launcher.
- Visible failed-payment recovery flow that starts a fresh transaction and preserves the original failed attempt.

### Gateway
- Deterministic policy engine with budget, quantity, inventory, merchant, quote-validity and amount-integrity checks.
- Server-side merchant revalidation.
- Strict transaction state machine.
- Transaction/audit timeline.
- Real Razorpay REST adapter.
- Razorpay order creation, payment retrieval, capture and verification.
- Raw-body webhook endpoint.
- Webhook signature validation.
- In-memory plus PostgreSQL-backed transaction/audit persistence boundary.
- PostgreSQL-backed webhook deduplication claims with release-on-processing-failure.
- Late/out-of-order payment failure handling that preserves successful terminal evidence.
- Safe failed-payment retry endpoint: retry re-runs merchant validation and policy and creates a distinct transaction.
- Merchant order reconciliation after payment verification.
- Signed Ed25519 user-mandate verification.
- Deterministic checkout binding and SHA-256 cart hashing.
- User mandate spend, merchant and product constraints.
- Mandate nonce replay protection, including concurrent in-process claims.
- Mandate authorization attached to the transaction record and persisted in PostgreSQL.
- Internal MANDATE authorization endpoint at `/v1/mandates/authorize`.
- Internal mandate-gated Razorpay order endpoint at `/v1/mandates/:authorizationId/razorpay-order`.

### Infrastructure and validation
- Dockerfiles for merchant, buyer and gateway.
- Docker Compose services for PostgreSQL, merchant, buyer and gateway.
- CI workflow for install, typecheck, unit tests and build.
- Unit tests for deterministic policy behavior, Razorpay signature validation, payment recovery/non-regression and mandate binding/replay behavior.
- Environment templates with Test Mode credentials kept out of the frontend.
- Root `.dockerignore` prevents host `node_modules`, build output, secrets and local artifacts from contaminating Docker builds.

## Persistence Boundary
PostgreSQL is the durable gateway backing store when `DATABASE_URL` is configured. Startup hydration loads transactions and audit events into the gateway runtime cache. Transaction/audit writes are persisted asynchronously; the in-process maps remain the hot read path. Webhook dedupe claims are persisted atomically in PostgreSQL.

The transaction row now persists `mandate_authorization` as JSONB. Startup performs an additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration so an existing local PostgreSQL volume can pick up the Phase 4 field without destroying data.

The merchant checkout session and quote stores remain in-memory and are intentionally separate from gateway transaction durability.

## Failure Recovery Contract
- A policy block is terminal and creates no Razorpay order.
- A payment failure is terminal for that attempt.
- A retry never mutates the failed attempt into success; it creates a new transaction and re-runs merchant/policy validation.
- Late `payment.failed` observations after captured/verified/confirmed states are audited and ignored rather than regressing state.
- Duplicate webhook deliveries are acknowledged without duplicating state transitions.
- Missing mandate authorization blocks ACP payment completion.
- A valid mandate with a changed checkout binding is rejected before Razorpay order creation.
- Replaying a successful mandate nonce is rejected.

## ACP / Phase 4 Flow
ACP client
-> merchant `/checkout_sessions`
-> authoritative merchant quote + cart hash
-> signed user mandate supplied to `/checkout_sessions/:id/complete`
-> merchant forwards mandate + exact checkout binding to gateway
-> gateway verifies Ed25519 credential
-> gateway checks mandate expiry, identity, spend, merchant and product constraints
-> gateway fetches merchant quote/product/inventory again
-> deterministic policy evaluation
-> authorization artifact attached to transaction and persisted
-> gateway creates Razorpay Test Mode Order
-> ACP completion returns `ready_for_payment` with the Razorpay order reference
-> existing Standard Checkout / verify-payment / capture / webhook path provides payment evidence
-> merchant order confirmed after payment verification

The ACP completion bridge intentionally returns `ready_for_payment`, not `completed`, at Razorpay order creation time. A payment order existing is not evidence that money was successfully captured.

## Revenue Growth Flow
SOURCE PRODUCT
-> merchant recommendation endpoint
-> deterministic upsell/cross-sell ranking
-> budget-aware recommendation
-> customer approval
-> add recommendation to PurchaseIntent
-> same policy gate
-> same Razorpay authority
-> incremental revenue is auditable

The recommendation layer must never bypass the existing transaction authority. A recommendation is not authorization.

## UI Principle
Both merchant and buyer surfaces must remain modern, restrained and product-like.

Avoid generic AI visuals:
- no purple AI gradients
- no glassmorphism
- no glowing cards
- no giant "AI-powered" hero copy
- no robot illustrations
- no fake model-thinking animations
- no emoji-heavy interface

Prefer:
- typography-led hierarchy
- neutral surfaces
- subtle borders
- compact status indicators
- realistic commerce terminology
- clear transaction identifiers
- useful density

## Current Limitations
- Merchant quote and ACP checkout-session stores are still in-memory.
- Persisted mandate nonce uniqueness is enforced through transaction hydration plus in-process claims; a future horizontally scaled deployment should move nonce claiming to a database-level unique authorization table.
- MCP is documented/configurable but intentionally not an unrestricted production payment path.
- The Docker/Test Mode path still needs a real local verification by the developer with Test credentials and a public webhook tunnel/staging URL.
- Buyer UI should refresh/poll for webhook-only state changes after Checkout closes.
- Revenue recommendations are deterministic catalog intelligence today; they are not yet connected to a full one-click bundle/upsell transaction flow.
- Full ACP wire conformance is not claimed; this repository implements an ACP-shaped adapter around MANDATE's stronger payment boundary.
- AP2 wire interoperability is not claimed.

## Next Step
1. Verify the first green CI run containing the Phase 4 persistence and ACP bridge changes.
2. Add a buyer/merchant demo path that visibly creates an ACP checkout, supplies a signed mandate, receives a Razorpay Test Order, and continues through the existing Standard Checkout flow.
3. Add judge-facing proof for mandate tampering, nonce replay and ACP completion blocking.
4. Run the real Razorpay Test Mode allow/block/failure-retry demonstration with public webhook delivery.
5. Then move to Phase 5: delegated/autonomous bounded buying where the agent can execute inside a pre-authorized mandate without gaining the ability to widen the mandate or bypass the gateway.
