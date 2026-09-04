# Buyer Agent 2.0 — Completed Orchestration Stack

The buyer now operates as a model-directed, bounded shopping agent rather than a single planning call.

## Execution contract

```text
User objective
    ↓
Buyer Agent run
    ↓
bounded observation
    ↓
model chooses exactly one tool
    ↓
allow-list validation
    ↓
merchant/tool execution
    ↓
structured result returned to planner
    ↓
repeat / recover / re-plan
    ↓
review-ready basket
    ↓
explicit user approval
    ↓
signed human-present MANDATE
    ↓
policy authorization
    ↓
Razorpay Test Mode
```

## Completed buyer phases

- **BA — Agent foundation:** run state machine, immutable buyer constraints, bounded step count and fail-closed budget validation.
- **BB — Tool layer:** merchant discovery, catalog/search, product/inventory inspection, fresh quotes, comparison, recommendations, basket building and approval preparation.
- **BC — Model-directed loop:** OpenAI Responses tool calling with one tool per turn, bounded history, strict allow-list validation and structured tool-error feedback for recovery.
- **BD — Observation layer:** planner receives a bounded commerce snapshot instead of raw application internals.
- **BE — Explicit selection:** product choice is a first-class agent action with deterministic checks for observation, inventory, category, allow-list and budget.
- **BF — Merchant-offer evaluation:** buyer explicitly accepts or rejects merchant upsell/cross-sell proposals based on its own objective and constraints.
- **BG — Recovery:** tool failures are returned to the planner so the agent can choose another action from observed facts rather than terminating immediately.
- **BH — Basket optimization:** base and merchant-recommended baskets are compared using fresh quotes and the immutable spending limit.
- **BI — Approval preparation:** the agent terminates at `READY_FOR_APPROVAL`; it never authorizes payment.
- **BJ — Durable evidence:** run, workspace and step trace are persisted atomically through the authenticated internal merchant persistence route and can be recovered after process restart.
- **BK — Agent-to-agent commerce:** merchant recommendations become explicit offers that the buyer agent independently evaluates.
- **BL — Failure/recovery evidence:** the buyer UI exposes failed steps and downstream payment-recovery states without mutating failed transactions.
- **BM — Buyer Agent API:** `POST /api/agent/buyer` runs the agent; `GET /api/agent/buyer?runId=:id` returns in-memory state or falls back to durable PostgreSQL evidence.
- **BN — Buyer UI:** the live buyer workspace shows the agent state, ordered trace, selected product, merchant offers, proposed basket, approval gate and downstream MANDATE/Razorpay state.

## Planner rules

- One tool per turn (`parallel_tool_calls: false`).
- Only the explicit buyer tool registry plus the bounded selection, offer-evaluation and optimizer actions are exposed.
- Planner requests use `store: false`.
- Hard spend limit and maximum steps are application-owned.
- Tool failures become structured planner input for recovery.
- The planner may never create, capture, refund, authorize or claim a payment.
- `prepare_approval` only produces a review-ready proposal.

## Financial boundary

```text
Buyer Agent
    ↓
shopping decisions
    ↓
review-ready basket
    ↓
explicit user approval
    ↓
signed human-present mandate
    ↓
MANDATE policy
    ↓
Razorpay Test Mode
```

## Evidence

Buyer run state, workspace and tool steps are persisted through an authenticated internal merchant endpoint. The buyer API first serves active in-memory state and falls back to PostgreSQL for restart recovery.

The final buyer stack is therefore independent of payment execution: the agent controls commercial reasoning, while financial authority remains downstream in MANDATE.
