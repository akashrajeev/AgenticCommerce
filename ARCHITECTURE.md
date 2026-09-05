# MANDATE Architecture

## Executive view

**MANDATE is an agentic-commerce control plane, not an LLM checkout script.**

Its architecture deliberately separates four responsibilities:

```text
AI reasoning      → decides what is relevant
Merchant systems  → define what is true
Gateway policy    → decides whether money may move
Razorpay          → executes the payment
```

The resulting system is easier to reason about because the probabilistic layer and the financial authorization layer are separate.

---

## 1. System architecture — end to end

This is the main architecture diagram for the submission. It shows the buyer, merchant growth surface, trusted MANDATE gateway, Razorpay payment rail, persistence and judge/evidence layer in one view.

```mermaid
flowchart LR
    U[User]

    subgraph BUYER[AI Buyer Domain — Untrusted / Probabilistic]
      B1[Natural-language intent]
      B2[Buyer Agent Planner]
      B3[Tool loop + bounded trace]
      B4[Product ranking / reasoning]
      B5[Basket proposal]
      B6[Explicit approval]
    end

    subgraph MERCHANT[Merchant Domain — Commerce Truth]
      M1[Agent Manifest]
      M2[Catalog]
      M3[Inventory]
      M4[Fresh Quote]
      M5[Upsell / Cross-sell]
      M6[Growth Campaign]
      M7[Merchant Order]
    end

    subgraph GATEWAY[MANDATE — Trusted Control Plane]
      G1[Intent validation]
      G2[Quote + inventory revalidation]
      G3[Deterministic policy]
      G4[Mandate authorization]
      G5[Transaction state machine]
      G6[Razorpay adapter]
      G7[Payment verification]
      G8[Webhook verification + dedupe]
      G9[Audit + attribution]
    end

    R[Razorpay Test Mode]
    RP[Standard Checkout / Payment]
    DB[(PostgreSQL)]
    J[Judge / Evidence Surfaces]

    U --> B1 --> B2 --> B3
    B3 -->|discover / observe| M1
    B3 -->|read facts| M2
    B3 -->|check availability| M3
    B3 -->|request quote| M4
    B3 -->|read opportunities| M5
    M1 --> B3
    M2 --> B3
    M3 --> B3
    M4 --> B3
    M5 --> B3

    B3 --> B4 --> B5 --> B6
    B6 -->|approved basket| G1
    G1 --> G2 --> G3
    G3 -->|BLOCK| X[Stop before payment]
    G3 -->|ALLOW| G4 --> G5 --> G6 --> R --> RP
    RP --> G7
    R -->|signed webhook| G8
    G8 --> G7
    G7 --> G9
    G9 --> M7
    M7 --> DB
    G5 --> DB
    G8 --> DB
    G9 --> DB

    M6 -->|campaign / cohort intent| B3
    M7 -->|confirmed order / realized uplift| G9
    G9 --> J
    DB --> J
```

### One-line authority model

```text
AI decides WHAT is useful
        ↓
Merchant decides WHAT is true
        ↓
User decides the hard spending boundary
        ↓
MANDATE decides WHETHER money may move
        ↓
Razorpay executes the authorized payment
        ↓
PostgreSQL + verification prove WHAT happened
```

---

## 2. Agent orchestration architecture

The buyer is not a single prompt followed by checkout. It is a bounded observe → reason → tool → validate loop.

```mermaid
flowchart TD
    T[User goal + hard constraints]
    P[Planner / model]
    D[Allowed tool registry]
    E[Deterministic tool executor]
    O[Observed merchant result]
    H[Bounded planner history]
    V[Validation + trace]
    C{Task complete?}
    A[Proposal ready for approval]
    F[Closed failure / safe stop]

    T --> P
    H --> P
    P --> D
    D --> E
    E --> O
    O --> V
    V --> H
    V --> C
    C -->|No| P
    C -->|Yes| A
    P -->|disallowed tool / planner error / step budget exhausted| F
```

### Buyer tool boundary

The buyer agent operates on commerce intent and merchant facts. Payment execution is not part of its tool registry.

Typical model-directed actions include:

```text
discover_merchant
read_catalog / search_products
inspect_product
compare_products
select_product
check_inventory
get_merchant_recommendations
optimize_basket
build_basket
prepare_approval
```

The exact order is model-directed. A tool failure becomes an observation that can cause the planner to choose a different bounded action rather than silently inventing a result.

### Growth agent orchestration

The merchant growth agent uses the same pattern with a payment-blind tool set:

```mermaid
flowchart LR
    O[Merchant objective]
    GP[Growth Agent Planner]
    T1[get_campaign]
    T2[list_opportunities]
    T3[inspect_inventory]
    T4[prepare_offer]
    Q[Fresh merchant quote]
    M[MANDATE authorization]
    R[Razorpay Test Mode]

    O --> GP
    GP --> T1 --> GP
    GP --> T2 --> GP
    GP --> T3 --> GP
    GP --> T4 --> Q
    Q --> M --> R

    GP -.->|payment tools are not exposed| R
```

The Growth Agent can decide which commercial observation/action to take, but the payment authority remains outside the agent.

---

## 3. Trust boundaries

### Zone A — probabilistic / untrusted

**AI buyer + browser**

These components can:

- interpret natural-language requests;
- rank and explain products;
- suggest complementary products;
- collect user approval;
- display checkout state;
- execute bounded agent planning loops.

They cannot:

- change the hard spending limit;
- provide the trusted payment amount;
- call Razorpay using the server secret;
- declare a payment successful;
- confirm a merchant order;
- bypass gateway policy.

### Zone B — commerce truth

**Merchant APIs** own:

- products;
- prices;
- inventory;
- merchant identity;
- checkout quotes;
- merchant-defined recommendation opportunities;
- growth campaign configuration.

The merchant quote is the source of truth for the final basket amount.

### Zone C — trusted control plane

**MANDATE gateway** owns:

- intent validation;
- quote/inventory revalidation;
- financial policy;
- mandate authorization;
- transaction state;
- payment verification;
- webhook verification and dedupe;
- merchant-order confirmation;
- durable audit;
- realized revenue attribution.

### Zone D — payment execution

**Razorpay Test Mode** owns payment execution and payment events. It does not decide whether the user's basket is within the MANDATE policy boundary.

---

## 4. Buyer + merchant growth interaction

The Track 01 value loop is two-sided: the buyer provides autonomous demand, while the merchant provides machine-readable truth and revenue opportunities.

```mermaid
sequenceDiagram
    participant U as User
    participant B as Buyer Agent
    participant M as Merchant Agent/API
    participant G as MANDATE
    participant R as Razorpay

    U->>B: Natural-language shopping goal
    B->>M: Discover + read catalog
    M-->>B: Product / inventory facts
    B->>M: Evaluate recommendation opportunity
    M-->>B: Upsell / cross-sell offer
    B->>B: Compare + optimize within hard limit
    B-->>U: Proposed basket + reasoning
    U->>B: Explicit approval
    B->>G: Approved purchase intent
    G->>M: Fresh quote + current inventory
    M-->>G: Merchant truth
    G->>G: Deterministic policy
    alt Blocked
        G-->>B: Block + reasons
    else Authorized
        G->>R: Create Test Mode order
        R-->>B: Checkout
        U->>R: Complete Test Mode payment
        R-->>G: Payment evidence + webhook
        G->>G: Verify + reconcile
        G->>M: Confirm merchant order
    end
```

This separates **merchant opportunity generation** from **payment authority**. An upsell/cross-sell can increase basket value, but it must still pass explicit buyer approval and the same gateway policy.

---

## 5. Financial authorization boundary

The gateway never treats a model-produced amount as authoritative.

```mermaid
flowchart TD
    I[Approved PurchaseIntent]
    Q[Merchant quote]
    V1[Merchant identity]
    V2[Quote validity]
    V3[Current price]
    V4[Current inventory]
    V5[Quantity limits]
    V6[Line totals]
    V7[Complete basket total]
    V8[User hard spend limit]
    P{All checks pass?}
    B[POLICY BLOCKED]
    A[MANDATE AUTHORIZED]
    R[Create Razorpay Test Order]

    I --> Q --> V1 --> V2 --> V3 --> V4 --> V5 --> V6 --> V7 --> V8 --> P
    P -->|No| B
    P -->|Yes| A --> R
```

### Authorization algorithm

```text
1. Parse and validate PurchaseIntent.
2. Fetch the referenced merchant quote.
3. Verify merchant identity.
4. Verify quote has not expired.
5. Re-read current product prices.
6. Re-read current inventory.
7. Validate line quantities.
8. Validate line totals.
9. Recompute/validate complete basket total.
10. Compare complete total with user's hard spending limit.
11. Validate transaction state / mandate binding.
12. Allow only if every rule passes.
13. Only then create a Razorpay order.
```

This gives the project its central invariant:

> **No policy authorization → no Razorpay order.**

---

## 6. Transaction state machine

```mermaid
stateDiagram-v2
    [*] --> intent_proposed
    intent_proposed --> price_verified
    price_verified --> policy_pending
    policy_pending --> policy_blocked: rule failed
    policy_pending --> policy_authorized: all rules pass
    policy_authorized --> razorpay_order_created
    razorpay_order_created --> checkout_started
    checkout_started --> payment_authorized
    checkout_started --> payment_failed
    payment_authorized --> payment_captured
    payment_captured --> payment_verified
    payment_verified --> order_confirmed
    payment_failed --> [*]
    order_confirmed --> [*]
```

### State-machine invariants

```text
Invalid transition                    → reject
Policy blocked                        → never create Razorpay order
Payment failed                        → terminal attempt
Retry after failure                   → create new transaction
Captured / verified / confirmed       → late failure cannot regress state
Confirmed order                       → idempotent reprocessing only
```

---

## 7. Growth experiment architecture

The growth side is intentionally separated into **potential opportunity**, **approved treatment**, **real payment evidence**, and **realized uplift**.

```mermaid
flowchart TD
    C[Merchant Campaign]
    O[Growth Opportunities]
    GA[Growth Agent]
    OFF[Prepared Offer]
    U[User Approval]
    M[MANDATE Authorization]
    EXP[Experiment Assignment]
    T[Treatment]
    CTRL[Control]
    RP[Razorpay Test Mode]
    V[Independent Settlement Verification]
    MO[Confirmed Merchant Order]
    AT[Attribution]
    OUT[Observed Test Mode AOV / Realized Incremental Revenue]

    C --> O --> GA --> OFF --> U --> M
    M --> EXP
    EXP --> T
    EXP --> CTRL
    T --> RP
    CTRL --> RP
    RP --> V --> MO --> AT --> OUT
```

### What is measured

```text
Potential lift      = catalog / recommendation opportunity
Approved basket     = user-approved commercial intent
Verified payment    = independently checked Razorpay evidence
Realized uplift     = confirmed merchant-order attribution
Observed AOV uplift = treatment/control Test Mode comparison
```

The system deliberately avoids calling a recommendation or unverified browser callback revenue.

---

## 8. Payment lifecycle

The payment lifecycle is deliberately longer than “checkout returned success”.

```mermaid
sequenceDiagram
    participant G as MANDATE Gateway
    participant R as Razorpay
    participant B as Browser
    participant W as Webhook
    participant D as PostgreSQL
    participant M as Merchant

    G->>R: Create Test Mode order
    R-->>G: Razorpay order ID
    G->>D: Persist order reference
    G-->>B: Checkout configuration
    B->>R: Standard Checkout
    R-->>B: Payment identifiers
    B->>G: Verify-payment request
    G->>R: Retrieve / verify payment
    R-->>G: Payment state
    R->>W: Signed webhook
    W->>G: Webhook event
    G->>D: Claim event identity
    G->>D: Persist reconciliation + audit
    G->>M: Confirm merchant order
    M-->>G: Merchant order
    G->>D: Persist realized attribution
```

A browser callback may trigger reconciliation work, but it cannot directly mark the transaction paid or confirmed.

---

## 9. Webhook architecture

The webhook handler applies defense in depth:

```text
Raw request body
      ↓
Signature verification
      ↓
Dedupe identity
      ↓
In-flight duplicate guard
      ↓
Persistent PostgreSQL claim
      ↓
Transaction lookup
      ↓
Payment-state reconciliation
      ↓
Audit event
      ↓
Claim completion
```

If processing fails after a persistent claim, the claim is released so a later legitimate retry can be processed.

---

## 10. Persistence architecture

PostgreSQL is used for durable control-plane evidence:

```mermaid
erDiagram
    TRANSACTION ||--o{ AUDIT_EVENT : has
    TRANSACTION ||--o{ WEBHOOK_EVENT : reconciles
    TRANSACTION ||--o| MERCHANT_ORDER : produces
    EXPERIMENT ||--o{ EXPERIMENT_ASSIGNMENT : contains
    EXPERIMENT_ASSIGNMENT ||--o| TRANSACTION : maps

    TRANSACTION {
      string id
      string state
      int amountPaise
      int baseAmountPaise
      string mandateId
    }
    AUDIT_EVENT {
      string id
      string transactionId
      string eventType
      string createdAt
    }
    WEBHOOK_EVENT {
      string id
      string transactionId
      string eventId
      string processingState
    }
    MERCHANT_ORDER {
      string id
      string transactionId
      int incrementalRevenuePaise
    }
    EXPERIMENT {
      string id
      string campaignId
      string status
    }
    EXPERIMENT_ASSIGNMENT {
      string id
      string experimentId
      string cohort
      string transactionId
    }
```

Runtime state can be hydrated from PostgreSQL on startup. Merchant-order attribution is persisted so revenue reporting does not depend on an in-memory process surviving.

The current reference implementation intentionally leaves some merchant catalog/quote storage lightweight; this is documented as a boundary rather than implying a distributed production catalog.

---

## 11. Multi-protocol control plane

MANDATE is designed so protocol-specific wire details terminate at adapters while the financial authority remains centralized.

```mermaid
flowchart LR
    A[Agent intent]
    P[Protocol Registry / Resolver]
    MN[MANDATE-native]
    ACP[ACP adapter target]
    AP2[AP2 semantic alignment]
    UAP[NPCI UAP adapter-ready profile]
    X402[x402 v2 service adapter]
    MCP[MANDATE MCP Policy Facade]
    CORE[MANDATE Authorization Core]
    RP[Razorpay Test Mode]

    A --> P
    P --> MN
    P --> ACP
    P --> AP2
    P --> UAP
    P --> X402
    P --> MCP
    MN --> CORE
    ACP --> CORE
    AP2 --> CORE
    UAP --> CORE
    X402 --> CORE
    MCP --> CORE
    CORE --> RP
```

Protocol status is intentionally explicit in the repository. Native MANDATE and the x402 experiment are implemented; ACP/AP2/UAP are represented as adapter-target, semantic-alignment or research/adapter-ready surfaces rather than being presented as wire-level integrations that the repository does not actually claim. The unified control plane keeps these protocol concerns from creating separate payment-authority logic.

---

## 12. Judge / evidence architecture

The judge-facing UI is not part of the financial authority. It exposes evidence produced by the trusted backend.

```mermaid
flowchart LR
    G[Gateway]
    DB[(PostgreSQL)]
    RP[Razorpay Test Mode]
    MCP[MCP Verification]
    E1[/demo readiness/]
    E2[/proof/]
    E3[/judge-growth/]
    E4[/policy-lab/]
    E5[/tamper-lab/]
    E6[/webhook-lab/]
    E7[/labs/]

    G --> DB
    G --> RP
    MCP --> RP
    G --> E1
    DB --> E2
    RP --> E2
    G --> E2
    DB --> E3
    RP --> E3
    G --> E4
    G --> E5
    G --> E6
    E1 --> E7
    E2 --> E7
    E3 --> E7
    E4 --> E7
    E5 --> E7
    E6 --> E7
```

### Evidence principle

```text
Browser state                         = presentation only
AI recommendation                     = proposal only
Local synthetic lab event             = security simulation only
Persisted transaction + policy trail  = control-plane evidence
Razorpay Test Mode re-read            = payment evidence
Confirmed merchant order              = revenue evidence
```

---

## 13. Data ownership

| Data | Owner | Durable? | Why |
|---|---|---:|---|
| User request | Buyer | Runtime | Input to model reasoning |
| Model plan | Buyer | Runtime / trace | Planning output, not authority |
| Product / price | Merchant | Merchant service | Commerce truth |
| Inventory | Merchant | Merchant service | Availability truth |
| Checkout quote | Merchant | Current reference implementation is lightweight | Trusted monetary quote source |
| PurchaseIntent | Gateway | PostgreSQL-backed transaction record | Authorization evidence |
| Policy result | Gateway | Audit-backed | Why money was/was not allowed |
| Mandate artifact | Gateway | Transaction/audit-backed | Financial authorization evidence |
| Razorpay order ID | Gateway | Transaction persistence | Link to payment rail |
| Payment state | Gateway + Razorpay | Transaction/audit persistence | Reconciliation evidence |
| Webhook identity | Gateway | PostgreSQL-backed | Replay protection |
| Merchant order | Merchant + gateway | PostgreSQL attribution | Durable outcome |
| Experiment assignment | Merchant/growth flow | PostgreSQL-backed | Treatment/control evidence |
| Revenue attribution | Gateway/merchant operations | PostgreSQL-backed | Potential vs realized revenue |

This ownership model prevents a frontend variable or model response from silently becoming a source of financial truth.

---

## 14. Interfaces

### Merchant

```text
GET  /.well-known/agent-commerce
GET  /api/agent/catalog
GET  /api/agent/products/:id
GET  /api/agent/inventory/:id
POST /api/agent/checkout/preview
GET  /api/agent/checkout/quotes/:id
GET  /api/agent/recommendations?productId=:id&maxSpendPaise=:limit
POST /api/agent/orders/confirm
```

### Buyer agent / growth agent

```text
POST /api/agent/buyer
GET  /api/agent/buyer?runId=<id>
POST /api/agent/growth-agent
GET  /api/agent/growth-agent?runId=<id>
```

### Gateway

```text
GET  /health
POST /v1/purchase-intents
POST /v1/mandates/authorize
POST /v1/transactions/:id/razorpay-order
POST /v1/transactions/:id/checkout-started
POST /v1/transactions/:id/verify-payment
POST /v1/transactions/:id/capture
POST /v1/transactions/:id/retry-payment
GET  /v1/transactions/:id/timeline
GET  /v1/merchant/orders
POST /v1/webhooks/razorpay
```

### Judge surfaces

```text
/golden-path
/live-proof
/proof
/labs
/policy-lab
/tamper-lab
/webhook-lab
/demo
/judge-growth
/growth
/growth-experiment
/growth-attribution
```

---

## 15. Security invariants

```text
LLM → Razorpay API                         forbidden
Browser → payment success state            forbidden
AI → spending-limit modification           forbidden
Client amount → trusted order amount       forbidden
Policy BLOCK → Razorpay order              forbidden
Unverified payment → merchant order        forbidden
Duplicate webhook → duplicate effect       forbidden
Late failure → successful-state regression forbidden
Retry → mutation of the old failed attempt forbidden
Growth Agent → payment authority           forbidden
Synthetic lab event → live payment claim   forbidden
Potential lift → realized revenue claim    forbidden
```

These invariants are reinforced in source, tests and the judge-facing labs.

---

## 16. Why this architecture is suitable for agentic commerce

A human-driven storefront can often rely on the person behind the browser to notice price, identity, inventory and payment mistakes. An autonomous buyer changes the threat model: the software can make decisions at machine speed and the user may not inspect every intermediate action.

MANDATE therefore separates:

```text
Decision quality
      ≠
Financial authority
```

AI gets the flexibility that makes agentic commerce useful. Deterministic systems get the authority that makes monetary actions bounded and auditable.

The merchant-growth layer adds a second separation:

```text
Revenue opportunity
      ≠
Realized revenue
```

A recommendation can be agentically generated, a basket can be approved, and a payment can be executed, but only a verified confirmed merchant order can contribute to realized uplift.

That separation is the core architectural idea of the submission.
