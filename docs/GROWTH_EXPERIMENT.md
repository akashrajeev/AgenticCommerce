# Growth Experiment Protocol

## Purpose

Measure an **observed Test Mode basket-value uplift** attributable to the MANDATE Growth Agent intervention without giving the agent payment authority.

This protocol is operational evidence, not a causal marketing claim.

## Trust boundary

```text
Growth Agent
  -> recommends / prepares basket
  -> persisted run + tool trace
  -> buyer explicit approval
  -> fresh merchant quote
  -> MANDATE deterministic authorization
  -> experiment assignment
  -> MCP guarded Razorpay order creation
  -> Razorpay Test Mode Checkout
  -> gateway payment verification / webhook reconciliation
  -> merchant order
  -> independent settlement verification
  -> observed treatment vs control AOV
```

The Growth Agent never receives Razorpay credentials and never calls Razorpay directly. The experiment console only accepts transactions that are already `policy_authorized` with an active mandate authorization.

## Cohorts

### Treatment

A treatment member is an existing MANDATE-authorized transaction whose cart exactly matches a merchant growth opportunity:

- `CROSS_SELL`: source product + recommended product
- `UPSELL`: recommended product

The treatment order is created with the merchant `growth_campaign_id` in Razorpay Test Mode order metadata.

### Control

A control member is an existing MANDATE-authorized transaction containing only the campaign source product. Control order creation does **not** receive the growth campaign identifier.

The experiment requires equal treatment/control sample sizes and does not reuse a transaction across experiments.

## Persistence

The merchant persists:

```text
growth_experiments
  experiment_id
  campaign_id
  name
  objective
  created_at

growth_experiment_assignments
  experiment_id
  transaction_id
  cohort
  campaign_id
  source_product_id
  target_product_id
  assigned_at
```

Assignments are written before cohort order creation. PostgreSQL is required for the experiment console; CI runs a database-backed round-trip smoke test.

## Execution UI

```text
http://localhost:3000/growth-experiment
```

Use the console to:

1. Choose a merchant growth campaign.
2. Select an equal number of eligible treatment and control transactions.
3. Persist the experiment assignment.
4. Launch treatment, control, or both.
5. Complete each order in Razorpay Test Mode Checkout.
6. Read the evidence block after the gateway reconciles each payment.

## Evidence calculation

Only an assignment with an independently verified Razorpay Test Mode payment contributes to the metric.

```text
Treatment AOV = verified treatment payment amount / verified treatment payments
Control AOV   = verified control payment amount / verified control payments

Observed AOV uplift % =
  ((Treatment AOV - Control AOV) / Control AOV) * 100
```

The evidence endpoint also reports:

- assigned treatment/control counts
- verified treatment/control counts
- treatment/control verification rates
- realized incremental revenue from confirmed treatment orders

No metric is shown as an uplift percentage until there is a non-zero verified control AOV.

## Judge sequence

```text
A. Run Growth Agent
   -> inspect tool trace
   -> prepare_offer

B. Buyer explicitly approves the prepared basket
   -> fresh merchant quote
   -> MANDATE policy
   -> policy_authorized transaction

C. Create a comparable base transaction for the control cohort
   -> normal checkout / same source product
   -> MANDATE policy
   -> policy_authorized transaction

D. Open /growth-experiment
   -> choose matching treatment + control samples
   -> persist assignment

E. Launch both cohorts
   -> Treatment: campaign-tagged Test Mode order
   -> Control: untagged Test Mode order

F. Complete Razorpay Test Mode Checkout for both groups

G. Evidence endpoint re-reads Razorpay through MCP
   -> amount
   -> order binding
   -> payment binding
   -> captured state
   -> merchant confirmation

H. Show observed AOV uplift
```

## Interpretation rules

Use language such as:

> "Observed Test Mode AOV uplift: +X.X% across N verified treatment and N verified control payments."

Do not claim:

> "The AI increased conversion by X%"

unless the experiment actually measures conversion and the evidence supports that claim.

## Current limitation

The experiment system does not create synthetic or mock payment evidence. A meaningful uplift number requires real Razorpay Test Mode orders and independently verified captured payments. Without real Test Mode payment credentials and completed payments, the console correctly remains in an evidence-pending state.
