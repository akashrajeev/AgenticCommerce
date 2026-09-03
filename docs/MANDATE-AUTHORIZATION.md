# MANDATE Authorization — Phase 4A

Phase 4A adds the deterministic authorization artifact boundary that sits between a protocol checkout and payment execution.

```text
User mandate
    +
Fresh merchant checkout binding
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

The gateway also produces an HMAC over the canonical checkout binding using the internal gateway secret. This is a gateway integrity proof for the authorization artifact; it is **not** a claim that a user credential or external protocol signature has been verified.

## Important security boundary

The module never trusts a client-declared amount as the payment authority. It rebuilds the purchase intent from the checkout binding and passes it through the existing transaction core, which re-reads the merchant quote, product and inventory before reaching `policy_authorized`.

A changed cart, amount, product, merchant or expiry therefore cannot reuse the previous binding.

## Deliberate Phase 4A boundary

The current implementation does not yet claim:

- external AP2 credential interoperability;
- external ACP authorization-token interoperability;
- user cryptographic credential verification;
- persistent mandate/authorization records;
- direct ACP completion → Razorpay execution.

Those are the next integration steps. Keeping these boundaries explicit is intentional.

## Tests

`apps/gateway/src/mandate-authorization.test.ts` covers:

1. successful authorization for a correctly bound checkout;
2. cart-hash tampering rejection;
3. hard-spend-limit rejection;
4. product allow-list rejection;
5. fresh gateway policy revalidation before authorization.
