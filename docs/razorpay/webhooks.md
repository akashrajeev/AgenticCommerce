# Razorpay Webhooks

## Role In MANDATE

Webhooks are required for reliable reconciliation. They are not a replacement for Checkout signature verification; they are the asynchronous source of payment state updates and late/failure recovery.

## Endpoint

Recommended future route:

- `POST /webhooks/razorpay`

Requirements:

- Must be public for Razorpay delivery.
- Razorpay documents webhook URLs must use port 80 or 443.
- Localhost cannot be used directly; use a supported tunnel or staging environment.
- Return 2xx within 5 seconds.

## Signature Verification

- Header: `X-Razorpay-Signature`.
- Algorithm: HMAC SHA256.
- Key: `RAZORPAY_WEBHOOK_SECRET`.
- Message: raw webhook request body.
- Do not parse or cast body before signature verification.

## Events For MANDATE

Minimum:

- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `order.paid`

## Retries And Deactivation

If Razorpay does not receive a 2xx response within 5 seconds, the webhook is considered failed. Razorpay retries at progressive intervals using exponential backoff for 24 hours. Continued failure disables the webhook.

## Duplicate Events

Duplicate webhook deliveries are expected. Razorpay provides `x-razorpay-event-id`; MANDATE must store it and skip already processed event ids.

## Event Ordering

Razorpay states that webhooks may not arrive in event order. MANDATE must treat each event as an observation and apply it through the transaction state machine, not through arrival order assumptions.

## Sources

- https://razorpay.com/docs/build/llm-docs/webhooks.md
- https://razorpay.com/docs/build/llm-docs/webhooks/setup-edit-payments.md
- https://razorpay.com/docs/build/llm-docs/webhooks/validate-test.md
