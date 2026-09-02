# Razorpay Orders

## Role In MANDATE

Razorpay Orders are created only by the gateway after deterministic policy authorization. The AI and frontend cannot create Orders.

## API

- Create Order: `POST /v1/orders`.
- Fetch Order: `GET /v1/orders/:id`.
- Fetch order payments: `GET /v1/orders/:id/payments`.
- Base URL for v1 APIs: `https://api.razorpay.com/v1`.
- Authentication: Basic Auth with `RAZORPAY_KEY_ID:RAZORPAY_KEY_SECRET`.

## Create Order Request

Required:

- `amount`: integer in the smallest currency subunit.
- `currency`: ISO currency code, such as `INR`.

Optional but needed by MANDATE:

- `receipt`: unique internal receipt, max 40 characters.
- `notes`: key-value metadata, max 15 pairs, 256 characters per value.

## Order Lifecycle

- `created`: new order, payment not attempted.
- `attempted`: payment was attempted.
- `paid`: payment captured; no further payments allowed on the order.

Razorpay documents that if a customer's payment fails and they retry, the server must create a new Order and pass a new `order_id` to Checkout.

## Security Requirements

- Create one Razorpay Order only after policy authorization.
- Store Razorpay Order id on the MANDATE transaction.
- Pass the stored order id to Checkout.
- Do not trust browser-provided amounts.

## Sources

- https://razorpay.com/docs/build/llm-docs/payments/orders.md
- https://razorpay.com/docs/build/llm-docs/api/orders/create.md
- https://razorpay.com/docs/build/llm-docs/api/orders/fetch-with-id.md
- https://razorpay.com/docs/build/llm-docs/payments/payment-gateway/web-integration/standard/integration-steps.md
