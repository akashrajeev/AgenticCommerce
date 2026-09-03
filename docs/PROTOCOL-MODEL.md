# MANDATE Protocol-Neutral Commerce Model

## Purpose

Phase 1 introduces the shared semantic model that future agent-commerce and payment protocols will map into.

This is deliberately **not** a claim of ACP, AP2, UAP or x402 wire-level interoperability. The model is the internal contract that prevents each protocol adapter from creating its own payment-authority logic.

```text
ACP / AP2 / UAP / x402 / native MANDATE
                  ↓
            protocol adapter
                  ↓
        shared semantic objects
                  ↓
        deterministic MANDATE core
                  ↓
             payment rail
```

## Core objects

### AgentIdentity

Identifies the actor that is participating in commerce. Phase 1 records the identity reference and optional issuer/key reference; cryptographic proof is intentionally deferred to the mandate phase.

### MerchantCapability

Describes what an agent-ready merchant can actually do. A capability is discovery metadata, not payment authority.

### CommerceIntent

Represents **what the buyer wants** and the constraints supplied by the user/agent. It contains intent items, purpose, spending ceiling and source protocol.

The intent does not establish a trusted final payment amount.

### MerchantOffer

Represents what the merchant is actually offering: priced line items, quote reference, total amount, conditions and expiry.

Merchant truth remains authoritative for pricing and inventory.

### CheckoutSession / CheckoutSnapshot

Represents a concrete merchant checkout state. The snapshot captures the exact merchant, quote, line items, total and expiry that later authorization can bind to.

### UserMandate

Represents user-delegated authority. It can be human-present or delegated-autonomous and can constrain merchant, products, purpose, amount and expiry.

Phase 1 defines the semantic object; signature/credential verification arrives in Phase 4.

### CheckoutMandate / PaymentMandate

These are separate objects so a future AP2-style adapter can preserve the distinction between checkout authorization and payment authorization without contaminating the core with protocol-specific credential formats.

### PaymentAuthorization

Represents the gateway's deterministic decision that a particular checkout may use a particular payment rail for a particular amount and binding.

### PaymentReceipt

Represents the external payment evidence returned by a payment rail. It does not itself authorize the original payment.

### ProtocolEnvelope

Wraps protocol-specific messages with protocol/version/message metadata while leaving the payload normalized inside the adapter boundary.

## Binding boundary

The canonical checkout binding includes:

```text
checkoutId
merchantId
quoteId
currency
final total
quote expiry
priced line items
```

`canonicalizeCheckoutBinding()` produces a deterministic serialization. A later cryptographic layer will hash/sign this canonical value.

```text
Merchant quote
     +
approved basket
     +
merchant identity
     +
checkout id
     +
expiry
     ↓
canonical binding
     ↓
cryptographic hash / proof (Phase 4)
```

Changing a product, quantity, unit price, line total, total amount, merchant or checkout reference must therefore change the canonical binding.

## Protocol status

| Protocol | Phase 1 status |
|---|---|
| `mandate-native` | Internal canonical model |
| `acp` | Adapter target; no wire-level claim yet |
| `ap2` | Semantic alignment target; no credential interoperability claim yet |
| `uap` | Adapter-ready identifier only; public specification not claimed |
| `x402` | Adapter target for agent-to-service payments |

The repository must keep these statuses explicit. A future phase may upgrade a protocol from **adapter-ready** or **aligned** to **implemented** only after actual interoperability is demonstrated.

## Invariants for all adapters

Every adapter must eventually map into the same rules:

1. The model cannot increase the user's spending authority.
2. Merchant price, inventory and quote remain authoritative.
3. The payment amount is derived from trusted checkout state.
4. A changed basket requires fresh authorization.
5. Expired authorization cannot be used.
6. Payment execution occurs only after deterministic gateway authorization.
7. External payment receipts do not directly mutate merchant order state without verification.

## Phase 1 acceptance

- Shared TypeScript objects exist in `@mandate/types`.
- Runtime Zod schemas exist in `@mandate/schemas`.
- Canonical checkout serialization is deterministic across line-item ordering.
- Canonical serialization changes when a security-relevant checkout field changes.
- Existing buyer/merchant/gateway transaction paths remain unchanged.
- No protocol adapter can bypass the existing gateway authority boundary.
