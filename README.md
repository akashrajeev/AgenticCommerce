# MANDATE

MANDATE is an agentic commerce platform for Razorpay Track 01: AI Growth & Agentic Commerce.

> The AI has intelligence, but it does not have payment authority.

The system has three trust zones:

1. **AI buyer** — understands the request, discovers the merchant, reads its machine-readable catalog and proposes a product plan.
2. **MANDATE gateway** — revalidates the product, inventory and quote; applies deterministic spending policy; controls transaction state; performs Razorpay operations; verifies payment; reconciles webhooks; and confirms the merchant order.
3. **Razorpay Test Mode** — executes the real Orders, Standard Checkout and Payments flow using test credentials; no live funds move.

## Repository

- `apps/merchant` — modern ecommerce storefront, agent commerce API and merchant operations console.
- `apps/buyer` — model-backed buyer workspace and real Razorpay Checkout launcher.
- `apps/gateway` — deterministic policy/transaction authority and Razorpay integration.
- `packages/types` — shared commerce contracts.
- `packages/schemas` — request validation schemas.
- `packages/shared` — shared runtime helpers.
- `database` — reserved persistence workspace; PostgreSQL is available in Compose.
- `docs/CONTEXT.md` — persistent project context for future coding sessions.
- `docs/razorpay/` — current Razorpay Test Mode, Checkout, Payments, Webhook and MCP research.

## Real Razorpay flow

MANDATE does not fake the payment layer.

```text
AI request
  -> live merchant manifest/catalog
  -> model-backed product plan
  -> checkout quote
  -> PurchaseIntent
  -> gateway revalidation
  -> deterministic Policy Engine
      -> BLOCK: stop before Razorpay order creation
      -> ALLOW
  -> Razorpay Orders API
  -> Razorpay Standard Checkout
  -> Test Mode payment
  -> server-side signature verification
  -> payment retrieval / capture when required
  -> Razorpay webhook reconciliation
  -> merchant order confirmation
  -> audit timeline
```

The gateway uses Razorpay's REST API with Test Mode credentials. The browser never receives the API secret, and frontend state cannot mark an order paid.

## Agent-ready merchant

The merchant exposes a machine-readable commerce contract:

- `GET /.well-known/agent-commerce`
- `GET /api/agent/catalog`
- `GET /api/agent/products/:id`
- `GET /api/agent/inventory/:id`
- `POST /api/agent/checkout/preview`
- `GET /api/agent/checkout/quotes/:id`

The buyer consumes those APIs instead of scraping the storefront.

## AI buyer

The buyer's model-backed planning endpoint reads the merchant manifest/catalog and returns a structured JSON plan constrained to valid catalog product IDs. The model can recommend and rank; it cannot authorize payment or change the hard spending limit.

The current implementation uses the OpenAI-compatible Responses API. Configure `OPENAI_BASE_URL` and `OPENAI_MODEL` for the provider/model you want to use; the demo has been validated with Groq's OpenAI-compatible Responses endpoint as well as the standard OpenAI endpoint.

## Razorpay Test Mode setup

1. Switch the Razorpay Dashboard to **Test Mode**.
2. Generate Test API keys.
3. Put the Test `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the gateway server environment only.
4. Configure a Test Mode webhook pointing to `/v1/webhooks/razorpay` on a public URL/staging host. For local testing, use a supported tunnel.
5. Set `RAZORPAY_WEBHOOK_SECRET` to the webhook secret configured in the Dashboard.
6. Use official Razorpay Test Mode payment credentials/test cards.

See `docs/razorpay/` for the researched details and source links.

## Razorpay MCP

Razorpay also provides an official MCP Server with a broad tool surface, including order/payment operations. MANDATE deliberately does **not** give the buyer unrestricted MCP financial authority.

The production purchase boundary stays:

```text
AI -> PurchaseIntent -> Policy -> Transaction Authority -> Razorpay
```

MCP is documented for development assistance, read-only inspection and carefully constrained/audited integrations.

Official remote endpoint documented by Razorpay:

`https://mcp.razorpay.com/mcp`

## Local development

Prerequisites:

- Node.js 22+
- npm 10+
- Docker Desktop
- Razorpay Test Mode credentials
- API key for the configured model provider

Create local environment files from the examples, then run:

```bash
npm install
cp .env.example .env
cp apps/merchant/.env.example apps/merchant/.env.local
cp apps/buyer/.env.example apps/buyer/.env.local
cp apps/gateway/.env.example apps/gateway/.env
docker compose up --build
```

Default URLs:

- Merchant: `http://localhost:3000`
- Merchant operations: `http://localhost:3000/operations`
- Buyer: `http://localhost:3001`
- Gateway: `http://localhost:4000`
- Gateway health: `http://localhost:4000/health`

## Demo

### Successful purchase

Use:

> Buy the best ANC headphones under ₹5,000

Set maximum spend to `5000`, run the buyer, and follow:

`model plan -> quote -> policy -> Razorpay Test Order -> Checkout -> verification -> webhook -> merchant confirmation`

### Policy failure

Set maximum spend to `3000` for a product whose verified total exceeds the limit.

The gateway must display a policy block and must not create a Razorpay Order.

### Payment failure

Use a Razorpay Test Mode failure scenario and verify:

`payment.failed -> failed transaction -> no merchant confirmation`

## Environment variables

### Gateway

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `MERCHANT_APP_ORIGIN`
- `MERCHANT_INTERNAL_URL`
- `BUYER_APP_ORIGIN`
- `INTERNAL_GATEWAY_SECRET`

### Buyer server

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`
- `MERCHANT_INTERNAL_URL`

Never use `NEXT_PUBLIC_` for secrets.

## Docker

`docker-compose.yml` contains:

- `postgres`
- `merchant`
- `buyer`
- `gateway`

The public browser URLs stay on `localhost`, while server-to-server calls use Docker service names.

## Validation

```bash
npm run lint
npm run typecheck
npm run build
```

GitHub Actions also runs typecheck and build on pushes/PRs to `main`.

## Current limitation

The transaction, audit, webhook-deduplication and merchant-order repositories are still in-memory. PostgreSQL is provisioned in Compose but is not yet the application source of truth. The real Razorpay Test Mode integration is implemented independently of that persistence limitation.
