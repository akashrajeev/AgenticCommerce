# MANDATE Authorization — Phase 4

Phase 4 adds the deterministic authorization artifact boundary that sits between a protocol checkout and payment execution. Phase 4B additionally verifies a user-signed mandate before the authorization core is allowed to run.

```text
User mandate
    +
Fresh merchant checkout binding
    ↓
credential verification (optional signed path)
    ↓
MANDATE authorization core
    ↓
policy revalidation
    ↓
CheckoutMandate
    ↓
PaymentMandate
    ↓
PaymentAuthorization
```

## What is implemented

`apps/gateway/src/mandate-authorization.ts` validates:

- mandate identity and purpose;
- mandate issue/expiry windows;
- checkout expiry;
- INR currency consistency;
- final checkout amount equality;
- hard spending ceiling;
- optional merchant restriction;
- optional product allow-list;
- line-item arithmetic;
- deterministic checkout `cartHash`;
- fresh gateway policy evaluation against merchant truth.

The module then produces `CheckoutMandate`, `PaymentMandate` and `PaymentAuthorization` objects using the shared types in `@mandate/types`.

`apps/gateway/src/mandate-credentials.ts` adds an Ed25519 signed-mandate path. The gateway canonicalizes the user mandate without its credential envelope and verifies the supplied public key/signature before calling the existing authorization core.

The gateway also produces an HMAC over the canonical checkout binding using the internal gateway secret. This is a gateway integrity proof for the authorization artifact; it is distinct from the user's Ed25519 credential.

## Endpoint

The gateway exposes an internal authorization boundary:

```text
POST /v1/mandates/authorize
x-mandate-gateway-secret: <internal secret>
```

The endpoint accepts either a plain `UserMandate` for the existing trusted/internal path or a `SignedUserMandate` for the cryptographically verified path. It never creates a Razorpay order directly; payment execution remains downstream of the existing transaction state machine.

## Important security boundary

The authorization core never trusts a client-declared amount as the payment authority. It rebuilds the purchase intent from the checkout binding and passes it through the existing transaction core, which re-reads the merchant quote, product and inventory before reaching `policy_authorized`.

A changed cart, amount, product, merchant or expiry therefore cannot reuse the previous binding.

## Deliberate Phase 4 boundary

The current implementation does not claim:

- external AP2 credential interoperability;
- external ACP authorization-token interoperability;
- production identity-provider/key-registry integration;
- persistent first-class mandate/authorization tables;
- direct ACP completion → Razorpay execution.

The signed credential implementation is deliberately protocol-neutral so a later external adapter can map into it without changing the financial authority boundary.

## Tests

`apps/gateway/src/mandate-authorization.test.ts` covers:

1. successful authorization for a correctly bound checkout;
2. signed-user-mandate verification integrated with authorization;
3. cart-hash tampering rejection;
4. hard-spend-limit rejection;
5. product allow-list rejection;
6. fresh gateway policy revalidation before authorization.

`apps/gateway/src/mandate-credentials.test.ts` covers:

1. valid Ed25519 verification;
2. signed-field tampering rejection;
3. malformed public-key rejection;
4. deterministic mandate canonicalization.
