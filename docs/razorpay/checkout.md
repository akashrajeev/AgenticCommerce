# Razorpay Standard Checkout

## Role In MANDATE

The buyer frontend opens Razorpay Standard Checkout only after the gateway has:

1. Received a PurchaseIntent.
2. Authorized it through deterministic policy.
3. Created a Razorpay Order server-side.

## Required Checkout Options

- `key`: Razorpay public key id from Dashboard.
- `amount`: amount in smallest currency subunit.
- `currency`: currency code.
- `name`: merchant/business display name.
- `order_id`: Razorpay Order id created server-side.

Optional:

- `description`
- `image`
- `prefill`
- `notes`
- `theme`
- `modal`
- `retry`

## Success Response

Checkout success returns:

- `razorpay_payment_id`
- `razorpay_order_id`
- `razorpay_signature`

The frontend must send these to the gateway. The frontend must not mark payment or order success itself.

## Failure Handling

Checkout exposes `payment.failed` with error metadata including order id and payment id. MANDATE should store failed attempts and offer retry by creating a new Razorpay Order through the gateway.

## Sources

- https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard.md
- https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard/integration-steps.md
