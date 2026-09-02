-- MANDATE persistence schema.
-- The gateway currently uses in-memory state; this migration defines the durable model
-- that will replace that storage without changing the transaction state machine.

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  max_spend_paise BIGINT NOT NULL,
  reason TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  quote_json JSONB NOT NULL,
  policy_json JSONB,
  razorpay_order_id TEXT UNIQUE,
  razorpay_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS transactions_state_idx ON transactions (state);
CREATE INDEX IF NOT EXISTS transactions_created_at_idx ON transactions (created_at DESC);

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
  ON audit_events (transaction_id, created_at ASC);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_key TEXT PRIMARY KEY,
  razorpay_event_id TEXT,
  event_name TEXT NOT NULL,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  payload_hash TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'received',
  error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_razorpay_event_id_idx
  ON webhook_events (razorpay_event_id)
  WHERE razorpay_event_id IS NOT NULL;
