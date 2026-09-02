# Trust Boundary

## Zones

1. AI / probabilistic zone
2. MANDATE trusted control plane
3. Razorpay payment rail

## AI Zone

Allowed:

- Interpret user shopping request.
- Read merchant discovery metadata.
- Read agent-readable catalog.
- Compare products.
- Propose a `PurchaseIntent`.

Forbidden:

- Change spending limit.
- Create Razorpay Orders.
- Capture payments.
- Mark orders as paid.
- Call Razorpay MCP directly for money-affecting actions.

## Trusted Control Plane

Responsible for:

- Policy enforcement.
- Transaction state machine.
- Razorpay REST calls.
- Checkout verification.
- Webhook verification.
- Idempotency.
- Audit trail.

## Razorpay Rail

Responsible for:

- Test Mode Orders.
- Checkout.
- Payment authorization/capture state.
- Webhook event delivery.

## Sources

- https://razorpay.com/docs/build/llm-docs/api/orders/create.md
- https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard/integration-steps.md
- https://razorpay.com/docs/build/llm-docs/webhooks/validate-test.md
- https://razorpay.com/docs/build/llm-docs/mcp-server.md
