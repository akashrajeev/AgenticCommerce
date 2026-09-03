CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  intent JSONB NOT NULL,
  quote JSONB NOT NULL,
  policy JSONB,
  razorpay_order_id TEXT UNIQUE,
  razorpay_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_transaction_created_idx
  ON audit_events(transaction_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  dedupe_key TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  received_at TIMESTAMPTZ NOT NULL
);
