# MANDATE

MANDATE is an agentic commerce platform for Razorpay Track 01: AI Growth & Agentic Commerce.

This foundation separates the system into:

- `apps/merchant`: merchant storefront, dashboard, and future agent commerce API.
- `apps/buyer`: AI buyer UI and future agent orchestration.
- `apps/gateway`: deterministic transaction, policy, Razorpay, webhook, and audit boundary.
- `packages/shared`: shared runtime helpers.
- `packages/schemas`: shared schema definitions.
- `packages/types`: shared TypeScript domain types.
- `database`: database schema and migrations workspace.
- `docker`: container build files.

No fake payment APIs or fake payment success states are included. Razorpay Test Mode integration will be added behind the gateway in the next implementation step.

## Prerequisites

- Node.js 22+
- npm 10+
- Docker Desktop

## Local Setup

```bash
npm install
cp .env.example .env
cp apps/merchant/.env.example apps/merchant/.env.local
cp apps/buyer/.env.example apps/buyer/.env.local
cp apps/gateway/.env.example apps/gateway/.env
docker compose up -d postgres
npm run dev
```

## Persistent Project Context

Before changing architecture or implementing major payment features, read [docs/CONTEXT.md](docs/CONTEXT.md). Razorpay-specific implementation rules live in [docs/razorpay/README.md](docs/razorpay/README.md).

Default local URLs:

- Merchant: `http://localhost:3000`
- Buyer: `http://localhost:3001`
- Gateway: `http://localhost:4000`
- Gateway health: `http://localhost:4000/health`

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Environment

Razorpay credentials must use Test Mode keys only.

Required later for payment integration:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
