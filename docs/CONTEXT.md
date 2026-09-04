# MANDATE Context

Future Codex sessions must read this file before modifying architecture or implementing major features. Repository docs are more authoritative than conversation memory.

## Project
MANDATE

## Purpose
Agentic commerce platform for Razorpay Track 01: AI Growth & Agentic Commerce.

## Core Principle
"The AI has intelligence, but it does not have payment authority."

## Current Architecture
AI Buyer -> Merchant Discovery -> Agent-readable Catalog -> Model-backed Product Decision -> Merchant Revenue Opportunity -> Agent Negotiation -> ACP Checkout Session -> Signed MANDATE Authorization -> Deterministic Policy Engine -> Transaction Authority -> Razorpay Test Mode -> Server Verification -> Webhooks -> Merchant Order -> Audit Trail

For delegated/autonomous buying:

User -> Delegated Mandate -> Buyer Agent -> Merchant Agent -> Merchant Quote/Offer -> MANDATE Boundary -> Transaction Authority -> Razorpay

For growth:

Merchant Campaign -> Growth Agent -> Live Opportunities -> Inventory -> Fresh Offer -> Persistent Agent Trace -> Buyer/User Approval -> Fresh Merchant Quote -> MANDATE Policy -> Transaction Authority -> Razorpay Test Mode -> Verified Campaign Attribution

## Trust Zones
1. AI / probabilistic: reads merchant data and proposes/ranks purchases. It cannot authorize payment or expand authority.
2. Agent commerce / merchant zone: buyer and merchant agents exchange intents/offers backed by live merchant facts. Merchant growth recommendations are commercial proposals, not payment authorizations.
3. MANDATE trusted control plane: verifies mandates, verifies merchant-issued offers, binds checkout state, revalidates product/inventory/quote, enforces deterministic policy, owns transaction state, creates Razorpay orders, verifies payments/webhooks and confirms merchant orders.
4. Razorpay payment rail: Test Mode Orders, Standard Checkout, Payments, capture and Webhooks.

## Security Invariants
- LLM -> Razorpay = FORBIDDEN.
- ACP client -> Razorpay = FORBIDDEN.
- Buyer agent -> Razorpay = FORBIDDEN.
- Merchant agent -> Razorpay = FORBIDDEN.
- Growth agent -> payment authority = FORBIDDEN.
- Frontend -> PAID = FORBIDDEN.
- Unverified payment -> confirmed order = FORBIDDEN.
- Policy BLOCK -> Razorpay order = FORBIDDEN.
- AI -> spending limit modification = FORBIDDEN.
- Razorpay API secret and webhook secret remain server-side.
- Checkout signature verification is performed by the gateway.
- Webhook signatures use the raw request body.
- Duplicate webhook events are idempotently handled.
- Webhook ordering is not assumed.
- Merchant order confirmation is performed by the trusted gateway.
- A signed mandate binds the exact merchant checkout identifier, cart, amount, currency and expiry.
- A successful mandate nonce cannot authorize a different checkout.
- ACP completion cannot bypass MANDATE authorization.
- A delegated agent cannot change its own mandate limits, merchants, products or expiry.
- Delegated spending is reserved before execution and counted as spent only after authoritative confirmation.
- An accepted merchant offer must match the merchant-issued negotiation record before a delegated authorization is created.
- Growth recommendations cannot directly authorize or create payment orders.
- Growth baskets are freshly quoted and pass through the same deterministic gateway policy as normal purchases.
- Growth agent tool names are allow-listed; an unregistered function call fails closed before tool execution.
- Growth agent planner steps are hard-bounded by `maxSteps`.
- Growth agent uses application-owned bounded planner history with OpenAI `store: false`.
- Growth Agent persistence contains run/trace evidence only; it does not confer payment authority.
- Buyer approval of a Growth Agent offer re-fetches a fresh merchant quote before entering MANDATE.

## Implemented

### Merchant
- Modern ecommerce storefront at `apps/merchant`.
- Structured catalog and seeded products.
- Agent-readable manifest at `/.well-known/agent-commerce`.
- Agent catalog/product/inventory endpoints.
- Deterministic checkout preview and quote generation.
- Quote revalidation endpoint.
- Trusted merchant-order confirmation endpoint.
- Merchant operations console at `/operations`.
- Transaction detail/audit view at `/operations/transactions/:id`.
- Agent-readable deterministic revenue recommendations.
- Merchant-agent negotiation endpoint at `/api/agent/negotiate`.
- Merchant negotiation attestation endpoint at `/api/agent/negotiate/:id`.
- Merchant stores the exact offer set long enough for gateway attestation in the current single-node demo.
- Agent-readable growth opportunity endpoint at `/api/agent/growth-opportunities`.
- Growth opportunities combine recommendation scoring with real bundle quotes, projected basket value, incremental item value and budget fit.
- Growth capability and endpoint are published in the merchant manifest.
- ACP-shaped checkout session create/retrieve/update/complete/cancel endpoints.
- ACP completion forwards signed mandate authorization to the gateway and returns a Razorpay Test Mode order reference as `ready_for_payment` rather than falsely claiming payment success.
- Growth Agent Phase B.1: model-directed, one-tool-at-a-time orchestration over a strictly allow-listed merchant growth tool registry.
- Growth Agent planner uses OpenAI Responses function calling with `store: false`; the application retains bounded planner history locally.
- Growth Agent records planner model/call IDs on each tool trace step and returns tool failures to the planner for bounded replanning.
- Growth Agent API at `/api/agent/growth-agent`.
- Growth Agent Phase C: run snapshots and tool steps are durably checkpointed to PostgreSQL with an atomic run/step transaction.
- Growth Agent API can recover persisted runs after merchant-process restart and merges durable runs with live in-memory runs.
- Merchant growth-agent persistence tests are isolated from PostgreSQL with an explicit test-only disable flag.

### Buyer
- Modern transaction workspace UI.
- Model-backed structured purchase planning.
- Buyer planner reads merchant manifest/catalog over HTTP.
- Model output constrained with JSON Schema and live-product validation.
- Hard spending limit supplied by application, not the model.
- Live Razorpay Standard Checkout launcher.
- Failed-payment recovery flow creates a fresh transaction.
- Delegated-authority workspace at `/delegated-mandates` with mandate creation, budget view, autonomous execution, allow/block feedback and revocation.
- Buyer-agent negotiation API at `/api/agent/negotiate`.
- Negotiation console at `/negotiation` showing intent -> merchant offers -> buyer selection -> gateway acceptance -> Razorpay Test Mode.
- Growth approval workspace at `/growth` showing recommendations, incremental value, projected basket and budget fit before routing the approved basket to the gateway.
- Growth workspace can invoke the merchant Growth Agent, display its planner/step trace, adopt its prepared line items, and require explicit buyer approval before fresh quote revalidation and MANDATE routing.

### Gateway
- Deterministic policy engine with budget, quantity, inventory, merchant, quote-validity and amount-integrity checks.
- Server-side merchant revalidation.
- Strict transaction state machine.
- Transaction/audit timeline.
- Real Razorpay REST adapter.
- Razorpay order creation, payment retrieval, capture and verification.
- Raw-body webhook endpoint with signature validation and PostgreSQL dedupe.
- Late/out-of-order payment failure handling.
- Safe failed-payment retry endpoint.
- Merchant order reconciliation after payment verification.
- Signed Ed25519 user-mandate verification.
- SHA-256 canonical checkout/cart binding.
- Mandate nonce replay protection.
- Mandate authorization attached to and persisted with transactions.
- Internal MANDATE authorization endpoint at `/v1/mandates/authorize`.
- Internal mandate-gated Razorpay order endpoint at `/v1/mandates/:authorizationId/razorpay-order`.
- Reusable delegated mandate model with per-purchase and total budget limits.
- Merchant/product allow-lists, expiry and revocation.
- Atomic PostgreSQL budget reservation and delegated execution ledger.
- Delegated execution API at `/v1/delegated-mandates/:mandateId/execute`.
- Delegated mandate inspection/revocation APIs.
- Settlement boundary for delegated executions.
- Negotiated offer acceptance API at `/v1/negotiations/:negotiationId/accept`.
- Merchant-issued offer attestation and authoritative quote revalidation before acceptance.
- Negotiated acceptance is routed into the existing delegated mandate authorization core rather than creating a separate payment authority.
- Negotiated acceptance replay handling plus idempotency conflict detection.
- Prisma persistence models and integration coverage for durable Growth Agent run/step evidence.

### Shared contracts
- `packages/types` contains normalized commerce, growth, negotiation, mandate, authorization and delegated execution types.
- `packages/schemas` contains corresponding Zod validation schemas.

### Infrastructure and validation
- Dockerfiles for merchant, buyer and gateway.
- Docker Compose services for PostgreSQL, merchant, buyer and gateway.
- CI workflow: install, typecheck, unit tests and build.
- Gateway regression tests cover deterministic policy behavior, Razorpay signature validation, payment recovery, mandate binding/replay, delegated budget/revocation boundaries, merchant offer attestation and negotiation idempotency.
- Merchant growth-agent tests cover model-selected ordering, recoverable tool failures, hard step budgets and payment-authority exclusion using planner injection without API credentials.
- Gateway Prisma smoke tests cover transaction/audit/webhook/campaign evidence persistence and Growth Agent run/step durability.

## Persistence Boundary
PostgreSQL is the durable gateway backing store when `DATABASE_URL` is configured. Gateway startup hydrates transactions, audit events and delegated mandates/executions into runtime maps.

Persistent gateway state includes:

```text
transactions
  + mandate_authorization JSONB

audit_events
webhook_events
merchant_orders
delegated_mandates
delegated_mandate_executions
growth_agent_runs
growth_agent_steps
```

The Growth Agent execution process also writes its run/step checkpoints to the shared PostgreSQL database. Run and step writes are transactionally grouped so a persisted step is associated with the corresponding run snapshot.

Delegated budget reservations use an atomic SQL update so multiple gateway instances cannot reserve more than the remaining total budget.

Merchant negotiation state is currently in-memory on the merchant app. Production horizontal scaling should persist negotiation sessions and offer attestations.

Merchant growth opportunity state itself is recomputed from current catalog/recommendation data; opportunity IDs and quote records are demo-runtime artifacts. The final checkout transaction remains gateway-owned.

Merchant quote and ACP checkout-session stores remain in-memory and separate from gateway durability.

Growth Agent run/trace state is now durable when `DATABASE_URL` is configured; the merchant keeps an in-memory execution view for the active process and uses PostgreSQL for restart recovery and judge-visible evidence.

## Failure Recovery Contract
- Policy block is terminal and creates no Razorpay order.
- Payment failure is terminal for that attempt.
- Payment retry creates a new transaction and re-runs merchant/policy validation.
- Late failed-payment observations after successful evidence do not regress state.
- Duplicate webhook deliveries do not duplicate state transitions.
- Changed ACP checkout bindings invalidate authorization.
- Replayed signed mandate nonces are rejected for different checkouts.
- Delegated executions that fail before payment-order creation release their budget reservation.
- Delegated payment attempts remain `reserved` until the underlying transaction reaches `order_confirmed` or `payment_failed`/`cancelled`, at which point the reservation is settled.
- A merchant offer amount/item/merchant/quote change is rejected before delegated authorization.
- Reusing an acceptance key with a different offer payload returns an idempotency conflict and does not create another transaction.
- Growth approval re-fetches a live bundle quote before creating the gateway transaction intent.
- Growth agent tool failures are surfaced to the planner, but planner/tool execution is still bounded by `maxSteps` and allow-listed tool names.
- Growth Agent persistence failure fails the growth run closed rather than silently executing an untracked offer.

## ACP / Phase 4 Flow
ACP client
-> merchant `/checkout_sessions`
-> authoritative merchant quote + cart hash
-> signed user mandate
-> merchant mandate bridge
-> gateway Ed25519 verification
-> mandate expiry/identity/spend/merchant/product checks
-> fresh merchant quote/product/inventory
-> deterministic policy
-> transaction mandate authorization
-> Razorpay Test Mode order
-> ACP returns `ready_for_payment`
-> Standard Checkout / verify-payment / capture / webhook
-> payment verified
-> merchant order confirmed

## Phase 5 Delegated / Autonomous Flow
User issues a reusable delegated mandate:

```text
purpose
agent
merchant allow-list
product allow-list
max spend per purchase
total budget
expiry
constraints
```

The buyer agent then executes qualifying purchases without a new approval prompt:

```text
agent request
-> live merchant quote
-> canonical cart hash validation
-> delegated mandate boundary
-> atomic budget reservation
-> MANDATE transaction authorization
-> Razorpay Test Mode order
```

Budget accounting is:

```text
remaining = totalBudget - spent - reserved
```

A purchase outside any hard boundary is blocked before authorization/order creation.

Buyer demo page:

```text
http://localhost:3001/delegated-mandates
```

Judge-facing sequence:

```text
Issue mandate: ₹10,000 total / ₹5,000 per purchase / hp-001 only
        ↓
Run 1 × approved product
        ↓
ALLOWED + reservation
        ↓
Run 2 × approved product
        ↓
BLOCKED: per-purchase limit
        ↓
Revoke mandate
        ↓
Further execution BLOCKED
```

## Phase 6 Agent Negotiation Flow

The buyer and merchant agents can exchange a bounded commercial intent and quote-backed offers:

```text
Buyer Agent
  -> intent + hard budget
Merchant Agent
  -> live catalog/inventory
  -> quote-backed offers
Buyer Agent
  -> deterministic offer evaluation
  -> selected offer
Gateway
  -> merchant-issued offer attestation
  -> authoritative quote revalidation
  -> delegated mandate boundary
  -> transaction authorization
  -> Razorpay Test Mode
```

Buyer demo page:

```text
http://localhost:3001/negotiation
```

Judge-facing sequence:

```text
Issue demo delegated mandate
        ↓
“Find the best ANC headphones under ₹5,000”
        ↓
BUYER AGENT: intent
        ↓
MERCHANT AGENT: multiple live offers
        ↓
BUYER AGENT: selects offer
        ↓
MANDATE GATEWAY: accepts + authorizes
        ↓
Razorpay Test Order
```

Tamper proof:

```text
selected offer
  + change amount by ₹1
        ↓
merchant offer attestation mismatch
        ↓
NO delegated authorization
NO Razorpay order
```

## Phase 7 Growth Flow

The merchant can expose growth opportunities from a selected product:

```text
base product
-> recommendation score
-> upsell/cross-sell rationale
-> live bundle quote
-> projected basket
-> incremental item value
-> budget fit
```

Buyer page:

```text
http://localhost:3001/growth
```

Judge-facing sequence:

```text
SoundMax Pro
        ↓
Merchant recommends Arc Precision Mouse
        ↓
+ incremental basket value
        ↓
Projected bundle quote
        ↓
BUDGET FIT
        ↓
Growth Agent prepares quote-backed offer
        ↓
Planner / tool trace is shown
        ↓
User clicks “Approve & route through MANDATE”
        ↓
Fresh merchant quote
        ↓
Deterministic gateway policy
        ↓
ALLOWED or BLOCKED
        ↓
Razorpay Test Mode
        ↓
Independently verified campaign payment evidence
```

The growth layer does not claim a trained uplift model. Recommendations remain deterministic catalog intelligence. The financial control boundary remains unchanged.

## Phase B.1 Agent-Directed Growth Loop

The current merchant growth agent uses the OpenAI Responses API to choose the next tool from the exact server-defined registry:

```text
Merchant campaign objective
        ↓
OpenAI function call
        ↓
ALLOWLIST VALIDATION
        ↓
execute ONE merchant tool
        ↓
trace result
        ↓
function_call_output
        ↓
OpenAI chooses next tool
        ↓
repeat until prepare_offer / failure / maxSteps
```

Current tools:

```text
get_campaign
list_opportunities
inspect_inventory
prepare_offer
```

The planner is explicitly forbidden from payment authority. Any unregistered tool call fails before execution.

## Phase C Durable Growth Evidence

The Growth Agent now persists:

```text
GrowthAgentRun
  -> objective / campaign / spend bound / state / planner metadata
  -> selected opportunity
  -> prepared offer

GrowthAgentStep[]
  -> step order
  -> selected tool
  -> reason
  -> inputs / outputs
  -> planner call ID / model
  -> status / error
  -> start/end/duration
```

The merchant growth API can retrieve a persisted run even when the active process no longer has that run in memory. The persistence path fails closed: if checkpointing cannot be completed, the agent run is marked failed rather than continuing with an untracked offer.

The buyer `/growth` workspace can call the Growth Agent, display its actual step trace, and then use the agent-produced line items for the approval flow. Approval still creates a fresh quote before the gateway purchase intent, so the agent never controls the final payment amount.

## Current Limitations
- Merchant negotiation state, merchant quote state and ACP checkout-session persistence are still in-memory.
- Delegated mandate creation/revocation is currently a demo-facing trusted control endpoint; a production deployment needs authenticated user/session identity and stronger multi-tenant authorization.
- Persistent mandate nonce uniqueness for cryptographic Phase 4 authorizations remains transaction-backed but a horizontally scaled production implementation should use a dedicated database uniqueness boundary.
- Merchant-agent offer authentication/signing is not yet implemented; current gateway attestation uses the merchant's internal service boundary and exact stored offer comparison.
- Buyer/merchant negotiation is protocol-neutral demo infrastructure; full external A2A protocol conformance is not claimed.
- Growth opportunities are deterministic catalog recommendations rather than learned conversion propensity or experiment-backed uplift estimates.
- The Docker/Test Mode path still needs real local verification with developer-supplied Test credentials and public webhook delivery.
- Buyer UI should refresh/poll after webhook-only payment state changes.
- Full ACP wire conformance is not claimed.
- AP2 wire interoperability is not claimed.
- The current Growth Agent demo always uses an application-selected merchant campaign; production campaign scheduling/targeting remains future work.

## Next Step
Execute a real Test Mode campaign cohort from the Growth Agent offer flow, persist independently verified Razorpay Test Mode payment evidence with the campaign identifier, and calculate realized incremental revenue/uplift against a control cohort without claiming causal significance beyond the observed test data.
