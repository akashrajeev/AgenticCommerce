# Buyer Agent Foundation

## Phase BA

The buyer side now has a bounded run contract that is independent from payment execution.

### Run contract

`BuyerAgentRun` stores the user objective, immutable shopping constraints, state, step count, terminal error and lifecycle timestamps.

Constraints are runtime-frozen and include:

- `maxSpendPaise` supplied by the application;
- `currency` fixed to INR;
- `maxSteps` bounded by the application;
- optional required category/product IDs.

The buyer agent has no method that mutates its spending limit after run creation.

### State machine

`CREATED → PLANNING / FAILED`

Planning may transition through `OBSERVING`, `SEARCHING`, `COMPARING`, `BUILDING_BASKET`, and `WAITING_FOR_APPROVAL`, with recovery back to planning where appropriate. `COMPLETED` and `FAILED` are terminal.

### Financial boundary

BA contains no Razorpay integration, payment authority, mandate authorization, order capture, or spend-limit mutation. Later phases must preserve the same separation:

`Buyer Agent → recommendation / approval preparation → MANDATE → Razorpay Test Mode`

### Regression coverage

`apps/buyer/src/lib/buyer-agent.test.ts` covers run creation, immutable constraints, invalid input rejection, transition enforcement, hard step limits, and application-owned budget validation.
