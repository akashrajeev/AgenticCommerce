# Database

The database layer is the durable persistence boundary for MANDATE transaction state, audit events, and Razorpay webhook deduplication.

- `init.sql` bootstraps the PostgreSQL schema used by Docker Compose and CI.
- `schema.prisma` defines the corresponding Prisma models and relations.
- The gateway routes transaction, audit-event, and webhook-idempotency writes through a Prisma-backed adapter whenever `DATABASE_URL` is configured.
- Startup hydration reads persisted transactions and audit events through Prisma before rebuilding the gateway state-machine read model, so a restart does not lose the financial history held in process memory.
- The gateway tracks pending financial persistence writes and drains them before JSON responses are sent; a persistence failure is surfaced as `PERSISTENCE_UNAVAILABLE` instead of acknowledging a non-durable state change.
- The existing PostgreSQL adapter remains the safe fallback for environments without `DATABASE_URL`, so the deterministic gateway test suite does not require a database.
- CI provisions PostgreSQL 16, bootstraps `init.sql`, and runs a focused Prisma persistence smoke test covering transaction upserts, audit writes, webhook deduplication, restart hydration, and cleanup.

The migration is intentionally incremental: delegated-mandate persistence and merchant-order persistence still use the existing PostgreSQL adapter until their Prisma equivalents can be introduced without changing the transaction semantics.

The security invariant remains unchanged: persistence records transaction decisions and evidence; it never grants the AI buyer payment authority.
