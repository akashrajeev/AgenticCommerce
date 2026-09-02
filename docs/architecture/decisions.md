# Architecture Decisions

## Decision 1

DECISION:
Use Razorpay REST APIs for trusted transaction execution.

REASON:
Razorpay's documented Standard Checkout path expects server-side Order creation, server-side signature verification, and webhook reconciliation. A backend-owned REST integration keeps credentials, policy, transaction state, and audit in one deterministic authority.

ALTERNATIVES:
Let the AI use Razorpay MCP directly; use frontend-only Checkout state.

DATE:
2026-09-02

SOURCE:
https://razorpay.com/docs/build/llm-docs/api/orders/create.md
https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard/integration-steps.md

## Decision 2

DECISION:
AI cannot directly access Razorpay.

REASON:
The AI is probabilistic and may propose actions, but payment authority must be deterministic, bounded, and auditable. Direct AI access to Razorpay MCP or REST would bypass spending limits and merchant restrictions.

ALTERNATIVES:
Grant the AI a Razorpay MCP connection with write tools.

DATE:
2026-09-02

SOURCE:
https://razorpay.com/docs/build/llm-docs/mcp-server.md
https://github.com/razorpay/razorpay-mcp-server

## Decision 3

DECISION:
Policy engine is deterministic and server-side.

REASON:
Hackathon bar requires every money action to be explainable, bounded, and gated. Deterministic policy can produce stable authorization/block reasons before external side effects occur.

ALTERNATIVES:
Ask the LLM whether a transaction is safe.

DATE:
2026-09-02

SOURCE:
docs/CONTEXT.md

## Decision 4

DECISION:
Webhooks are required for payment reconciliation.

REASON:
Razorpay documents webhooks as server-to-server near real-time notifications. They handle asynchronous events, failures, and late authorization scenarios. User-facing flows may also perform API verification, but webhooks remain the reconciliation backbone.

ALTERNATIVES:
Trust only the frontend Checkout success callback; poll only.

DATE:
2026-09-02

SOURCE:
https://razorpay.com/docs/build/llm-docs/webhooks.md
https://razorpay.com/docs/build/llm-docs/webhooks/validate-test.md

## Decision 5

DECISION:
Transaction state is server controlled.

REASON:
Frontend and AI outputs are not payment proof. Razorpay payment/order state must be verified server-side before merchant orders are confirmed.

ALTERNATIVES:
Let buyer frontend mark an order paid after Checkout success.

DATE:
2026-09-02

SOURCE:
https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard/integration-steps.md

## Decision 6

DECISION:
Razorpay MCP is not used in the production payment path.

REASON:
Official MCP exposes payment operations to AI tools, including Orders, Payments, Payment Links, and Refunds. That is useful for developer productivity, but unrestricted AI use conflicts with MANDATE's trust boundary.

ALTERNATIVES:
Let AI create orders or capture payments through MCP.

DATE:
2026-09-02

SOURCE:
https://razorpay.com/docs/build/llm-docs/mcp-server.md
https://razorpay.com/docs/build/llm-docs/mcp-server/integrations.md
https://github.com/razorpay/razorpay-mcp-server
