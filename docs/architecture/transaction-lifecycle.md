# Transaction Lifecycle

## MANDATE States

1. `intent_proposed`: AI proposed purchase intent.
2. `policy_authorized`: deterministic checks passed.
3. `policy_blocked`: deterministic checks failed.
4. `razorpay_order_created`: gateway created Razorpay Order.
5. `checkout_started`: frontend opened Standard Checkout.
6. `payment_authorized`: Razorpay reported payment authorization.
7. `payment_captured`: Razorpay reported capture.
8. `payment_failed`: Razorpay reported failure.
9. `payment_verified`: gateway verified signature and payment details.
10. `merchant_order_confirmed`: merchant order can be fulfilled.
11. `cancelled`: user/system cancelled before confirmation.

## Hard Rules

- `policy_blocked` is terminal for a transaction attempt.
- `razorpay_order_created` can only follow `policy_authorized`.
- `payment_verified` requires server-side signature verification and/or Razorpay API verification.
- `merchant_order_confirmed` can only follow `payment_verified`.
- Webhooks are observations and must pass through idempotency plus transition validation.

## Failure Recovery

- Checkout failure creates an audited failed attempt.
- Payment retry creates a new Razorpay Order.
- Duplicate webhook event is acknowledged but skipped.
- Out-of-order webhook event is stored and reconciled against fetched Razorpay state if necessary.

## Sources

- https://razorpay.com/docs/build/llm-docs/payments/orders.md
- https://razorpay.com/docs/build/llm-docs/payments/payments.md
- https://razorpay.com/docs/build/llm-docs/webhooks/validate-test.md
