# MANDATE Security Model

## Security objective

MANDATE is designed for an AI buyer that can propose and transact without giving the model direct authority over money.

The security objective is:

> **No probabilistic component, browser field, or client callback can independently authorize a monetary action.**

## Trust classification

| Component | Trust level | What it may decide |
|---|---|---|
| AI buyer | Untrusted / probabilistic | intent interpretation, ranking, recommendations, explanations |
| Browser | Untrusted | presentation and user interaction |
| Merchant catalog | Source of commerce truth | products, prices, inventory, quote |
| MANDATE gateway | Trusted control plane | authorization, transaction state, payment verification |
| Razorpay Test Mode | Payment execution rail | payment processing and payment events |
| PostgreSQL | Durable evidence store | transaction/audit/webhook/order persistence |

## Protected invariants

### Spending authority

The hard spending limit is provided by the application and evaluated by the deterministic gateway. The model cannot raise it.

### Amount integrity

The gateway does not trust an amount supplied by the browser or model. It reads the merchant quote and current product price, then checks each requested line before creating a Razorpay order.

### Inventory integrity

The gateway independently re-reads inventory for every requested line. A model recommendation does not reserve or authorize inventory merely by mentioning a product.

### Merchant integrity

The quoted merchant identity must match the purchase intent. Cross-merchant quote substitution is blocked.

### Quote validity

Expired quotes are rejected before payment authorization.

### User approval

Recommendations are not silently inserted into a purchase intent. Basket expansion requires an explicit user approval step before the complete basket is sent to the gateway.

### Payment verification

A browser checkout callback is evidence to begin reconciliation, not authority to mark an order paid. The gateway verifies the checkout signature and retrieves payment state from Razorpay.

### Webhook verification and idempotency

Razorpay webhook signatures are checked against the raw request body. After signature validation, the gateway claims a persistent dedupe key in PostgreSQL. Replayed deliveries do not create additional effects.

### Event ordering

Webhook ordering is not assumed. Successful payment states are protected from late failure events, which are audited rather than used to regress the transaction.

### Failed payment retry

A failed payment is a terminal attempt. Retry creates a new transaction and reruns quote, inventory and spending checks. The failed attempt stays intact in the audit history.

### Merchant order confirmation

The merchant order is confirmed only after gateway-side payment verification. The merchant's internal confirmation endpoint is protected by a shared gateway secret.

## Adversarial cases covered

```text
1. AI asks to spend above the hard limit
   → policy_blocked, no Razorpay order

2. Browser submits a false amount
   → merchant quote remains authoritative

3. Quote is expired
   → policy_blocked

4. Inventory is insufficient
   → policy_blocked

5. Quote belongs to another merchant
   → policy_blocked

6. Basket line price differs from current merchant price
   → AMOUNT_INTEGRITY fails

7. Invalid transaction state transition
   → rejected

8. Duplicate payment callback
   → no duplicate transition

9. Duplicate webhook identity
   → dedupe boundary returns duplicate

10. Late payment failure after capture/verification
    → ignored for state regression and audited

11. Retry of a non-failed transaction
    → rejected

12. Unauthorized merchant order confirmation
    → rejected by internal gateway secret
```

## What is intentionally not claimed

The repository contains judge-facing synthetic labs for replay and tamper demonstrations. These labs prove the deterministic mechanisms in isolation; they do not pretend to be real Razorpay events.

A full live demonstration still requires:

- Razorpay Test Mode credentials;
- a configured Razorpay Test Mode webhook;
- a publicly reachable webhook endpoint or supported tunnel/staging host;
- local execution of the Docker stack.

## Secrets

The following values remain server-side:

```text
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
INTERNAL_GATEWAY_SECRET
OPENAI_API_KEY
```

The browser may receive a Razorpay public key ID where required for Standard Checkout, but never the API secret or webhook secret.

## Security boundary in one picture

```text
                 UNTRUSTED
       ┌──────────────────────────┐
       │ LLM output               │
       │ browser fields           │
       │ checkout callback        │
       └────────────┬─────────────┘
                    │
                    ▼
        ┌────────────────────────┐
        │ MANDATE GATEWAY        │
        │                        │
        │ merchant quote         │
        │ inventory              │
        │ hard limit             │
        │ amount integrity       │
        │ state machine          │
        │ payment verification   │
        │ webhook dedupe         │
        └───────────┬────────────┘
                    │
                    ▼
              Razorpay
```

The model can influence **what should be bought**. It cannot independently decide **whether money is allowed to move**.
