# MANDATE ACP Checkout Adapter

## Purpose

MANDATE exposes an ACP-shaped merchant checkout session surface using the merchant's **real catalog, real inventory and real quote calculator**.

The adapter sits before the existing MANDATE financial authorization boundary:

```text
ACP client / buyer agent
        |
        v
/checkout_sessions
        |
        v
merchant authoritative quote
        |
        v
MANDATE checkout binding
        |
        v
signed user mandate
        |
        v
MANDATE policy + payment authorization
        |
        v
Razorpay Test Mode Order
        |
        v
Standard Checkout + verification + webhook reconciliation
```

The ACP surface does not own financial authority. It creates an authoritative merchant checkout, presents that checkout for mandate authorization, and then invokes the same trusted MANDATE gateway used by the native transaction flow.

## Reference protocol

The repository tracks ACP stable version `2026-04-17`. The public ACP specification defines the merchant checkout lifecycle as create, update, retrieve, complete and cancel, with authoritative merchant cart state returned by the merchant. The current specification also requires `API-Version` and uses `Idempotency-Key` on POST checkout operations. citehttps://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/spec/2026-04-17/openapi/openapi.agentic_checkout.yaml

The ACP repository's idempotency proposal documents explicit error handling for missing keys, payload conflicts and in-flight requests. MANDATE follows those semantics on its checkout adapter. citehttps://github.com/agentic-commerce-protocol/agentic-commerce-protocol/issues/120

The dated ACP checkout specs have also contained schema inconsistencies around request item shapes. MANDATE accepts both `items` and `line_items` and normalizes them to the internal merchant line-item model. This is a compatibility choice, not a claim that the external schema is bug-free. citehttps://github.com/agentic-commerce-protocol/agentic-commerce-protocol/issues/264

## Implemented surface

| Method | Endpoint | Status |
|---|---|---|
| POST | `/checkout_sessions` | Implemented |
| GET | `/checkout_sessions/:id` | Implemented |
| POST | `/checkout_sessions/:id` | Implemented |
| POST | `/checkout_sessions/:id/cancel` | Implemented |
| POST | `/checkout_sessions/:id/complete` | Implemented with MANDATE authorization bridge |

### Required headers

```text
API-Version: 2026-04-17
Authorization: Bearer <ACP_API_KEY>
Idempotency-Key: <opaque unique key>   # POST only
Request-Id: <optional correlation id>
```

The local Docker stack supplies a development ACP API key through `ACP_API_KEY`; production deployments should replace the development value with a secret-managed credential.

## Real merchant data path

A request such as:

```json
{
  "items": [
    { "id": "hp-001", "quantity": 1 },
    { "id": "ms-001", "quantity": 1 }
  ]
}
```

is resolved through the real merchant catalog:

```text
hp-001 → SoundMax Pro
ms-001 → Arc Precision Mouse
```

The adapter never trusts a client-supplied price. It calls the merchant quote builder, which reads the current catalog/inventory and computes the authoritative subtotal, shipping, tax, discount and total.

That means the checkout session is backed by the same merchant truth used by the existing MANDATE transaction flow.

## Idempotency

Every POST checkout operation requires an `Idempotency-Key`.

MANDATE stores the request fingerprint and result for a bounded retry window:

```text
same key + same request
        → original result / replay

same key + different request
        → 422 idempotency_conflict

same key while request is processing
        → 409 idempotency_in_flight

missing key
        → 400 idempotency_key_required
```

The response echoes:

```text
Idempotency-Key
Request-Id
API-Version
```

and sets:

```text
Idempotent-Replayed: true
```

for a cached replay.

## Authoritative state

The merchant, not the agent, owns:

```text
price
inventory
quote
shipping calculation
tax calculation
discount calculation
checkout expiry
```

The client supplies the proposed items. The merchant recomputes the financial state.

This preserves the central MANDATE invariant:

```text
Agent proposal
      ≠
financial authority
```

## Phase 4 completion bridge

`POST /checkout_sessions/:id/complete` now performs a real server-side authorization bridge rather than returning a placeholder success or a fake payment result.

```text
ACP checkout session
        |
        +-- authoritative cart hash
        +-- merchant
        +-- amount
        +-- quote expiry
        |
        v
signed MANDATE user credential
        |
        v
POST /v1/mandates/authorize
        |
        +-- Ed25519 signature verification
        +-- mandate expiry / identity checks
        +-- merchant and spend constraints
        +-- cart-hash validation
        +-- fresh merchant quote revalidation
        +-- deterministic MANDATE policy
        +-- nonce replay protection
        |
        v
Payment Authorization
        |
        v
POST /v1/mandates/:authorizationId/razorpay-order
        |
        +-- authorization still active?
        +-- merchant unchanged?
        +-- amount/currency unchanged?
        +-- checkout binding unchanged?
        |
        v
Razorpay Test Mode Order
```

The completion response is `ready_for_payment` rather than `completed` because creating the Razorpay order is not the same thing as proving that a payment has succeeded. The existing Razorpay Standard Checkout, server-side signature verification, capture/reconciliation and webhook path remain the final payment evidence boundary.

### Request shape

The completion request must include a signed MANDATE credential in one of these fields:

```json
{
  "mandate": {
    "mandateId": "mandate_user_...",
    "subjectId": "user_...",
    "agentId": "buyer_...",
    "merchantId": "mandate-market",
    "purpose": "Buy approved headphones",
    "maxSpend": { "currency": "INR", "amountPaise": 800000 },
    "constraints": {},
    "approvalMode": "human_present",
    "nonce": "nonce_...",
    "issuedAt": "...",
    "expiresAt": "...",
    "credential": {
      "algorithm": "Ed25519",
      "keyId": "...",
      "publicKeyPem": "...",
      "signatureBase64": "..."
    }
  }
}
```

The merchant server forwards the signed mandate to the trusted gateway. The ACP client never receives the Razorpay secret or the internal gateway secret.

## Cryptographic binding

The checkout binding includes:

```text
checkoutId
merchantId
quoteId
currency
totalPaise
expiry
line items
unit prices
line totals
```

MANDATE computes a deterministic SHA-256 cart hash over that canonical representation. Any material change to the merchant, basket, quantity, quoted amount, currency, checkout identifier or expiry changes the binding and causes authorization to fail.

The gateway also stores the resulting authorization artifact on the transaction and persists that artifact with the transaction in PostgreSQL, so the authorization survives a gateway restart.

## Replay protection

A mandate nonce cannot authorize a different checkout. An exact retry of the same mandate + checkout binding returns the existing authorization so transport/retry failures do not create a second authorization.

```text
same mandate + same nonce + same checkout binding
        → existing authorization / safe retry

same mandate + same nonce + changed checkout binding
        → 409 MANDATE_NONCE_REPLAY

new mandate / new nonce
        → eligible for fresh authorization
```

The gateway also guards concurrent requests using an in-process nonce claim set. Persisted transaction state prevents replay after restart in the current single-gateway deployment model.

## Security properties

The adapter enforces:

- bearer authentication when `ACP_API_KEY` is configured;
- required `API-Version`;
- mandatory POST idempotency;
- bounded item quantities;
- product existence;
- merchant inventory checks;
- server-generated quote ids;
- server-computed prices and totals;
- checkout expiry;
- immutable completed/canceled/expired sessions;
- signed Ed25519 mandate verification;
- mandate spend and merchant restrictions;
- deterministic policy re-evaluation at authorization time;
- cryptographic checkout binding;
- mandate nonce replay protection;
- authorization persistence in PostgreSQL;
- no direct Razorpay secret or payment authority in the ACP surface.

## Verification coverage

The gateway has regression coverage for:

```text
✓ fresh mandate authorization
✓ signed Ed25519 mandate authorization
✓ cart-hash tampering rejection
✓ spend-limit rejection
✓ product allow-list rejection
✓ fresh merchant/policy revalidation
✓ exact same-checkout authorization retry
✓ different-checkout nonce replay rejection
✓ Razorpay signature boundary
✓ transaction binding of mandate authorization
```

The ACP completion path is separately wired to exercise the same authorization and Razorpay-order authority rather than bypassing it.

## Implementation status

```text
ACP discovery                    IMPLEMENTED
ACP checkout session CRUD        IMPLEMENTED
ACP idempotency boundary         IMPLEMENTED
ACP authoritative quoting       IMPLEMENTED
ACP → MANDATE authorization      IMPLEMENTED
MANDATE → Razorpay Test Order   IMPLEMENTED
Payment verification/webhooks    EXISTING TRUSTED PATH
Full ACP wire conformance       NOT CLAIMED
AP2 wire interoperability       NOT CLAIMED
```
