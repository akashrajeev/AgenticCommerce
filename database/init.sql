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

CREATE TABLE IF NOT EXISTS merchant_orders (
  merchant_order_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  merchant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  line_items JSONB NOT NULL,
  amount_paise BIGINT NOT NULL,
  base_amount_paise BIGINT NOT NULL,
  incremental_revenue_paise BIGINT NOT NULL,
  currency TEXT NOT NULL,
  razorpay_order_id TEXT NOT NULL,
  razorpay_payment_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS merchant_orders_created_at_idx
  ON merchant_orders(created_at DESC);
