# MANDATE Context

Future Codex sessions must read this file before modifying architecture or implementing major features. Repository docs are more authoritative than conversation memory.

## Project

MANDATE

## Purpose

Agentic commerce platform for Razorpay Track 01: AI Growth & Agentic Commerce.

## Core Principle

"The AI has intelligence, but it does not have payment authority."

## Current Architecture

AI Buyer -> Merchant Discovery -> Agent-readable Catalog -> Product Decision -> PurchaseIntent -> Policy Engine -> Transaction Authority -> Razorpay -> Verification -> Webhooks -> Merchant Order -> Audit Trail

## Trust Zones

1. AI / probabilistic: may read catalogs, compare options, and propose a `PurchaseIntent`.
2. MANDATE trusted control plane: deterministic policy, transaction state, Razorpay calls, verification, and audit.
3. Razorpay payment rail: Test Mode Orders, Checkout, Payments, and Webhooks.

## Security Invariants

- LLM -> Razorpay = FORBIDDEN.
- Frontend -> PAID = FORBIDDEN.
- Unverified payment -> confirmed order = FORBIDDEN.
- Policy BLOCK -> Razorpay order = FORBIDDEN.
- AI -> spending limit modification = FORBIDDEN.
- Razorpay API key secret must remain server-side only.
- Webhook signature verification must use the raw request body.
- Duplicate webhook events must be idempotently ignored by event id.
- Webhook event ordering must not be assumed.

## Current Razorpay Findings

- Razorpay REST APIs are JSON APIs. Most API calls use `https://api.razorpay.com/v1`.
- Razorpay APIs use Basic Authentication with `key_id:key_secret`.
- Test Mode is a sandbox replica. No real money is used, and test entities do not appear in Live Mode.
- Test and Live keys are separate. Test keys must be generated in Test Mode and Live keys in Live Mode.
- Orders must be created server-side before Checkout. The `order_id` ties Checkout to a server-created amount and reduces tampering.
- Order states confirmed: `created`, `attempted`, `paid`.
- Payment states confirmed: `created`, `authorized`, `captured`, `refunded`, `failed`.
- Payment APIs fetch payment details and capture authorized payments; they are not used to collect payments.
- Checkout success returns `razorpay_payment_id`, `razorpay_order_id`, and `razorpay_signature`; the server must verify the signature.
- Webhooks are server-to-server notifications, separate from Checkout `callback_url`.
- Webhook endpoints must return 2xx within 5 seconds or Razorpay retries using exponential backoff for up to 24 hours before disabling the webhook.

Sources:

- https://razorpay.com/docs/build/llm-docs/api.md
- https://razorpay.com/docs/build/llm-docs/api/authentication.md
- https://razorpay.com/docs/build/llm-docs/payments/dashboard/test-live-modes.md
- https://razorpay.com/docs/build/llm-docs/payments/dashboard/account-settings/api-keys.md
- https://razorpay.com/docs/build/llm-docs/payments/orders.md
- https://razorpay.com/docs/build/llm-docs/payments/payments.md
- https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard/integration-steps.md
- https://razorpay.com/docs/build/llm-docs/webhooks.md
- https://razorpay.com/docs/build/llm-docs/webhooks/validate-test.md

## Current Razorpay Capabilities

- Create Orders: `POST /v1/orders`.
- Fetch Orders: `GET /v1/orders/:id`.
- Fetch payments for an order: `GET /v1/orders/:id/payments`.
- Fetch Payments: `GET /v1/payments/:id`.
- Capture Payments: `POST /v1/payments/:id/capture`.
- Standard Checkout accepts a server-created `order_id`.
- Checkout signature verification uses `hmac_sha256(order_id + "|" + razorpay_payment_id, key_secret)`.
- Webhook signature verification uses `X-Razorpay-Signature` and HMAC SHA256 over the raw webhook body with `RAZORPAY_WEBHOOK_SECRET`.
- Test Mode card payments can be tested with official test cards and the mock bank success/failure page.

## Current MCP Findings

- Razorpay has an official MCP Server for AI tools.
- Official remote endpoint: `https://mcp.razorpay.com/mcp`.
- Official GitHub repository: https://github.com/razorpay/razorpay-mcp-server.
- Remote MCP can be configured with a Basic merchant token derived from API key and secret, or via OAuth where supported.
- Local MCP can run via Docker image `razorpay/mcp` with `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
- MCP tool areas include Payments, Orders, Payment Links, Refunds, QR Codes, Settlements, Payouts, saved tokens, and Standard Checkout integration helpers.
- MCP includes money-affecting tools such as `create_order`, `capture_payment`, `create_payment_link`, and local-only write tools such as `create_refund`.
- For MANDATE, MCP must not be in the production payment path because it can give an AI tool direct financial capability. MCP is allowed for developer assistance, read-only inspection, and optional demos only when routed through the same policy/audit boundary.

Sources:

- https://razorpay.com/docs/build/llm-docs/mcp-server.md
- https://razorpay.com/docs/build/llm-docs/mcp-server/integrations.md
- https://razorpay.com/docs/build/llm-docs/mcp-server/configuration.md
- https://razorpay.com/docs/build/llm-docs/mcp-server/oauth.md
- https://github.com/razorpay/razorpay-mcp-server

## Implemented

- Monorepo scaffold with npm workspaces.
- `apps/merchant`: Next.js app with landing surface and `/api/health`.
- `apps/buyer`: Next.js app with landing surface and `/api/health`.
- `apps/gateway`: Express service with `/health`.
- Shared `types`, `schemas`, and `shared` packages.
- TypeScript, ESLint, Prettier, Docker Compose PostgreSQL skeleton.
- Environment templates for apps and gateway.
- Persistent Razorpay and architecture research docs.

## Not Implemented

- Prisma transaction/audit schema beyond empty starter file.
- Merchant discovery API.
- Agent-readable catalog API.
- AI buyer orchestration.
- PurchaseIntent API.
- Deterministic policy engine.
- Razorpay Orders API integration.
- Razorpay Standard Checkout frontend.
- Checkout signature verification endpoint.
- Webhook raw-body endpoint and idempotency store.
- Merchant order management.
- Dockerfiles for all apps.

## Decisions

- Use Razorpay REST APIs from the gateway for trusted transaction execution.
- Do not give the LLM direct Razorpay authority.
- Keep the policy engine deterministic and server-side.
- Treat webhooks as required reconciliation, not optional notifications.
- Keep transaction state server-controlled.
- Use Razorpay MCP for development assistance or constrained inspection, not as a production payment bypass.

## Known Risks

- Webhooks can be duplicated and delivered out of order.
- Webhook endpoints must be public and on ports 80/443; localhost requires a supported tunnel or staging host.
- Webhook handlers must respond within 5 seconds.
- Test and Live keys can be mixed accidentally; Checkout and Orders must use matching mode keys.
- Authorized payments auto-refund if not captured within Razorpay's documented capture window.
- Current Next.js dependency tree has an npm audit warning via PostCSS; npm's automatic fix requires a breaking Next 16 upgrade.

## Next Step

Implement the deterministic gateway foundation: Prisma models for `PurchaseIntent`, `Transaction`, `TransactionEvent`, `WebhookEvent`, and `MerchantOrder`; transaction state machine; policy engine that authorizes or blocks intents before any Razorpay order can be created.
