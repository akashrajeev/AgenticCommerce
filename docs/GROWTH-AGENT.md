# Growth Agent — Phase B

Phase B introduces the first real orchestration boundary for MANDATE merchant growth. It is intentionally separated from payment execution.

## What is implemented

The merchant now has a bounded `GrowthAgent` execution core with:

- explicit run state;
- a fixed, auditable tool registry;
- step-by-step tool execution;
- hard `maxSteps` validation;
- campaign and opportunity observation from current merchant state;
- inventory validation before offer preparation;
- fresh bundle quote generation from the merchant catalog;
- an append-only in-process execution trace for the current runtime;
- an HTTP endpoint for judge/UI integration.

The current tool surface is:

```text
get_campaign
list_opportunities
inspect_inventory
prepare_offer
```

There is deliberately no Razorpay, payment, capture, order-paid or payment-status tool in the Growth Agent registry.

## Current orchestration

```text
Campaign goal
    ↓
get_campaign
    ↓
list_opportunities
    ↓
inspect_inventory
    ↓
prepare_offer
    ↓
OFFER_READY
```

The agent can fail closed when the campaign has no eligible opportunity or the bundle exceeds the configured budget. A hard maximum step count prevents unbounded execution.

## API

```text
POST /api/agent/growth-agent
GET  /api/agent/growth-agent?runId=<id>
GET  /api/agent/growth-agent
```

Example request:

```json
{
  "objective": "Increase basket value for headphone purchases",
  "campaignId": "headphone-aov",
  "maxSpendPaise": 800000,
  "maxSteps": 8
}
```

The response is explicitly marked `testModeOnly` and `advisoryUntilAuthorization`. Preparing an offer does not create a transaction or Razorpay order.

## Why this boundary exists

The Growth Agent is allowed to decide which commercial opportunity is worth pursuing. It is not allowed to decide whether money may move.

```text
Growth Agent
    ↓
commercial proposal
    ↓
MANDATE authorization
    ↓
deterministic policy
    ↓
Razorpay Test Mode
```

## Next phase

Phase B is deliberately incremental. The next engineering step is to replace the fixed transition sequence with a model-directed tool-selection loop while retaining the same allow-listed tools, step budget and deterministic validators. After that, trace persistence can be moved from the current runtime store into durable PostgreSQL evidence before campaign execution is connected to real Test Mode uplift measurement.

No synthetic payment is used by this feature.
