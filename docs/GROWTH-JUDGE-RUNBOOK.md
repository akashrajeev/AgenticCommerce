# Track 01 Growth Judge Runbook

This runbook is the intended final demonstration for AI Growth & Agentic Commerce.

## What the judge should see

The core claim is intentionally narrow:

> The Growth Agent can pursue a merchant revenue objective through bounded commercial actions, while MANDATE remains the authority over money and Razorpay Test Mode provides the payment evidence.

The demo never treats an LLM recommendation, a client callback, or a synthetic fixture as revenue.

## Entry points

```text
http://localhost:3000/growth
http://localhost:3000/growth-experiment
http://localhost:3000/judge-growth
http://localhost:3000/growth-attribution
```

## Sequence

### 1. Agent decision

Open `/growth` and use a source product such as `hp-001`.

Run:

```text
Discover growth opportunities
-> Ask Growth Agent to prepare an offer
```

Show the planner/tool trace. The expected shape is:

```text
campaign
-> get_campaign
-> list_opportunities
-> inspect_inventory
-> prepare_offer
-> prepared offer
```

The agent can stop/replan on tool errors, but its tool registry contains no payment authority.

### 2. Explicit buyer approval

Approve the prepared basket.

The buyer app:

```text
fresh merchant quote
-> signed human-present mandate
-> /v1/mandates/authorize
-> policy revalidation
```

The exact checkout binding is revalidated before authorization. A blocked policy result creates no Razorpay order.

### 3. Treatment/control experiment

Open `/growth-experiment`.

Select equal treatment/control candidates with the same source product composition and persist the experiment.

Rules:

```text
1–20 members per side
same source-product mix
no transaction may belong to both cohorts
assignments persist before launch
```

Treatment receives the campaign identifier. Control does not.

### 4. Launch

Launch both cohorts.

The launch route calls the guarded MCP payment tool only for transactions that already have an active MANDATE authorization.

Every assignment gets durable execution state:

```text
READY
-> PAYMENT_PENDING
-> CONFIRMED
```

or, on failure:

```text
FAILED
-> retry launch for transient order-preparation failures
```

If the underlying payment attempt reaches `payment_failed` or `cancelled`, the execution becomes `RECOVERY_READY`. Recovery requires a fresh transaction/authorization rather than mutating the failed attempt.

### 5. Real Razorpay Test Mode

Complete the generated Standard Checkout flows using developer-supplied Razorpay Test Mode credentials.

A payment contributes to experiment evidence only after the settlement verifier proves:

```text
transaction binding
order ID
payment ID
Razorpay Test Mode
verified settlement
```

### 6. Evidence / uplift

Open `/judge-growth` or `/growth-experiment` after payments settle.

The evidence endpoint computes:

```text
Treatment AOV
Control AOV
Observed AOV uplift %
Realized incremental revenue
Treatment verification rate
Control verification rate
```

The wording is deliberately:

> Observed Test Mode AOV difference.

It is not presented as a causal marketing claim.

## Evidence chain

```text
Growth Agent planner
       |
       v
persisted agent trace
       |
       v
prepared commercial offer
       |
       v
explicit buyer approval
       |
       v
signed MANDATE
       |
       v
fresh merchant quote + deterministic policy
       |
       v
MCP payment tool
       |
       v
Razorpay Test Mode order
       |
       v
Standard Checkout
       |
       v
server-side verification + webhook reconciliation
       |
       v
merchant order
       |
       v
experiment assignment
       |
       v
verified treatment/control AOV
```

## Safety invariants to call out

```text
LLM -> Razorpay                         FORBIDDEN
Growth Agent -> payment authority       FORBIDDEN
Policy BLOCK -> Razorpay order          FORBIDDEN
Frontend -> paid/confirmed state        FORBIDDEN
Unverified payment -> revenue           FORBIDDEN
Failed payment -> same transaction      FORBIDDEN
Synthetic event -> live payment claim   FORBIDDEN
```

## Final judge screen

Use `/judge-growth` for the concise story:

```text
01 AGENT       model-directed growth strategy
02 MANDATE     bounded financial authority
03 TEST MODE   independently verified payment evidence
04 UPLIFT      treatment vs control observation
```

If no real Test Mode payments have been completed yet, the uplift card must remain `—` / `Awaiting enough verified payments` rather than displaying a fabricated number.
