# MANDATE Context

Future Codex sessions must read this file before modifying architecture or implementing major features. Repository docs are more authoritative than conversation memory.

## Project
MANDATE

## Purpose
Agentic commerce platform for Razorpay Track 01: AI Growth & Agentic Commerce.

## Core Principle
"The AI has intelligence, but it does not have payment authority."

## Current Architecture
AI Buyer -> Merchant Discovery -> Agent-readable Catalog -> Model-backed Product Decision -> PurchaseIntent -> Deterministic Policy Engine -> Transaction Authority -> Razorpay Test Mode -> Server Verification -> Webhooks -> Merchant Order -> Audit Trail

## Trust Zones
1. AI / probabilistic: reads the live merchant contract/catalog and produces a structured product plan. It cannot authorize payment.
2. MANDATE trusted control plane: revalidates product, inventory and quote; enforces deterministic policy; owns transaction state; calls Razorpay; verifies payments/webhooks; confirms merchant orders.
3. Razorpay payment rail: Test Mode Orders, Standard Checkout, Payments, capture and Webhooks.

## Security Invariants
- LLM -> Razorpay = FORBIDDEN.
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

### Infrastructure and validation
- Dockerfiles for merchant, buyer and gateway.
- Docker Compose services for PostgreSQL, merchant, buyer and gateway.
- CI workflow for install, typecheck, unit tests and build.
- Unit tests for deterministic policy behavior and Razorpay signature validation, plus payment recovery/non-regression coverage.
- Environment templates with Test Mode credentials kept out of the frontend.
- Root `.dockerignore` prevents host `node_modules`, build output, secrets and local artifacts from contaminating Docker builds.

## Persistence Boundary
PostgreSQL is now wired as the durable gateway backing store when `DATABASE_URL` is configured. Startup hydration loads transactions and audit events into the gateway runtime cache. Transaction/audit writes are persisted asynchronously; the in-process maps remain the hot read path. Webhook dedupe claims are persisted atomically in PostgreSQL.

The merchant checkout quote store remains in-memory and is intentionally separate from gateway transaction durability.

## Failure Recovery Contract
- A policy block is terminal and creates no Razorpay order.
- A payment failure is terminal for that attempt.
- A retry never mutates the failed attempt into success; it creates a new transaction and re-runs merchant/policy validation.
- Late `payment.failed` observations after captured/verified/confirmed states are audited and ignored rather than regressing state.
- Duplicate webhook deliveries are acknowledged without duplicating state transitions.

## Current Limitations
- Merchant quote persistence is still in-memory.
- MCP is documented/configurable but intentionally not an unrestricted production payment path.
- The Docker/Test Mode path still needs a real local verification by the developer with Test credentials and a public webhook tunnel/staging URL.
- Buyer UI should refresh/poll for webhook-only state changes after Checkout closes.
- Revenue recommendations are deterministic catalog intelligence today; they are not yet connected to a full one-click bundle/upsell transaction flow.

## Important Environment Variables

Gateway:
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `MERCHANT_APP_ORIGIN`
- `MERCHANT_INTERNAL_URL`
- `BUYER_APP_ORIGIN`
- `INTERNAL_GATEWAY_SECRET`
- `DATABASE_URL`

Buyer server:
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`
- `MERCHANT_INTERNAL_URL`

## Current Transaction Flow
USER REQUEST
-> buyer model reads merchant manifest + catalog
-> structured product plan
-> checkout quote
-> PurchaseIntent
-> gateway re-fetches product/inventory/quote
-> policy evaluation
-> BLOCK or AUTHORIZED
-> authorized transaction creates real Razorpay Test Mode Order
-> Standard Checkout
-> Checkout returns payment identifiers
-> gateway verifies signature and retrieves payment
-> authorized payment is captured when required
-> payment captured/verified
-> Razorpay webhook reconciles state
-> merchant order confirmed
-> audit timeline updated

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

## Next Step
1. Verify the latest CI run after the persistence/recovery/revenue changes.
2. Add webhook-driven polling/refresh in the buyer workspace.
3. Surface the revenue recommendations in the merchant command center and buyer transaction workspace.
4. Turn a selected recommendation into a multi-line-item checkout preview while keeping the same deterministic policy gate.
5. Run the final real Razorpay Test Mode allow/block/failure-retry demo with public webhook delivery.
