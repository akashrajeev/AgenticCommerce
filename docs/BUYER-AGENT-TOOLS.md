# Buyer Agent Tool Layer

## Purpose

Phase BB gives the Buyer Agent a bounded set of deterministic shopping tools. These tools observe merchant data, compare products, construct a proposed basket, validate the immutable buyer budget, and prepare an approval payload.

## Allowed tools

- `discover_merchant` — read the machine-readable merchant manifest.
- `read_catalog` — read the current catalog.
- `search_products` — filter the observed catalog under the application-owned spending limit and buyer constraints.
- `inspect_product` — retrieve current details for one product.
- `check_inventory` — retrieve current inventory for one product.
- `get_quote` — obtain a fresh merchant checkout quote; this never authorizes payment.
- `compare_products` — return normalized facts for observed candidates.
- `get_merchant_recommendations` — retrieve merchant-published upsell/cross-sell suggestions.
- `build_basket` — build a proposed basket, verify observed products and inventory, and obtain a fresh quote.
- `validate_budget` — deterministically check the proposed total against the immutable buyer limit.
- `prepare_approval` — freeze the current quote/basket into a user-review payload; this never authorizes payment.

## Forbidden authority

The Buyer Agent tool layer intentionally exposes no payment, capture, refund, spend-limit modification, or silent-approval operation.

The financial boundary remains:

```text
Buyer Agent
  -> shopping recommendation
  -> proposed basket
  -> explicit user approval
  -> signed MANDATE authorization
  -> Razorpay Test Mode execution
```

## State

The tools operate against a per-run workspace containing the discovered manifest, observed catalog, inspected products, inventory observations, merchant recommendations, selected product, proposed basket, and latest quote.

The workspace is execution state, not financial authority. A quote remains subject to the existing MANDATE revalidation before any payment order can be created.

## Phase BC

Phase BC should connect these tools to the model-directed Buyer Agent loop. The planner should select one allowed tool at a time, retain bounded history, recover from tool errors, and stop at the BA run's hard step limit.
