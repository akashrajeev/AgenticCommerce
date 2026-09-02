# Razorpay Integration Architecture

## Options Evaluated

### A. MANDATE backend -> Razorpay REST API

Strengths:

- Strong authority boundary.
- Razorpay secrets stay server-side.
- Deterministic policy can block before external side effects.
- Every money action can be audited with transaction ids and state transitions.
- Easier webhook idempotency and reconciliation.
- Lower hackathon risk because Standard Checkout and Orders API are the documented core path.

Weaknesses:

- Requires more backend code.
- Requires careful webhook raw-body handling.

### B. AI -> Razorpay MCP

Strengths:

- Faster experimentation.
- Official MCP tools expose orders, payments, payment links, refunds, and integration helpers.
- Good developer story for agentic payment operations.

Weaknesses:

- Gives probabilistic AI direct access to money-affecting tools.
- Harder to prove policy enforcement.
- Can bypass MANDATE spending limits and merchant restrictions unless every tool is wrapped.
- Audit and state machine become fragmented.
- Credential exposure risk is higher.

## Decision

MANDATE uses Razorpay REST APIs from the gateway for trusted transaction execution. Razorpay MCP is not in the production payment path.

## Required Flow

AI Buyer -> PurchaseIntent -> Policy Engine -> Transaction Authority -> Razorpay Orders API -> Standard Checkout -> Server Signature Verification -> Webhook Reconciliation -> Merchant Order -> Audit Trail

## MCP Coexistence

MCP may coexist as:

- A development-time assistant.
- A read-only operational inspector.
- A gateway-owned tool only when the gateway applies policy first and records an audit entry.

MCP must never become:

- A bypass around spending limits.
- A bypass around transaction authorization.
- A source of payment truth without gateway verification.
- An unrestricted tool granted to the AI buyer.

## Sources

- https://razorpay.com/docs/build/llm-docs/mcp-server.md
- https://github.com/razorpay/razorpay-mcp-server
- https://razorpay.com/docs/build/llm-docs/api/orders/create.md
- https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard/integration-steps.md
- https://razorpay.com/docs/build/llm-docs/webhooks/validate-test.md
