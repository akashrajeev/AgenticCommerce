-- Durable merchant-order attribution.
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
