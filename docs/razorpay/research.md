# Razorpay Research

Research date: 2026-09-02

Primary source set:

- Razorpay LLM docs index, last updated 2026-04-30: https://razorpay.com/docs/llms.txt
- Razorpay API docs: https://razorpay.com/docs/build/llm-docs/api.md
- Razorpay MCP docs: https://razorpay.com/docs/build/llm-docs/mcp-server.md
- Official Razorpay MCP GitHub repository: https://github.com/razorpay/razorpay-mcp-server

## Summary

Razorpay's current documented integration shape matches MANDATE's intended trust boundary:

1. Server creates an Order.
2. Browser opens Standard Checkout with the server-created `order_id`.
3. Checkout returns payment identifiers and signature.
4. Server verifies signature and reconciles payment state.
5. Webhooks provide asynchronous server-to-server confirmation and failure recovery.

Razorpay MCP is powerful and official, but it exposes operational payment tools to AI clients. For MANDATE it is useful as a developer accelerator and optional constrained inspection surface, not as the production payment path.

## Official Findings

- Test Mode is a sandbox where no real money is used.
- Test and Live environments have separate keys and separate entities.
- API authentication is Basic Auth using `key_id:key_secret`.
- Orders API is required before Checkout.
- Payment APIs fetch payment details and capture authorized payments; they do not collect payments.
- Standard Checkout must receive the server-created `order_id`.
- Checkout signature verification is mandatory server-side.
- Webhook signature validation must use raw body and `X-Razorpay-Signature`.
- Webhook events can duplicate and arrive out of order.

## Sources

- https://razorpay.com/docs/build/llm-docs/payments/dashboard/test-live-modes.md
- https://razorpay.com/docs/build/llm-docs/api/authentication.md
- https://razorpay.com/docs/build/llm-docs/api/orders/create.md
- https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard/integration-steps.md
- https://razorpay.com/docs/build/llm-docs/api/payments.md
- https://razorpay.com/docs/build/llm-docs/webhooks/validate-test.md
- https://razorpay.com/docs/build/llm-docs/mcp-server.md
