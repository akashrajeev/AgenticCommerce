# Razorpay Test Mode UPI Runbook

## Purpose

This is the Phase 8 golden-path runbook for demonstrating that the MANDATE authorization/control plane ends in a real Razorpay Test Mode payment flow.

## Preconditions

Configure the gateway with Razorpay **Test Mode** credentials only:

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
```

The Docker Compose gateway receives these through `apps/gateway/.env`; secrets are never exposed to browser code. `RAZORPAY_BASE_URL` should remain the Razorpay API base URL.

Razorpay documents Test Mode UPI identifiers:

```text
success@razorpay  -> successful UPI test payment
failure@razorpay  -> failed UPI test payment
```

No real money is moved by Test Mode. citeturn205322search1turn205322search5

## Golden success run

Open:

```text
http://localhost:3001/negotiation
```

Then:

```text
1. Select or issue the delegated mandate.
2. Enter: Find the best ANC headphones under ₹5,000.
3. Start negotiation.
4. Show the buyer-agent intent.
5. Show the merchant-agent offers and the selected offer.
6. Accept the selected offer.
7. Confirm the UI shows a mandate authorization ID.
8. Click “Create mandate-gated Test Order”.
9. Open Razorpay Test Checkout.
10. Choose UPI.
11. Enter success@razorpay.
12. Complete the Test Mode flow.
13. Let the browser callback hit the gateway verification endpoint.
14. Wait for webhook/API reconciliation in the trace.
15. Confirm the transaction reaches the merchant-order confirmation path.
16. Open `/proof` and show transaction, payment, webhook/audit and revenue evidence.
```

The browser only receives a publishable Razorpay key ID and order metadata. The gateway keeps the Razorpay API secret and webhook secret server-side.

## Failure run

Use the same flow, but enter:

```text
failure@razorpay
```

Expected outcome:

```text
payment_failed
    ↓
no merchant order
    ↓
original attempt preserved
    ↓
retry creates a fresh transaction
    ↓
merchant quote + policy are evaluated again
```

## Security run

Before the success run, use the existing tamper control:

```text
Tamper amount -> test block
```

Expected outcome:

```text
merchant offer attestation / quote mismatch
        ↓
BLOCK
        ↓
no mandate authorization
        ↓
no Razorpay order
```

## Webhook setup

Razorpay requires webhook signature validation over the **raw request body** using HMAC-SHA256. Razorpay also documents at-least-once delivery behavior and recommends using the unique `x-razorpay-event-id` for idempotency; webhook ordering should not be assumed. citeturn205322search0turn205322search2

For a local public webhook URL, use an HTTPS tunnel or staging environment and configure the Razorpay Test Mode webhook endpoint to:

```text
POST https://<public-host>/v1/webhooks/razorpay
```

Keep `RAZORPAY_WEBHOOK_SECRET` identical to the secret configured for that webhook in Test Mode.

## Evidence checklist

A complete Phase 8 demonstration should show all of these in one story:

```text
[ ] buyer intent
[ ] merchant offer
[ ] signed merchant attestation
[ ] delegated mandate
[ ] deterministic gateway authorization
[ ] Razorpay Test Order ID
[ ] Standard Checkout
[ ] success@razorpay or failure@razorpay
[ ] server-side payment signature verification
[ ] Razorpay webhook receipt
[ ] webhook dedupe/event ID evidence
[ ] payment verification state
[ ] merchant order ID
[ ] realized revenue attribution
```

The synthetic webhook replay lab remains a **security simulation**. It is not evidence of a real Razorpay delivery.
