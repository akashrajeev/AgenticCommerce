# MANDATE Agent-to-Agent Negotiation

## Purpose

Phase 6 adds a visible buyer-agent ↔ merchant-agent negotiation loop without creating a second payment authority.

The core rule remains:

```text
Agent proposal / offer
        ≠
Payment authority
```

## Flow

```text
Buyer Agent
  |
  | intent + hard budget
  v
Merchant Agent
  |
  | live catalog + inventory + quote
  v
Merchant Offers + signed attestations
  |
  v
Buyer Agent selection
  |
  v
User's delegated mandate
  |
  v
MANDATE gateway
  |
  +-- merchant identity credential verification
  +-- signed offer verification
  +-- authoritative quote revalidation
  +-- cart binding
  +-- deterministic policy
  +-- delegated budget reservation
  |
  v
Transaction Authority
  |
  v
Razorpay Test Mode
```

## Merchant agent

Endpoints:

```text
GET  /.well-known/agent-commerce
GET  /.well-known/agent-credentials
POST /api/agent/negotiate
GET  /api/agent/negotiate/:id
```

The merchant agent:

- evaluates live catalog availability;
- filters candidates against the buyer's stated budget/category;
- creates real merchant checkout quotes;
- publishes `MerchantOffer` objects containing exact quote, line items, amount and expiry;
- signs each offer with the merchant agent's Ed25519 credential;
- stores the issued offer set for later attestation.

The merchant agent does not create Razorpay orders.

## Merchant identity and offer attestation

The public credential endpoint returns the merchant agent identity and Ed25519 public key:

```text
algorithm
keyId
merchantId
agentId
issuer
publicKeyPem
```

Each offer is accompanied by an attestation containing:

```text
offerId
credential
signatureBase64
```

The signature covers the canonicalized offer plus the complete credential, binding the merchant identity to the exact offer payload.

Production merchant deployments must provide `MERCHANT_AGENT_PRIVATE_KEY_B64`; local development uses an ephemeral Ed25519 key so no production secret is embedded in the repository.

## Gateway acceptance

The acceptance endpoint is:

```text
POST /v1/negotiations/:negotiationId/accept
```

Before accepting an offer, the gateway verifies that the merchant actually issued it and validates the signed credential. It checks:

```text
offerId
intentId
merchantId
quoteId
amount
source protocol
expiry
line items
merchant credential identity
Ed25519 signature
```

It then fetches the merchant's authoritative quote again and compares:

```text
merchant
quote id
currency
total
line items
quote expiry
```

Only after both layers agree does the gateway construct a checkout binding and call the existing delegated mandate engine.

## Replay behavior

The acceptance boundary is idempotent for the tuple:

```text
negotiationId + mandateId + offerId
```

Accepted references are persisted in PostgreSQL, restored on gateway startup, and replayed from the durable acceptance record instead of relying only on process memory.

A changed offer amount, item, merchant, credential or quote reference fails the signed attestation or quote-revalidation boundary before a new transaction is authorized.

## Judge demo

Open:

```text
http://localhost:3001/negotiation
```

Recommended sequence:

```text
1. Issue the demo delegated mandate if none exists.
2. Enter: “Find the best ANC headphones under ₹5,000.”
3. Start negotiation.
4. Show the Buyer Agent intent.
5. Show the Merchant Agent returning multiple live offers and attestations.
6. Show the Buyer Agent selecting one.
7. Accept the selected offer.
8. Show the gateway verifying the merchant signature and creating a transaction under the delegated mandate.
9. Tamper with the amount/signature and show the gateway reject it before payment authority.
10. Continue to the existing Razorpay Test Mode checkout path.
```

## Implementation status

```text
Merchant-agent offer generation        IMPLEMENTED
authoritative live merchant quoting    IMPLEMENTED
Buyer-agent offer evaluation            IMPLEMENTED
Merchant-issued offer attestation       IMPLEMENTED
Ed25519 merchant signing                IMPLEMENTED
Gateway signature verification          IMPLEMENTED
Delegated mandate integration            IMPLEMENTED
Persistent acceptance idempotency        IMPLEMENTED
Gateway acceptance restart hydration     IMPLEMENTED
Merchant negotiation session durability  NOT IMPLEMENTED
Razorpay Test Mode hand-off              EXISTING TRUSTED PATH
Full external A2A protocol conformance   NOT CLAIMED
```

The merchant's active negotiation session is still process-local for the demo deployment. The accepted-offer/idempotency boundary is durable in PostgreSQL, so gateway restarts do not create a second transaction for an already-accepted offer.
