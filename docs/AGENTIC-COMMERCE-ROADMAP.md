# MANDATE — Protocol-Aware Agentic Commerce Build Roadmap

> **Goal:** evolve MANDATE from a strong agentic checkout implementation into a protocol-aware commerce control plane that can support buyer agents, merchant agents, bounded delegation, interoperable checkout, and multiple payment rails without moving financial authority into the LLM.

## 1. Why this roadmap exists

The Track 01 problem is larger than “put an LLM in front of Checkout.” The market is converging on protocol-level infrastructure for agentic commerce and payments:

- ACP defines a standardized merchant checkout interaction model with versioned APIs, authoritative merchant cart state, capability negotiation, authentication/signing, and idempotent retries.
- AP2 focuses on authorization for agent-performed payments using Checkout Mandates and Payment Mandates, including human-present and autonomous modes, cryptographic binding, deterministic verification, and dispute evidence.
- Razorpay is actively shipping agentic-payment experiences, including in-app conversational commerce, UPI Reserve Pay, and a Razorpay MCP server that exposes payment operations to compatible agents.
- NPCI's reported Unified Agent Protocol (UAP) direction is focused on delegated UPI payments with bounded authority, spending rules, identity and liability. No public official UAP technical specification was found during this research pass, so MANDATE will not claim native UAP implementation until an authoritative public specification is available.
- x402 is an HTTP-native machine-payment protocol for paid APIs/services, using HTTP 402 plus payment requirement and signature headers. It is a different payment ecosystem from Razorpay/UPI and should be treated as an optional service-payment adapter rather than a replacement for the current core rail.

The architectural response is **not** to build five disconnected demos. MANDATE should normalize these interaction patterns into one protocol-neutral authorization core.

```text
ACP / AP2 / UAP / x402 / native MANDATE
                  |
                  v
        Protocol Adapter Layer
                  |
                  v
     Normalized Commerce + Mandate
                  |
                  v
        Deterministic MANDATE Core
          /       |        \
     identity   policy    integrity
                  |
                  v
           Payment Adapter
          /       |        \
     Razorpay   future UPI   x402
```

## 2. Non-negotiable implementation rules

### Rule A — No fake protocol integrations

We may build protocol-shaped adapters, but we must clearly label their status:

- **Implemented:** actually speaks the referenced protocol or API and has been exercised.
- **Compatible / aligned:** our object model or flow follows public protocol concepts, but no external interoperability claim is made.
- **Adapter-ready:** internal interface exists for future integration.
- **Not implemented:** no claim.

### Rule B — Real commerce truth

The buyer must continue to consume the real merchant catalog, inventory and quote services. Revenue metrics must be derived from confirmed merchant orders. Razorpay Test Mode remains the current real payment execution rail.

### Rule C — Deterministic financial authority

The LLM may interpret, rank, recommend, negotiate and explain. It may not independently set the final trusted amount, raise a user limit, mark payment success, transition a transaction illegally, or confirm a merchant order.

### Rule D — Every payment is bound to what the user/agent was authorized to buy

The authorization layer must bind the effective payment to merchant, basket, amount, expiry, purpose and policy constraints. A changed basket must require fresh authorization.

### Rule E — Security labs remain explicitly synthetic

Replay, tamper and malformed-input labs may use synthetic adversarial payloads, but the UI and docs must label them as security simulations. They must never be presented as real Razorpay events.

---

# 3. Target architecture

```text
                           HUMAN
                             |
                    intent / constraints
                             |
                             v
                     +---------------+
                     |   BUYER AGENT  |
                     | plan / rank /  |
                     | negotiate      |
                     +-------+-------+
                             |
                    capability discovery
                             |
                             v
                    +-------------------+
                    | PROTOCOL LAYER    |
                    | ACP adapter       |
                    | AP2-style adapter |
                    | UAP adapter-ready |
                    | x402 adapter      |
                    +---------+---------+
                              |
                       normalized intent
                              |
                              v
                  +-------------------------+
                  |    MANDATE CORE         |
                  | identity                 |
                  | mandate validation       |
                  | cart/quote binding       |
                  | deterministic policy     |
                  | state machine            |
                  | payment authorization   |
                  +-----------+-------------+
                              |
                       payment adapter
                       /               \
                      v                 v
             Razorpay Test Mode       x402
                Orders/UPI            services
                      |
                   webhooks
                      |
                      v
              PostgreSQL + audit
                      |
                      v
              merchant order/revenue
```

## 4. Build phases

## Phase 0 — Baseline and contract freeze

**Objective:** protect the working system before introducing protocol work.

### Deliverables

- Freeze the current gateway state machine and policy engine contracts.
- Add regression tests around existing Track 01 behavior.
- Create a protocol capability/version registry.
- Record current APIs and routes as the baseline.
- Add a `PROTOCOL_STATUS.md` page so implementation claims stay explicit.

### Acceptance criteria

```text
Existing buyer flow still works.
Existing Razorpay Test Mode flow still works.
All existing CI stages remain green.
No protocol adapter can bypass the gateway.
```

---

## Phase 1 — Protocol-neutral domain model

**Priority: Highest**

Create a shared package:

```text
packages/protocol/
```

### Core objects

```ts
CommerceIntent
MerchantCapability
MerchantOffer
CheckoutSession
CheckoutSnapshot
UserMandate
CheckoutMandate
PaymentMandate
PaymentAuthorization
PaymentReceipt
AgentIdentity
ProtocolEnvelope
```

### Minimum semantic fields

```text
identity
merchantId
agentId
userId
purpose
items
quantity
amount
currency
quoteId
checkoutId
cartHash
maxSpend
expiresAt
nonce
approvalMode
protocolVersion
```

### Important distinction

Do not copy protocol schemas blindly into the domain model. Normalize only the semantic fields the MANDATE core actually needs, then preserve protocol-specific fields inside adapters.

### Tests

- serialization/deserialization
- schema validation
- amount/currency normalization
- cart hash determinism
- expiry validation
- nonce uniqueness
- unsupported protocol/version rejection

### Result

Every future protocol entry point ends at the same authorization core.

---

## Phase 2 — Agent identity and capability discovery

**Objective:** make MANDATE genuinely discoverable by software agents.

The existing `.well-known/agent-commerce` contract should evolve into a versioned capability document.

### Capability document

Expose real merchant capabilities such as:

```text
catalog
inventory
checkout
recommendations
orders
returns
payments
webhooks
supported protocol adapters
supported currencies
supported payment methods
```

### New concepts

```text
agentId
merchantId
capabilityId
protocolVersion
supportedMethods
supportedExtensions
```

### Security

The capability document must describe capabilities, not grant money authority. Payment authorization still happens later at the gateway.

### Acceptance criteria

A fresh buyer can:

```text
discover merchant
→ read capabilities
→ choose supported commerce protocol
→ start checkout session
```

using the merchant's actual HTTP interface.

---

## Phase 3 — ACP-compatible merchant checkout

**Objective:** add real interoperability with the public ACP checkout contract where practical.

The current ACP repository exposes a dated stable specification; the 2026-04-17 snapshot includes checkout and delegate-payment APIs, while the checkout model uses create, update, retrieve, complete and cancel operations with authoritative merchant cart state, versioning, authentication and idempotency. citeturn287213search0turn678329search5

### Implement

Expose a versioned ACP-compatible surface at the merchant boundary:

```text
POST /checkout_sessions
POST /checkout_sessions/:id
GET  /checkout_sessions/:id
POST /checkout_sessions/:id/complete
POST /checkout_sessions/:id/cancel
```

### Map into MANDATE

```text
ACP checkout session
        ↓
MANDATE CheckoutSession
        ↓
merchant quote
        ↓
MANDATE policy
        ↓
Razorpay adapter
```

### Required safeguards

- idempotency key handling
- request ID/correlation ID
- version negotiation
- authoritative cart response
- merchant-owned totals
- unsupported capability rejection
- safe retry

### Acceptance criteria

A protocol client can create and update a checkout using actual merchant data and receive an authoritative session state without bypassing the existing policy engine.

---

## Phase 4 — Cryptographically bound mandates

**Objective:** turn MANDATE's current hard spending limit into a real reusable delegated authorization model inspired by AP2's public concepts.

AP2 v0.2 separates a **Checkout Mandate** from a **Payment Mandate** and supports direct human-present and autonomous human-not-present flows. It also requires deterministic verification and binds the payment mandate to the checkout using a cryptographic hash. citeturn678329search0turn678329search1

### MANDATE-native objects

```ts
OpenMandate
ClosedCheckoutMandate
ClosedPaymentMandate
MandateReceipt
```

### Example

```json
{
  "mandateId": "mdt_...",
  "agentId": "buyer_...",
  "merchantId": "mandate-market",
  "purpose": "buy ANC headphones",
  "maxSpendPaise": 800000,
  "currency": "INR",
  "checkoutHash": "...",
  "expiresAt": "...",
  "nonce": "...",
  "mode": "AUTONOMOUS"
}
```

### Cryptographic binding

The payment authorization must be invalid if any of these changes after mandate creation:

```text
merchant
basket
quantity
quoted amount
currency
checkout identifier
expiry
```

### Implementation approach

Start with the MANDATE-native representation and verification API. Do **not** claim AP2 wire compatibility until the implementation follows the public AP2 credential/signature requirements closely enough to interoperate.

For an eventual AP2 adapter, study and map:

- `vct` versioning
- open vs closed mandates
- Checkout Mandate → `checkout_hash`
- Payment Mandate → checkout binding
- user authorization
- agent key (`cnf`) in autonomous flows
- receipt references
- dispute evidence

AP2 explicitly recommends deterministic verification and uses signed/verifiable credentials for tamper-evident authorization evidence. citeturn678329search0turn678329search3

### Acceptance criteria

```text
Same mandate + same checkout     → authorized
Same mandate + changed basket   → rejected
Same mandate + higher amount    → rejected
Expired mandate                  → rejected
Wrong merchant                   → rejected
Replay nonce                     → rejected
```

---

## Phase 5 — Autonomous bounded-agent mode

**Objective:** move beyond “click approve every time” while keeping user control explicit.

### User experience

User creates a bounded mandate:

```text
“You may buy office electronics
up to ₹5,000 per purchase,
from approved merchants,
today.”
```

The agent can then execute qualifying purchases without another per-transaction approval.

### Policy evaluation

```text
agent identity
merchant allow-list
purpose
amount
currency
mandate expiry
basket constraints
inventory
quote validity
```

### Required UI

A **Delegated Mandates** panel showing:

```text
Active mandates
Spend remaining
Allowed merchants
Purpose
Expiry
Transactions executed
Transactions blocked
```

### Acceptance criteria

Demonstrate both:

```text
within mandate  → payment allowed
outside mandate → payment blocked
```

No human click should be needed for the within-boundary autonomous case.

---

## Phase 6 — Buyer-agent ↔ merchant-agent negotiation

**Objective:** make agent-to-agent commerce visible and useful.

### Buyer agent

Responsible for:

- intent interpretation
- product search
- ranking
- negotiation criteria
- mandate selection

### Merchant agent

Responsible for:

- inventory-aware offers
- compatible products
- discounts or bundles actually supported by merchant logic
- fulfillment options
- recommendation opportunities

### Negotiation object

```text
Offer
  offerId
  merchantId
  items
  prices
  inventory snapshot
  expiresAt
  rationale
  conditions
```

### Flow

```text
Buyer Agent
  “Find ANC headphones under ₹5,000.”
        ↓
Merchant Agent
  “SoundMax Pro ₹3,999.
   Add travel case for ₹399.”
        ↓
Buyer Agent
  evaluates offer
        ↓
User/mandate permits basket
        ↓
MANDATE
        ↓
Razorpay
```

### Important boundary

The merchant agent may propose an offer but must not be able to force it into the payment authorization path.

---

## Phase 7 — Merchant growth engine becomes a true campaign orchestrator

**Objective:** fully satisfy the merchant-growth side of Track 01 rather than leaving revenue recommendations as a static widget.

### Campaign model

```ts
GrowthCampaign {
  id
  objective
  audienceRule
  trigger
  candidateRules
  budgetConstraint
  status
}
```

### Orchestration loop

```text
campaign objective
      ↓
audience qualification
      ↓
merchant catalog + inventory
      ↓
candidate scoring
      ↓
agent presentation
      ↓
user/mandate acceptance
      ↓
fresh quote
      ↓
policy
      ↓
payment
      ↓
confirmed order
      ↓
realized revenue
```

### Metrics

Only from real merchant/order records:

```text
eligible sessions
recommendations served
recommendations accepted
converted orders
base basket value
incremental basket value
realized uplift
conversion rate
average uplift
```

### Example

```text
Campaign: Headphone → accessory

Trigger: hp-001 selected
Candidate: ms-001

Inventory: available
Buyer remaining budget: sufficient
Recommendation: shown
Approval: accepted
Order: confirmed
Incremental revenue: realized
```

No fabricated totals.

---

## Phase 8 — Razorpay Test Mode as the primary real execution rail

**Objective:** use Razorpay to prove the protocol layer can end in an actual payment.

Razorpay currently describes Agentic Payments for in-app commerce as live in beta and has publicly described UPI Reserve Pay for agentic experiences. Razorpay also documents Test Mode UPI using `success@razorpay` and `failure@razorpay`, making a real domestic UPI success/failure test possible without live funds. citeturn546559search6turn546559search8turn678329search2

### Golden test

```text
AI intent
→ merchant discovery
→ mandate
→ approved basket
→ MANDATE policy
→ Razorpay Test Order
→ Razorpay Standard Checkout
→ UPI test success
→ payment captured
→ webhook
→ verified
→ merchant order
→ realized revenue
```

### Failure test

```text
same basket
→ spend/mandate violation
→ BLOCK
→ no Razorpay order
```

### Webhook requirements

Razorpay documents Test Mode webhooks and recommends webhook-driven automation supplemented by API verification for critical immediate status; webhook signatures must be validated and webhook ordering/idempotency need explicit handling. citeturn425582search4turn425582search5

The current MANDATE webhook implementation should remain the trusted reconciliation boundary.

---

## Phase 9 — Razorpay MCP integration experiment

**Objective:** make MANDATE compatible with the emerging tool-native payment experience without moving the authorization boundary into the model.

Razorpay's official MCP server currently exposes 35+ tools across payments, orders, refunds, payment links, QR codes, settlements, payouts and Standard Checkout, and Razorpay documents test/live mode selection through the corresponding API keys. citeturn678329search4turn546559search1

### Correct architecture

```text
AI agent
   ↓
MCP tool request
   ↓
MANDATE authorization layer
   ↓
Razorpay operation
```

### Incorrect architecture

```text
LLM
 ↓
Razorpay MCP
 ↓
create payment
```

### Build target

Provide an internal tool facade where agent requests such as:

```text
create order
fetch order
fetch payment
capture payment
```

are converted into **authorization requests**, not direct execution calls.

### Acceptance criteria

Any payment-changing tool invocation must be rejected unless a valid MANDATE authorization exists.

---

## Phase 10 — x402 agent-to-service experiment

**Objective:** demonstrate that the same authorization core can protect agent-to-service purchases, not just physical-product checkout.

x402 uses HTTP `402 Payment Required` to communicate payment requirements and `PAYMENT-SIGNATURE` to carry the client's signed payment payload; it is explicitly designed for machine-to-machine and agent payments. Current v2 is the recommended protocol generation. citeturn425582search0turn425582search2turn425582search7

### Build one real paid capability

For example:

```text
POST /api/agent/product-analysis
```

Without payment:

```text
402 Payment Required
PAYMENT-REQUIRED: ...
```

The agent then sends a payment authorization through the x402 adapter.

### Important scope

This should be implemented only if we can use a real compatible testnet/facilitator path. Otherwise leave the adapter interface + protocol documentation and do not fake settlement.

### Result

```text
Agent
 ↓
paid API
 ↓
MANDATE authorization
 ↓
x402 settlement
 ↓
service response
```

This gives the submission a true **agent-to-service commerce** example.

---

## Phase 11 — UAP adapter-ready Indian payment path

**Objective:** explicitly address the India-specific protocol race without making unsupported interoperability claims.

Current reporting says NPCI is developing UAP for agentic UPI payments, including small routine payments without approval on every transaction, with rule-based payments, spending limits, identity checks and liability provisions. The reporting also describes an expected rollout around the Global Fintech Fest. citeturn287213news67

### What we build now

```text
UAPAdapter interface
  ↓
AgentIdentity
DelegatedAuthority
SpendLimit
MerchantBinding
PaymentInstruction
PaymentReceipt
```

### What we do not claim

```text
Native NPCI UAP implementation = NOT CLAIMED
```

until an authoritative public specification or integration path is available.

### Why this still matters

Our mandate model, agent identity, bounded delegation, deterministic policy and audit trail are already architecturally aligned with the problem UAP is reported to address.

---

## Phase 12 — Multi-protocol interoperability matrix

Create a live compatibility matrix in the app and docs:

| Layer | Native MANDATE | ACP | AP2 | UAP | x402 | Razorpay |
|---|---|---|---|---|---|---|
| Intent | ✓ | ✓/adapter | ✓ concept | adapter-ready | ✓ service request | n/a |
| Merchant discovery | ✓ | ✓ | outside scope | adapter-ready | discovery extension | n/a |
| Checkout | ✓ | ✓ | references commerce protocol | adapter-ready | n/a | Orders/Checkout |
| Mandate | ✓ | delegated payment extension | ✓ | adapter-ready | optional receipt/idempotency | execution support |
| Payment | ✓ | merchant PSP | protocol-neutral | UPI target | stablecoin/API | ✓ |
| Verification | ✓ | protocol-defined | deterministic | adapter-ready | facilitator | ✓ |
| Audit | ✓ | order/webhook | cryptographic evidence | target | receipts/extensions | webhooks |

The matrix must distinguish actual implementation from alignment/adapter readiness.

---

# 5. Test plan

Every phase needs tests at four levels.

## A. Unit tests

Protocol objects, hashes, validators, policy rules, adapters.

## B. Contract tests

Validate HTTP requests/responses against the protocol adapter's public contract.

## C. Adversarial tests

```text
changed cart
changed amount
changed merchant
expired mandate
replayed mandate
reused nonce
wrong agent
invalid signature
missing idempotency key
duplicate webhook
late event
unauthorized MCP operation
```

## D. End-to-end tests

```text
human-present checkout
bounded autonomous checkout
merchant recommendation
Razorpay Test UPI success
Razorpay Test UPI failure
webhook reconciliation
restart recovery
revenue attribution
```

---

# 6. Demo strategy

The final flagship demo should not show ten disconnected pages.

Use one continuous scenario:

```text
1. User creates a bounded mandate.
2. Buyer agent discovers Mandate Market.
3. Merchant agent returns product + complementary offer.
4. Agent builds checkout.
5. MANDATE binds checkout to mandate.
6. ₹5,000 policy case is rejected.
7. Valid bounded case is authorized.
8. Razorpay Test UPI payment succeeds.
9. Webhook reconciles it.
10. Merchant order is confirmed.
11. Growth console shows realized uplift.
12. The same event is replayed and deduped.
13. Gateway restarts and state remains.
```

Then a short interoperability slide:

```text
ACP = commerce interaction
AP2 = authorization semantics
UAP = Indian UPI direction
x402 = agent-to-service payment
Razorpay = current execution rail
MANDATE = deterministic authorization/control plane
```

---

# 7. Documentation to add alongside implementation

```text
docs/
├── AGENTIC-COMMERCE-ROADMAP.md      # this document
├── PROTOCOL-INTEROPERABILITY.md     # protocol comparison + status matrix
├── MANDATE-PROTOCOL.md              # normalized internal protocol
├── MANDATE-SPEC.md                  # object schemas + verification algorithms
├── AGENT-IDENTITY.md                # identity/capability discovery
├── DELEGATED-MANDATES.md            # human-present + autonomous modes
├── ACP-ADAPTER.md                   # exact ACP mapping
├── AP2-ALIGNMENT.md                 # exact AP2 concepts vs MANDATE
├── UAP-READINESS.md                 # India/UAP status without overclaiming
├── X402-EXPERIMENT.md                # real service-payment experiment
├── RAZORPAY-MCP.md                   # MCP guardrails and test setup
├── VERIFICATION.md                   # tested evidence
├── FINAL-DEMO.md                     # judge flow
└── evidence/                         # sanitized real-test artifacts/screenshots
```

---

# 8. Definition of done

The protocol-aware MANDATE build is considered complete when:

```text
✓ A merchant is machine-discoverable.
✓ A buyer agent can negotiate a real checkout.
✓ A user can issue a bounded mandate.
✓ A bounded autonomous purchase can execute without a per-purchase click.
✓ The exact checkout is cryptographically bound to authorization.
✓ The gateway remains the deterministic money boundary.
✓ A real Razorpay Test Mode payment proves execution.
✓ UPI Test Mode success/failure is demonstrated where supported.
✓ Webhooks are verified and deduplicated.
✓ Merchant order + realized revenue are persisted.
✓ ACP-compatible checkout is exercised or explicitly marked adapter-ready.
✓ AP2-style mandate semantics are implemented without falsely claiming wire-level AP2 interoperability.
✓ UAP is explicitly covered as adapter-ready until an authoritative public specification is available.
✓ x402 is either implemented with a real testnet/facilitator path or clearly left as adapter-ready.
✓ Razorpay MCP cannot bypass MANDATE policy.
✓ Adversarial tests cover mandate, quote, identity and replay attacks.
✓ README/docs describe the same architecture as the code.
```

---

# 9. Research references

### ACP

ACP's public repository provides dated OpenAPI/JSON Schema snapshots. The 2026-04-17 release includes checkout and delegate-payment specifications. The checkout API uses create/update/retrieve/complete/cancel semantics, authoritative merchant cart state, versioning, authentication/signing and idempotent retries. citeturn287213search0turn678329search5

### AP2

AP2 v0.2 defines roles, Checkout Mandates, Payment Mandates, receipts, direct/human-present and autonomous/human-not-present modes, deterministic verification, cryptographic checkout binding and dispute evidence. citeturn678329search0turn678329search1turn678329search3

### Razorpay Agentic Payments

Razorpay currently presents Agentic Payments for in-app commerce as live in beta, describes UPI Reserve Pay for consent-based pre-authorized agent transactions, and documents agentic experiences with conversational discovery and payment. citeturn546559search6turn546559search8turn546559search0

### Razorpay Test Mode and Webhooks

Razorpay documents Test Mode UPI IDs `success@razorpay` and `failure@razorpay`, Test Mode webhooks, signature validation, idempotency considerations and API verification as a supplement to webhook-driven automation. citeturn678329search2turn425582search4turn425582search5

### Razorpay MCP

Razorpay's official MCP Server exposes 35+ tools for payments and related operations, supports both remote and local deployment, and uses Test/Live API keys to select the environment. citeturn678329search4turn546559search1

### NPCI UAP

Public reporting on 1 September 2026 describes NPCI's Unified Agent Protocol initiative for bounded agentic UPI payments with spending limits, rules, identity and liability controls. This roadmap intentionally treats UAP as **adapter-ready / research-aligned** until an authoritative public technical specification is available. citeturn287213news67

### x402

x402 is an open HTTP-native payment protocol for machine/client payments. Its current v2 flow uses `402 Payment Required`, `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE`, with facilitator-based verification/settlement and support for agent-to-service payments. citeturn425582search0turn425582search2turn425582search7

---

# 10. The strategic thesis

The project's final positioning should be:

> **MANDATE is not another checkout protocol and not an LLM with access to a payment API. It is a protocol-aware authorization and commerce control plane: buyer and merchant agents can discover, negotiate and assemble transactions; users can delegate bounded authority; protocol adapters translate external commerce/payment semantics; and the deterministic MANDATE core decides whether money may move. Razorpay is the current real payment rail, while ACP/AP2/UAP/x402 are interoperability directions or adapters with explicitly stated implementation status.**

That is the north-star architecture for the remaining build.
