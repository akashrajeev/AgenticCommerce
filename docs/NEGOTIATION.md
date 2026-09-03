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
Merchant Offers
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
  +-- merchant-issued offer attestation
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

Endpoint:

```text
POST /api/agent/negotiate
GET  /api/agent/negotiate/:id
```

The merchant agent:

- evaluates live catalog availability;
- filters candidates against the buyer's stated budget/category;
- creates real merchant checkout quotes;
- publishes `MerchantOffer` objects containing exact quote, line items, amount and expiry;
- stores the issued offer set for later attestation.

The merchant agent does not create Razorpay orders.

## Buyer agent

Endpoint:

```text
POST /api/agent/negotiate
```

The buyer agent passes the request to the merchant agent, retrieves the resulting offers, loads the corresponding merchant product facts, and selects the best offer according to deterministic value/quality scoring.

This is intentionally separate from payment authorization: the buyer can recommend or select an offer, but the gateway remains the authority that can bind it to a delegated mandate.

## Offer attestation

The acceptance endpoint is:

```text
POST /v1/negotiations/:negotiationId/accept
```

Before accepting an offer, the gateway verifies that:

```text
offerId
intentId
merchantId
quoteId
amount
source protocol
expiry
line items
```

match the offer the merchant agent actually issued for that negotiation.

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

The first successful acceptance creates a transaction. A repeated request for the same tuple replays the existing transaction reference rather than creating another delegated spend.

A changed offer amount, item, merchant or quote reference fails the merchant-attestation or quote-revalidation boundary before a new transaction is authorized.

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
5. Show the Merchant Agent returning multiple live offers.
6. Show the Buyer Agent selecting one.
7. Accept the selected offer.
8. Show the gateway creating a transaction under the delegated mandate.
9. Click “Tamper amount → test block” on a fresh negotiation.
10. Show that the gateway rejects the altered amount before payment authority.
11. Continue to the existing Razorpay Test Mode checkout path.
```

## Implementation status

```text
Merchant-agent offer generation       IMPLEMENTED
authoritative live merchant quoting   IMPLEMENTED
Buyer-agent offer evaluation           IMPLEMENTED
Merchant-issued offer attestation      IMPLEMENTED
Gateway offer acceptance boundary      IMPLEMENTED
Delegated mandate integration           IMPLEMENTED
Razorpay Test Mode hand-off             EXISTING TRUSTED PATH
Cross-process persistent negotiations   NOT IMPLEMENTED
Cryptographic merchant-agent signing    NOT IMPLEMENTED
Full external A2A protocol conformance NOT CLAIMED
```

The current negotiation store is intentionally in-memory for the demo deployment. A production horizontally scaled implementation should persist negotiations and add an authenticated or signed merchant-agent credential over the offer envelope.
