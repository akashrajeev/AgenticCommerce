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

## Razorpay Findings

Razorpay REST APIs use JSON and Basic Authentication against the v1 API base. Test Mode is separate from Live and does not move real money. Orders are created server-side before Standard Checkout; the order ID is passed to Checkout. Checkout returns payment identifiers and a signature that the server verifies. Webhooks are server-to-server notifications and require signature validation and fast 2xx handling.

Current relevant implementation:

- `POST /v1/orders` via `apps/gateway/src/razorpay.ts`.
- `GET /v1/orders/:id`.
- `GET /v1/orders/:id/payments`.
- `GET /v1/payments/:id`.
- `POST /v1/payments/:id/capture`.
- Checkout signature verification with HMAC SHA256 over `order_id|razorpay_payment_id`.
- Webhook signature verification using `X-Razorpay-Signature` and the raw body.
- Test Mode public Key ID is returned only to the checkout client; the secret stays in the gateway.

Official sources are retained in `docs/razorpay/`.

## MCP Findings

- Official Remote MCP endpoint: `https://mcp.razorpay.com/mcp`.
- Official local Docker image: `razorpay/mcp`.
- The current official MCP server exposes 35+ tools across payments, orders, payment links, refunds, QR codes, settlements, payouts, saved tokens and Standard Checkout helpers.
- MCP includes money-affecting operations. Therefore direct AI -> Razorpay MCP payment execution is forbidden for MANDATE.
- MCP can be used for development assistance, read-only inspection, or a constrained audited demo path behind the same policy/transaction authority.

See `docs/razorpay/mcp.md` for the research and sources.

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

### Buyer

- Modern transaction workspace UI.
- Model-backed structured purchase planning via `/api/agent/purchase-plan`.
- The buyer planner reads the merchant manifest/catalog over HTTP rather than importing merchant source code.
- Model output is constrained with JSON Schema and product IDs are validated against the live catalog.
- Hard spending limit is supplied by the application and is not editable by the model.
- Real Razorpay Standard Checkout launcher.

### Gateway

- Deterministic policy engine.
- Server-side merchant revalidation.
- Strict transaction state machine.
- Transaction/audit timeline.
- Real Razorpay REST adapter.
- Razorpay order creation, payment retrieval, capture and verification.
- Raw-body webhook endpoint.
- Webhook signature validation.
- Basic idempotency protection for duplicate webhook deliveries.
- Merchant order reconciliation after payment verification.

### Infrastructure

- Dockerfiles for merchant, buyer and gateway.
- Docker Compose services for PostgreSQL, merchant, buyer and gateway.
- CI workflow for npm install/typecheck/build.
- Environment templates with Test Mode credentials kept out of the frontend.

## Current Limitations

- Transaction, audit, webhook-deduplication and merchant-order storage are currently in-memory maps rather than PostgreSQL-backed persistence. PostgreSQL is present in Compose but not yet the source of truth.
- The checkout quote store is currently in-memory inside the merchant app.
- The current buyer model integration uses direct Responses API HTTP calls with `OPENAI_API_KEY`; the official OpenAI SDK is not required.
- MCP is documented/configurable but intentionally not an unrestricted production payment path.
- Webhook persistence/idempotency should move from process memory to PostgreSQL before production use.
- The Docker/Test Mode path still needs a real local verification by the developer with Test credentials and a public webhook tunnel/staging URL.

## Important Environment Variables

Gateway:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `MERCHANT_APP_ORIGIN`
- `MERCHANT_INTERNAL_URL`
- `BUYER_APP_ORIGIN`
- `INTERNAL_GATEWAY_SECRET`

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

## Known Risks

- Current state is in-memory and will reset on process restart.
- Webhook handlers can be duplicated and out of order; production persistence must replace in-memory dedupe.
- Webhook endpoints need a public URL for external Razorpay delivery; localhost requires a supported tunnel/staging host.
- Test and Live credentials must never be mixed.
- Authorized payments must be captured according to the merchant's capture configuration.
- OpenAI model availability/cost can change; keep the model configurable.

## Next Step

1. Replace the in-memory transaction/audit/webhook/order/quote stores with persistent PostgreSQL repositories while preserving the current public APIs and state machine.
2. Add automated unit/integration tests for policy invariants, transaction transitions, signature verification and webhook idempotency.
3. Perform a real Razorpay Test Mode run with developer-provided Test Mode credentials and webhook configuration.
4. Add the final Transaction Command Center and failure simulator after the persistent core is stable.
