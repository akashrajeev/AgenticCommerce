# Buyer Agent Orchestration — Phase BC

The buyer now has a model-directed, bounded execution loop over the Phase BB shopping tools.

## Execution contract

```text
User objective
    ↓
Buyer Agent run
    ↓
OpenAI Responses planner
    ↓
exactly one tool call
    ↓
allow-list validation
    ↓
merchant/tool execution
    ↓
function_call_output returned to planner
    ↓
repeat until approval-ready or terminal failure
```

The application owns `maxSpendPaise` and `maxSteps`. The planner cannot change either value.

## Planner rules

- One tool per turn (`parallel_tool_calls: false`).
- Only the explicit buyer tool registry is exposed.
- Planner requests use `store: false`.
- Tool failures are returned to the planner as structured errors so it may re-plan.
- A tool call that is outside the registry fails closed before executor dispatch.
- `prepare_approval` is the final commercial action. It creates a review-ready proposal only.

## Financial boundary

The buyer planner is never given a Razorpay/payment tool. Payment remains downstream:

```text
Buyer Agent
    ↓
prepared basket
    ↓
explicit user approval
    ↓
signed human-present mandate
    ↓
MANDATE policy
    ↓
Razorpay Test Mode
```

## Runtime evidence

`GET /api/agent/buyer?runId=:id` exposes the current bounded run and the tool-call history count. The execution result also returns the buyer workspace and ordered trace so the UI can present the agent's observed actions and recovery path without exposing hidden chain-of-thought.
