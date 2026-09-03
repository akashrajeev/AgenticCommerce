CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  intent JSONB NOT NULL,
  quote JSONB NOT NULL,
  policy JSONB,
  mandate_authorization JSONB,
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

CREATE TABLE IF NOT EXISTS delegated_mandates (
  mandate_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  merchant_ids JSONB NOT NULL,
  allowed_product_ids JSONB,
  max_spend_per_purchase_paise BIGINT NOT NULL,
  total_budget_paise BIGINT NOT NULL,
  spent_paise BIGINT NOT NULL DEFAULT 0,
  reserved_paise BIGINT NOT NULL DEFAULT 0,
  execution_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  approval_mode TEXT NOT NULL,
  constraints JSONB NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delegated_mandate_executions (
  execution_id TEXT PRIMARY KEY,
  mandate_id TEXT NOT NULL REFERENCES delegated_mandates(mandate_id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL UNIQUE,
  amount_paise BIGINT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS delegated_mandates_subject_idx
  ON delegated_mandates(subject_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS delegated_executions_mandate_idx
  ON delegated_mandate_executions(mandate_id, created_at DESC);
