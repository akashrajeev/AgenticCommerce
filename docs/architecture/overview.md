# Architecture Overview

MANDATE is split into three applications and shared packages:

- `apps/buyer`: AI buyer UI and orchestration.
- `apps/merchant`: storefront, dashboard, and agent commerce API.
- `apps/gateway`: deterministic policy, transaction service, Razorpay integration, webhook processing, and audit service.
- `packages/types`, `packages/schemas`, `packages/shared`: cross-application contracts.

## Core Flow

1. User gives the AI buyer a request and spending limit.
2. AI discovers an AI-readable merchant and catalog.
3. AI proposes a `PurchaseIntent`.
4. Gateway policy engine authorizes or blocks.
5. Only authorized transactions can create Razorpay Orders.
6. Frontend launches Razorpay Standard Checkout.
7. Gateway verifies Checkout signature and payment state.
8. Webhooks reconcile async payment events.
9. Merchant order is confirmed only after verification.
10. Every decision and money action is recorded in audit.

## Sources

- docs/CONTEXT.md
- docs/razorpay/README.md
