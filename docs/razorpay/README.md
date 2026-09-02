# Razorpay Implementation Contract

This is MANDATE's implementation contract for Razorpay. Do not implement Razorpay functionality without checking this file and the detailed docs in this directory.

## Required Environment Variables

- `RAZORPAY_KEY_ID`: Test Mode key id for development.
- `RAZORPAY_KEY_SECRET`: Test Mode key secret. Server-side only.
- `RAZORPAY_WEBHOOK_SECRET`: Secret configured for the Razorpay webhook endpoint. Server-side only.

## Required REST APIs

- `POST https://api.razorpay.com/v1/orders`: create an order after policy authorization.
- `GET https://api.razorpay.com/v1/orders/:id`: reconcile order state.
- `GET https://api.razorpay.com/v1/orders/:id/payments`: inspect attempts for one order.
- `GET https://api.razorpay.com/v1/payments/:id`: verify payment status.
- `POST https://api.razorpay.com/v1/payments/:id/capture`: capture only an authorized payment, if manual capture is used.

## Required Checkout Behavior

- Gateway creates the Razorpay Order server-side.
- Buyer frontend receives only safe Checkout options: public key id, Razorpay order id, amount, currency, merchant display fields, and gateway transaction id.
- Checkout response must be sent to the gateway.
- Gateway verifies `razorpay_signature` before any order is confirmed.

## Required Webhook Events

Subscribe in Test Mode at minimum:

- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `order.paid`

## Required Verification

- Checkout signature: `hmac_sha256(order_id + "|" + razorpay_payment_id, RAZORPAY_KEY_SECRET)`.
- Use the server-stored Razorpay order id, not blindly the order id returned by Checkout.
- Webhook signature: validate `X-Razorpay-Signature` using HMAC SHA256 over the raw request body and `RAZORPAY_WEBHOOK_SECRET`.
- Store and skip duplicate webhook events using `x-razorpay-event-id`.
- Do not assume webhook order.

## Required State Transitions

MANDATE transaction states must be server-controlled:

1. `intent_proposed`
2. `policy_authorized` or `policy_blocked`
3. `razorpay_order_created`
4. `checkout_started`
5. `payment_authorized`
6. `payment_captured` or `payment_failed`
7. `payment_verified`
8. `merchant_order_confirmed`

Blocked or failed transitions must be written to audit.

## Required Security Controls

- The LLM must never call Razorpay directly.
- The frontend must never set a transaction or merchant order to paid.
- A blocked policy decision must never create a Razorpay Order.
- A payment must never confirm a merchant order until server-side signature and/or API verification succeeds.
- Razorpay secrets must never be sent to browser apps or committed.
- Payment amounts must be in smallest currency subunits.

## Required Dashboard Configuration

- Use Test Mode during development.
- Generate separate Test Mode API keys.
- Configure a Test Mode webhook endpoint.
- Use a public HTTPS webhook URL when receiving Razorpay webhooks. Localhost is not accepted directly.
- Webhook URL must use port 80 or 443.
- In Test Mode webhook setup/edit/delete, Razorpay documents default OTP `754081`.

## Required MCP Configuration

- Official remote MCP endpoint: `https://mcp.razorpay.com/mcp`.
- Remote MCP can use a merchant token generated from `key_id:key_secret` or OAuth where supported.
- Local MCP can run with Docker image `razorpay/mcp` and `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
- For MANDATE production payment execution, MCP is not a transaction authority. It may be used only for developer assistance, constrained read-only inspection, or demos that still route through policy and audit.

## Sources

- https://razorpay.com/docs/build/llm-docs/api.md
- https://razorpay.com/docs/build/llm-docs/api/authentication.md
- https://razorpay.com/docs/build/llm-docs/payments/dashboard/test-live-modes.md
- https://razorpay.com/docs/build/llm-docs/payments/dashboard/account-settings/api-keys.md
- https://razorpay.com/docs/build/llm-docs/api/orders/create.md
- https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard/integration-steps.md
- https://razorpay.com/docs/build/llm-docs/api/payments/fetch-with-id.md
- https://razorpay.com/docs/build/llm-docs/api/payments/capture.md
- https://razorpay.com/docs/build/llm-docs/webhooks.md
- https://razorpay.com/docs/build/llm-docs/webhooks/setup-edit-payments.md
- https://razorpay.com/docs/build/llm-docs/webhooks/validate-test.md
- https://razorpay.com/docs/build/llm-docs/mcp-server.md
