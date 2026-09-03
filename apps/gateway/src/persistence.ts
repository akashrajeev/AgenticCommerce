import postgres from "postgres";
import type { AuditEvent, CheckoutLineItem, Transaction } from "@mandate/types";
import { config } from "./config.js";

type TransactionRow = {
  id: string;
  state: Transaction["state"];
  intent: Transaction["intent"];
  quote: Transaction["quote"];
  policy: Transaction["policy"] | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};
type AuditRow = { id: string; transaction_id: string; actor: AuditEvent["actor"]; action: string; reason: string; metadata: AuditEvent["metadata"] | null; created_at: Date | string };
export type PersistedMerchantOrder = {
  merchantOrderId: string;
  transactionId: string;
  merchantId: string;
  productId: string;
  quantity: number;
  lineItems: CheckoutLineItem[];
  amountPaise: number;
  baseAmountPaise: number;
  incrementalRevenuePaise: number;
  currency: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  createdAt: string;
};
type MerchantOrderRow = {
  merchant_order_id: string;
  transaction_id: string;
  merchant_id: string;
  product_id: string;
  quantity: number;
  line_items: CheckoutLineItem[];
  amount_paise: string | number;
  base_amount_paise: string | number;
  incremental_revenue_paise: string | number;
  currency: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  created_at: Date | string;
};
const sql = config.databaseUrl ? postgres(config.databaseUrl, { max: 10 }) : null;
const merchantOrders = new Map<string, PersistedMerchantOrder>();
let lastHydratedAt: string | null = null;
let hydratedRecordCounts = { transactions: 0, auditEvents: 0, merchantOrders: 0 };
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function numberValue(value: string | number): number { return typeof value === "number" ? value : Number(value); }
export function isDatabaseConfigured(): boolean { return Boolean(sql); }
export async function initializePersistence(): Promise<{ enabled: boolean; transactions: Transaction[]; auditEvents: AuditEvent[] }> {
  if (!sql) { lastHydratedAt = new Date().toISOString(); hydratedRecordCounts = { transactions: 0, auditEvents: 0, merchantOrders: 0 }; return { enabled: false, transactions: [], auditEvents: [] }; }
  await sql`SELECT 1`;
  await sql`CREATE TABLE IF NOT EXISTS merchant_orders (merchant_order_id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL UNIQUE, merchant_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER NOT NULL, line_items JSONB NOT NULL, amount_paise BIGINT NOT NULL, base_amount_paise BIGINT NOT NULL, incremental_revenue_paise BIGINT NOT NULL, currency TEXT NOT NULL, razorpay_order_id TEXT NOT NULL, razorpay_payment_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS merchant_orders_created_at_idx ON merchant_orders(created_at DESC)`;
  const transactions = await sql<TransactionRow[]>`SELECT id, state, intent, quote, policy, razorpay_order_id, razorpay_payment_id, created_at, updated_at FROM transactions ORDER BY created_at ASC`;
  const auditEvents = await sql<AuditRow[]>`SELECT id, transaction_id, actor, action, reason, metadata, created_at FROM audit_events ORDER BY created_at ASC`;
  const orders = await sql<MerchantOrderRow[]>`SELECT merchant_order_id, transaction_id, merchant_id, product_id, quantity, line_items, amount_paise, base_amount_paise, incremental_revenue_paise, currency, razorpay_order_id, razorpay_payment_id, created_at FROM merchant_orders ORDER BY created_at ASC`;
  merchantOrders.clear(); for (const row of orders) merchantOrders.set(row.merchant_order_id, { merchantOrderId: row.merchant_order_id, transactionId: row.transaction_id, merchantId: row.merchant_id, productId: row.product_id, quantity: row.quantity, lineItems: row.line_items, amountPaise: numberValue(row.amount_paise), baseAmountPaise: numberValue(row.base_amount_paise), incrementalRevenuePaise: numberValue(row.incremental_revenue_paise), currency: row.currency, razorpayOrderId: row.razorpay_order_id, razorpayPaymentId: row.razorpay_payment_id, createdAt: iso(row.created_at) });
  lastHydratedAt = new Date().toISOString(); hydratedRecordCounts = { transactions: transactions.length, auditEvents: auditEvents.length, merchantOrders: orders.length };
  return { enabled: true, transactions: transactions.map((row) => ({ id: row.id, state: row.state, intent: row.intent, quote: row.quote, policy: row.policy ?? undefined, razorpayOrderId: row.razorpay_order_id ?? undefined, razorpayPaymentId: row.razorpay_payment_id ?? undefined, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) })), auditEvents: auditEvents.map((row) => ({ id: row.id, transactionId: row.transaction_id, actor: row.actor, action: row.action, reason: row.reason, metadata: row.metadata ?? undefined, createdAt: iso(row.created_at) })) };
}
export async function saveTransaction(transaction: Transaction): Promise<void> { if (!sql) return; await sql`INSERT INTO transactions (id, state, intent, quote, policy, razorpay_order_id, razorpay_payment_id, created_at, updated_at) VALUES (${transaction.id}, ${transaction.state}, ${sql.json(transaction.intent)}, ${sql.json(transaction.quote)}, ${transaction.policy ? sql.json(transaction.policy) : null}, ${transaction.razorpayOrderId ?? null}, ${transaction.razorpayPaymentId ?? null}, ${transaction.createdAt}, ${transaction.updatedAt}) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, intent = EXCLUDED.intent, quote = EXCLUDED.quote, policy = EXCLUDED.policy, razorpay_order_id = EXCLUDED.razorpay_order_id, razorpay_payment_id = EXCLUDED.razorpay_payment_id, updated_at = EXCLUDED.updated_at`; }
export async function saveAuditEvent(event: AuditEvent): Promise<void> { if (!sql) return; await sql`INSERT INTO audit_events (id, transaction_id, actor, action, reason, metadata, created_at) VALUES (${event.id}, ${event.transactionId}, ${event.actor}, ${event.action}, ${event.reason}, ${event.metadata ? sql.json(event.metadata) : null}, ${event.createdAt}) ON CONFLICT (id) DO NOTHING`; }
export async function saveMerchantOrder(order: PersistedMerchantOrder): Promise<void> { merchantOrders.set(order.merchantOrderId, order); if (!sql) return; await sql`INSERT INTO merchant_orders (merchant_order_id, transaction_id, merchant_id, product_id, quantity, line_items, amount_paise, base_amount_paise, incremental_revenue_paise, currency, razorpay_order_id, razorpay_payment_id, created_at) VALUES (${order.merchantOrderId}, ${order.transactionId}, ${order.merchantId}, ${order.productId}, ${order.quantity}, ${sql.json(order.lineItems)}, ${order.amountPaise}, ${order.baseAmountPaise}, ${order.incrementalRevenuePaise}, ${order.currency}, ${order.razorpayOrderId}, ${order.razorpayPaymentId}, ${order.createdAt}) ON CONFLICT (transaction_id) DO UPDATE SET line_items = EXCLUDED.line_items, amount_paise = EXCLUDED.amount_paise, base_amount_paise = EXCLUDED.base_amount_paise, incremental_revenue_paise = EXCLUDED.incremental_revenue_paise, razorpay_payment_id = EXCLUDED.razorpay_payment_id`;
}
export function listMerchantOrders(): PersistedMerchantOrder[] { return [...merchantOrders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function getRealizedRevenueAttribution(): { confirmedOrders: number; realizedIncrementalRevenuePaise: number; upliftedOrders: number; persistence: { source: "postgresql" | "memory"; hydratedAt: string | null; records: typeof hydratedRecordCounts } } { const confirmedOrders = merchantOrders.size; const realizedIncrementalRevenuePaise = [...merchantOrders.values()].reduce((sum, order) => sum + order.incrementalRevenuePaise, 0); const upliftedOrders = [...merchantOrders.values()].filter((order) => order.incrementalRevenuePaise > 0).length; return { confirmedOrders, realizedIncrementalRevenuePaise, upliftedOrders, persistence: { source: sql ? "postgresql" : "memory", hydratedAt: lastHydratedAt, records: { ...hydratedRecordCounts, merchantOrders: confirmedOrders } } }; }
export async function claimWebhookEvent(input: { dedupeKey: string; eventName: string; razorpayOrderId?: string | null; razorpayPaymentId?: string | null }): Promise<boolean> { if (!sql) return true; const rows = await sql<{ dedupe_key: string }[]>`INSERT INTO webhook_events (dedupe_key, event_name, razorpay_order_id, razorpay_payment_id, received_at) VALUES (${input.dedupeKey}, ${input.eventName}, ${input.razorpayOrderId ?? null}, ${input.razorpayPaymentId ?? null}, NOW()) ON CONFLICT (dedupe_key) DO NOTHING RETURNING dedupe_key`; return rows.length === 1; }
export async function releaseWebhookEvent(dedupeKey: string): Promise<void> { if (!sql) return; await sql`DELETE FROM webhook_events WHERE dedupe_key = ${dedupeKey}`; }
export async function closePersistence(): Promise<void> { if (sql) await sql.end({ timeout: 5 }); }
