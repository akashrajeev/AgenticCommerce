# Growth Agent — Phase B.1

Phase B.1 replaces the fixed growth-tool sequence with a model-directed, bounded tool-selection loop. The model can choose the next commercial observation/action, but the executor remains deterministic and payment-blind.

## What is implemented

The merchant now has a bounded `GrowthAgent` execution core with:

- explicit run state and planner-call count;
- an allow-listed growth tool registry exposed to the model as function tools;
- one-tool-at-a-time Responses API planning;
- strict empty-object tool arguments for the current tool set;
- server-side tool-name validation before execution;
- hard `maxSteps` validation;
- bounded planner history managed by the application with `store: false`;
- step-by-step trace containing model/call metadata;
- campaign, opportunity and inventory observation from current merchant state;
- fresh bundle quote generation from current catalog facts;
- recoverable tool failures returned to the model as `function_call_output` so it can choose a different bounded action;
- a HTTP endpoint for judge/UI integration.

The current tool surface is:

```text
get_campaign
list_opportunities
inspect_inventory
prepare_offer
```

There is deliberately no Razorpay, payment, capture, order-paid or payment-status tool in the Growth Agent registry.

## Model-directed orchestration

The production loop is:

```text
Campaign objective + current run state
              ↓
       OpenAI Responses API
              ↓
       choose ONE tool call
              ↓
     server validates tool
              ↓
        execute tool
              ↓
   append result to bounded trace
              ↓
   return function_call_output
              ↓
       model chooses again
              ↓
        ... up to maxSteps
              ↓
         prepare_offer
              ↓
        OFFER_READY / COMPLETED
```

The model receives the objective and hard run constraints on every planner turn. Previous Responses output items and tool results are retained in an application-owned bounded history; the request uses `store: false`.

`parallel_tool_calls` is disabled so the agent has a single deterministic action point per step.

## Tool semantics

### `get_campaign`

Reads the configured merchant campaign and establishes its objective, strategy and source categories.

### `list_opportunities`

Reads the current eligible growth opportunities. When a run has a hard basket limit, opportunities whose current source + target price exceeds that limit are excluded.

### `inspect_inventory`

Checks current source/target availability. It cannot change inventory or authorize payment.

### `prepare_offer`

Generates a fresh merchant quote from the current catalog. The returned amount is merchant-derived and the action creates no payment order.

## Failure behavior

A tool failure is recorded in the trace and returned to the planner as a tool result. The planner may choose another allow-listed tool. The run is still bounded by `maxSteps`.

Examples:

```text
prepare_offer too early
        ↓
GROWTH_AGENT_OPPORTUNITY_NOT_SELECTED
        ↓
planner receives error
        ↓
list_opportunities
        ↓
inspect_inventory
        ↓
prepare_offer
```

A planner error, disallowed tool request or exhausted step budget fails the run closed. No payment execution follows.

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

## Security boundary

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

The planner cannot add a payment tool: the server checks the selected function name against the exact allow-list before any executor dispatch.

## Tests

The merchant agent test suite covers:

```text
a. model-selected tool ordering
b. recoverable tool failure → planner chooses another tool
c. empty payment-blind tool registry
 d. hard max-step bound
 e. disallowed planner tool request
```

The tests inject a planner rather than requiring an OpenAI API key, so CI validates orchestration and authority boundaries without introducing synthetic payment success.

## Next phase

Phase C should persist agent runs/steps durably and connect `prepare_offer` to buyer approval, fresh quote revalidation and the existing MANDATE authorization path. After that, the campaign cohort can produce measurable realized uplift using only independently verified Razorpay Test Mode payments.

No synthetic payment is used by this feature.
