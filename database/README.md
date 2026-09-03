# Database

The database layer is the durable persistence boundary for MANDATE transaction state, audit events, and Razorpay webhook deduplication.

- `init.sql` bootstraps the PostgreSQL schema used by Docker Compose.
- `schema.prisma` defines the corresponding Prisma models and relations.
- The gateway currently keeps its runtime repository in memory; introducing Prisma into the gateway is intentionally the next migration step so dependency and lockfile changes can be validated together.

The security invariant remains unchanged: persistence records transaction decisions and evidence; it never grants the AI buyer payment authority.
