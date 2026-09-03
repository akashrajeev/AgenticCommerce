# MANDATE ACP Checkout Adapter

## Purpose

MANDATE now exposes an ACP-shaped merchant checkout session surface using the merchant's **real catalog, real inventory and real quote calculator**.

The adapter is deliberately placed before the existing MANDATE financial authorization boundary:

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
MANDATE normalized checkout
        |
        v
MANDATE policy + payment authorization
        |
        v
Razorpay Test Mode
```

This Phase 3 work does **not** claim full ACP wire-level interoperability yet. The create, retrieve, update and cancel surface is implemented; completion is intentionally guarded until the MANDATE payment bridge binds an ACP checkout to a trusted authorization.

## Reference protocol

The repository tracks ACP stable version `2026-04-17`. The public ACP specification defines the merchant checkout lifecycle as create, update, retrieve, complete and cancel, with authoritative merchant cart state returned by the merchant. The current specification also requires `API-Version` and uses `Idempotency-Key` on POST checkout operations. citehttps://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/spec/2026-04-17/openapi/openapi.agentic_checkout.yaml

The current ACP repository's idempotency proposal documents the explicit error model for missing keys, payload conflicts and in-flight requests. MANDATE follows those semantics on its checkout adapter. citehttps://github.com/agentic-commerce-protocol/agentic-commerce-protocol/issues/120

The ACP repository also has a known schema issue in the dated checkout specs where some request schemas reference `Item` even though the request examples use `items` with quantities. MANDATE accepts both `items` and `line_items` and normalizes them to the internal merchant line-item model. This is a compatibility choice, not a claim that the external ACP schema is bug-free. citehttps://github.com/agentic-commerce-protocol/agentic-commerce-protocol/issues/264

## Implemented surface

| Method | Endpoint | Status |
|---|---|---|
| POST | `/checkout_sessions` | Implemented |
| GET | `/checkout_sessions/:id` | Implemented |
| POST | `/checkout_sessions/:id` | Implemented |
| POST | `/checkout_sessions/:id/cancel` | Implemented |
| POST | `/checkout_sessions/:id/complete` | Guarded by MANDATE authorization |

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

That means the returned checkout is backed by the same merchant truth used by the existing MANDATE transaction flow.

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

This mirrors the central MANDATE invariant:

```text
Agent proposal
      ≠
financial authority
```

## Completion boundary

ACP's complete operation is intended to finalize the payment and create the order. MANDATE intentionally does not let an ACP request bypass the existing payment-authority boundary.

Current Phase 3 behavior:

```text
POST /checkout_sessions/:id/complete
        |
        +--> no MANDATE transaction binding
                 ↓
          409 mandate_authorization_required

        +--> binding supplied
                 ↓
          501 mandate_payment_bridge_pending
```

The second path is an explicit engineering boundary, not a fake success response. Phase 4 will bind:

```text
Checkout Session
      +
User Mandate
      +
cartHash
      +
merchant
      +
amount
      +
expiry
      ↓
Payment Authorization
      ↓
Razorpay
```

Only after that bridge exists should the adapter advertise completion as interoperable.

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
- no direct payment execution from the ACP surface.

## Testing plan

The current CI pipeline continues to run:

```text
Typecheck
Unit tests
Build
```

The ACP adapter's next test expansion should cover:

```text
✓ create with live catalog item
✓ create multi-line basket
✓ update basket gets a fresh quote
✓ retrieve returns authoritative current state
✓ cancel is idempotent
✓ missing idempotency key is rejected
✓ same idempotency key replays the original response
✓ idempotency payload conflict is rejected
✓ in-flight collision is rejected
✓ expired session is not payable
✓ completion cannot bypass MANDATE
```

## Status

```text
ACP discovery              IMPLEMENTED
ACP checkout session CRUD  IMPLEMENTED
ACP idempotency boundary   IMPLEMENTED
ACP authoritative quoting  IMPLEMENTED
ACP completion bridge      PENDING PHASE 4
Full ACP wire conformance  NOT CLAIMED
```
