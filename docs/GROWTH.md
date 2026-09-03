# MANDATE AI Growth Opportunities

Phase 7 turns the merchant recommendation engine into a quote-backed growth opportunity that can be surfaced to the buyer and routed through the existing MANDATE policy boundary.

## Flow

```text
Base product
   |
   v
Merchant recommendation engine
   |
   +-- UPSELL / CROSS_SELL
   +-- score
   +-- rationale
   +-- incremental item value
   |
   v
Live bundle quote
   |
   +-- projected basket
   +-- budget fit
   +-- quote id
   +-- expiry
   |
   v
Buyer approval
   |
   v
MANDATE purchase intent
   |
   v
Deterministic policy
   |
   v
Razorpay authority
```

## Merchant endpoint

```text
GET /api/agent/growth-opportunities?productId=:id&maxSpendPaise=:limit
```

The endpoint combines the existing deterministic recommendation engine with the authoritative quote builder. Each opportunity therefore contains both a recommendation signal and a current merchant bundle quote.

The response exposes:

```text
opportunityId
sourceProductId
recommendedProductId
type
score
rationale
incrementalRevenue
projectedBasket
budgetFit
sourceQuoteId
bundleQuoteId
expiry
```

## Buyer approval

The demo buyer surface is:

```text
http://localhost:3001/growth
```

The buyer can see why the opportunity was suggested, its incremental value, projected basket and whether it fits the customer budget.

The approval button does not perform a payment. It creates the same gateway purchase intent used by the normal buyer flow.

## Security boundary

```text
recommendation
     ≠
approval
     ≠
authorization
     ≠
payment
```

A recommendation never bypasses the existing merchant quote, inventory check, spend policy or transaction authority.

The resulting basket is freshly quoted at approval time. The gateway evaluates the verified quote under the customer's hard spending limit before any Razorpay order can be created.

## Example

```text
SoundMax Pro
₹3,999.00

Merchant opportunity:
Arc Precision Mouse
CROSS_SELL
+ ₹2,499.00 incremental item value

Projected basket:
₹7,678.82

Customer budget:
₹10,000

BUDGET FIT
        |
        v
Approve & route through MANDATE
```

The exact projected amount is always computed from the current merchant quote; it is not a client-side sum of displayed product prices.

## Current limitation

The current implementation is deliberately deterministic and catalog-based. It does not claim uplift prediction from historical conversion data, experiments or a trained propensity model.
