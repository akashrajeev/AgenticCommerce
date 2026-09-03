# Database

The database layer is the durable persistence boundary for MANDATE transaction state, audit events, and Razorpay webhook deduplication.

- `init.sql` bootstraps the PostgreSQL schema used by Docker Compose and CI.
- `schema.prisma` defines the corresponding Prisma models and relations.
- The gateway now routes transaction, audit-event, and webhook-idempotency writes through a Prisma-backed adapter whenever `DATABASE_URL` is configured.
- The existing PostgreSQL adapter remains the safe fallback for environments without `DATABASE_URL`, so the deterministic gateway test suite does not require a database.
- CI provisions PostgreSQL 16, bootstraps `init.sql`, and runs a focused Prisma persistence smoke test covering transaction upserts, audit writes, webhook deduplication, and cleanup.

The migration is intentionally incremental: delegated-mandate persistence, merchant-order persistence, and startup hydration still use the existing PostgreSQL adapter until their Prisma equivalents can be introduced without changing the transaction semantics.

The security invariant remains unchanged: persistence records transaction decisions and evidence; it never grants the AI buyer payment authority.
