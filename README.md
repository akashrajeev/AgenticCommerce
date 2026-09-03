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
- `database` — PostgreSQL persistence schema used by the gateway when `DATABASE_URL` is configured.
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
- `GET /api/agent/recommendations?productId=:id&maxSpendPaise=:limit`

The buyer consumes those APIs instead of scraping the storefront.

## Revenue engine

MANDATE also exposes a deterministic merchant-side recommendation engine. It scores eligible upsell and cross-sell candidates using product category fit, shared attributes, rating/review proof, relative price, inventory and an optional spending ceiling. The merchant operations console surfaces these as **agent-assisted opportunities** with an illustrative incremental basket value.

The important boundary is deliberate: the recommendation engine can identify a revenue opportunity, but it cannot create a payment, bypass a policy, or mutate the user's hard spending limit. Any future basket expansion must return to the same merchant quote and gateway policy gate before Razorpay is invoked.

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
