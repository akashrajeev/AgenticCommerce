# Razorpay Payments

## Role In MANDATE

Payments are created through Checkout after a server-created Order. MANDATE uses Payment APIs to verify status, reconcile late or uncertain flows, and capture authorized payments if manual capture is enabled.

## Payment Lifecycle

- `created`: payment details submitted but not processed.
- `authorized`: bank authenticated payment details; amount is deducted and must be captured manually or automatically.
- `captured`: payment complete and eligible for settlement.
- `refunded`: captured payment reversed.
- `failed`: payment attempt failed.

Razorpay documents that an `authorized` payment is auto-refunded if not captured within 3 days of creation.

## APIs

- Fetch Payment: `GET /v1/payments/:id`.
- Capture Payment: `POST /v1/payments/:id/capture`.

Payments API cannot be used to collect payments; it retrieves details or changes status from `authorized` to `captured`.

## Capture

Capture request requires:

- `amount`: integer equal to the order amount, in smallest currency unit.
- `currency`: ISO currency code.

MANDATE must compare payment amount, currency, order id, and status against the server transaction before capture or confirmation.

## Sources

- https://razorpay.com/docs/build/llm-docs/payments/payments.md
- https://razorpay.com/docs/build/llm-docs/api/payments.md
- https://razorpay.com/docs/build/llm-docs/api/payments/fetch-with-id.md
- https://razorpay.com/docs/build/llm-docs/api/payments/capture.md
- https://razorpay.com/docs/build/llm-docs/payments/payments/capture-settings.md
