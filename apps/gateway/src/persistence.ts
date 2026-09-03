import postgres from "postgres";
import type {
  AuditEvent,
  CheckoutLineItem,
  DelegatedMandate,
  DelegatedMandateExecution,
  Transaction,
  TransactionMandateAuthorization,
} from "@mandate/types";
import { config } from "./config.js";
import { loadPrismaGatewayState } from "./persistence-prisma-read.js";

type TransactionRow = {
  id: string;
  state: Transaction["state"];
  intent: Transaction["intent"];
  quote: Transaction["quote"];
  policy: Transaction["policy"] | null;
  mandate_authorization: TransactionMandateAuthorization | null;
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
type DelegatedMandateRow = {
  mandate_id: string;
  subject_id: string;
  agent_id: string;
  purpose: string;
  merchant_ids: string[];
  allowed_product_ids: string[] | null;
  max_spend_per_purchase_paise: string | number;
  total_budget_paise: string | number;
  spent_paise: string | number;
  reserved_paise: string | number;
  execution_count: number;
  blocked_count: number;
  approval_mode: DelegatedMandate["approvalMode"];
  constraints: DelegatedMandate["constraints"];
  nonce: string;
  issued_at: Date | string;
  expires_at: Date | string;
  status: DelegatedMandate["status"];
};
type DelegatedExecutionRow = {
  execution_id: string;
  mandate_id: string;
  transaction_id: string;
  amount_paise: string | number;
  status: DelegatedMandateExecution["status"];
  created_at: Date | string;
};

const sql = config.databaseUrl ? postgres(config.databaseUrl, { max: 10 }) : null;
const merchantOrders = new Map<string, PersistedMerchantOrder>();
let lastHydratedAt: string | null = null;
let hydratedRecordCounts = { transactions: 0, auditEvents: 0, merchantOrders: 0 };
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function numberValue(value: string | number): number { return typeof value === "number" ? value : Number(value); }
function toDelegatedMandate(row: DelegatedMandateRow): DelegatedMandate {
  return {
    mandateId: row.mandate_id,
    subjectId: row.subject_id,
    agentId: row.agent_id,
    purpose: row.purpose,
    merchantIds: row.merchant_ids,
    allowedProductIds: row.allowed_product_ids ?? undefined,
    maxSpendPerPurchase: { currency: "INR", amountPaise: numberValue(row.max_spend_per_purchase_paise) },
    totalBudget: { currency: "INR", amountPaise: numberValue(row.total_budget_paise) },
    spentPaise: numberValue(row.spent_paise),
    reservedPaise: numberValue(row.reserved_paise),
    executionCount: row.execution_count,
    blockedCount: row.blocked_count,
    approvalMode: row.approval_mode,
    constraints: row.constraints,
    nonce: row.nonce,
    issuedAt: iso(row.issued_at),
    expiresAt: iso(row.expires_at),
    status: row.status,
  };
}
function toDelegatedExecution(row: DelegatedExecutionRow): DelegatedMandateExecution {
  return {
    executionId: row.execution_id,
    mandateId: row.mandate_id,
    transactionId: row.transaction_id,
    amount: { currency: "INR", amountPaise: numberValue(row.amount_paise) },
    status: row.status,
    createdAt: iso(row.created_at),
  };
}
export function isDatabaseConfigured(): boolean { return Boolean(sql); }
export async function initializePersistence(): Promise<{ enabled: boolean; transactions: Transaction[]; auditEvents: AuditEvent[] }> {
  if (!sql) { lastHydratedAt = new Date().toISOString(); hydratedRecordCounts = { transactions: 0, auditEvents: 0, merchantOrders: 0 }; return { enabled: false, transactions: [], auditEvents: [] }; }
  await sql`SELECT 1`;
  await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS mandate_authorization JSONB`;
  await sql`CREATE TABLE IF NOT EXISTS merchant_orders (merchant_order_id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL UNIQUE, merchant_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER NOT NULL, line_items JSONB NOT NULL, amount_paise BIGINT NOT NULL, base_amount_paise BIGINT NOT NULL, incremental_revenue_paise BIGINT NOT NULL, currency TEXT NOT NULL, razorpay_order_id TEXT NOT NULL, razorpay_payment_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS merchant_orders_created_at_idx ON merchant_orders(created_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS delegated_mandates (mandate_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, agent_id TEXT NOT NULL, purpose TEXT NOT NULL, merchant_ids JSONB NOT NULL, allowed_product_ids JSONB, max_spend_per_purchase_paise BIGINT NOT NULL, total_budget_paise BIGINT NOT NULL, spent_paise BIGINT NOT NULL DEFAULT 0, reserved_paise BIGINT NOT NULL DEFAULT 0, execution_count INTEGER NOT NULL DEFAULT 0, blocked_count INTEGER NOT NULL DEFAULT 0, approval_mode TEXT NOT NULL, constraints JSONB NOT NULL, nonce TEXT NOT NULL UNIQUE, issued_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS delegated_mandate_executions (execution_id TEXT PRIMARY KEY, mandate_id TEXT NOT NULL REFERENCES delegated_mandates(mandate_id) ON DELETE CASCADE, transaction_id TEXT NOT NULL UNIQUE, amount_paise BIGINT NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS delegated_mandates_subject_idx ON delegated_mandates(subject_id, issued_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS delegated_executions_mandate_idx ON delegated_mandate_executions(mandate_id, created_at DESC)`;
  const { transactions, auditEvents } = await loadPrismaGatewayState();
  const orders = await sql<MerchantOrderRow[]>`SELECT merchant_order_id, transaction_id, merchant_id, product_id, quantity, line_items, amount_paise, base_amount_paise, incremental_revenue_paise, currency, razorpay_order_id, razorpay_payment_id, created_at FROM merchant_orders ORDER BY created_at ASC`;
  merchantOrders.clear(); for (const row of orders) merchantOrders.set(row.merchant_order_id, { merchantOrderId: row.merchant_order_id, transactionId: row.transaction_id, merchantId: row.merchant_id, productId: row.product_id, quantity: row.quantity, lineItems: row.line_items, amountPaise: numberValue(row.amount_paise), baseAmountPaise: numberValue(row.base_amount_paise), incrementalRevenuePaise: numberValue(row.incremental_revenue_paise), currency: row.currency, razorpayOrderId: row.razorpay_order_id, razorpayPaymentId: row.razorpay_payment_id, createdAt: iso(row.created_at) });
  lastHydratedAt = new Date().toISOString(); hydratedRecordCounts = { transactions: transactions.length, auditEvents: auditEvents.length, merchantOrders: orders.length };
  return { enabled: true, transactions, auditEvents };
}
export async function saveTransaction(transaction: Transaction): Promise<void> { if (!sql) return; await sql`INSERT INTO transactions (id, state, intent, quote, policy, mandate_authorization, razorpay_order_id, razorpay_payment_id, created_at, updated_at) VALUES (${transaction.id}, ${transaction.state}, ${sql.json(transaction.intent)}, ${sql.json(transaction.quote)}, ${transaction.policy ? sql.json(transaction.policy) : null}, ${transaction.mandateAuthorization ? sql.json(transaction.mandateAuthorization) : null}, ${transaction.razorpayOrderId ?? null}, ${transaction.razorpayPaymentId ?? null}, ${transaction.createdAt}, ${transaction.updatedAt}) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, intent = EXCLUDED.intent, quote = EXCLUDED.quote, policy = EXCLUDED.policy, mandate_authorization = EXCLUDED.mandate_authorization, razorpay_order_id = EXCLUDED.razorpay_order_id, razorpay_payment_id = EXCLUDED.razorpay_payment_id, updated_at = EXCLUDED.updated_at`; }
export async function saveAuditEvent(event: AuditEvent): Promise<void> { if (!sql) return; await sql`INSERT INTO audit_events (id, transaction_id, actor, action, reason, metadata, created_at) VALUES (${event.id}, ${event.transactionId}, ${event.actor}, ${event.action}, ${event.reason}, ${event.metadata ? sql.json(event.metadata) : null}, ${event.createdAt}) ON CONFLICT (id) DO NOTHING`; }
export async function saveMerchantOrder(order: PersistedMerchantOrder): Promise<void> { merchantOrders.set(order.merchantOrderId, order); if (!sql) return; await sql`INSERT INTO merchant_orders (merchant_order_id, transaction_id, merchant_id, product_id, quantity, line_items, amount_paise, base_amount_paise, incremental_revenue_paise, currency, razorpay_order_id, razorpay_payment_id, created_at) VALUES (${order.merchantOrderId}, ${order.transactionId}, ${order.merchantId}, ${order.productId}, ${order.quantity}, ${sql.json(order.lineItems)}, ${order.amountPaise}, ${order.baseAmountPaise}, ${order.incrementalRevenuePaise}, ${order.currency}, ${order.razorpayOrderId}, ${order.razorpayPaymentId}, ${order.createdAt}) ON CONFLICT (transaction_id) DO UPDATE SET line_items = EXCLUDED.line_items, amount_paise = EXCLUDED.amount_paise, base_amount_paise = EXCLUDED.base_amount_paise, incremental_revenue_paise = EXCLUDED.incremental_revenue_paise, razorpay_payment_id = EXCLUDED.razorpay_payment_id`; }
export function listMerchantOrders(): PersistedMerchantOrder[] { return [...merchantOrders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function getRealizedRevenueAttribution(): { confirmedOrders: number; realizedIncrementalRevenuePaise: number; upliftedOrders: number; persistence: { source: "postgresql" | "memory"; hydratedAt: string | null; records: typeof hydratedRecordCounts } } { const confirmedOrders = merchantOrders.size; const realizedIncrementalRevenuePaise = [...merchantOrders.values()].reduce((sum, order) => sum + order.incrementalRevenuePaise, 0); const upliftedOrders = [...merchantOrders.values()].filter((order) => order.incrementalRevenuePaise > 0).length; return { confirmedOrders, realizedIncrementalRevenuePaise, upliftedOrders, persistence: { source: sql ? "postgresql" : "memory", hydratedAt: lastHydratedAt, records: { ...hydratedRecordCounts, merchantOrders: confirmedOrders } } }; }
export async function saveDelegatedMandate(mandate: DelegatedMandate): Promise<void> { if (!sql) return; await sql`INSERT INTO delegated_mandates (mandate_id, subject_id, agent_id, purpose, merchant_ids, allowed_product_ids, max_spend_per_purchase_paise, total_budget_paise, spent_paise, reserved_paise, execution_count, blocked_count, approval_mode, constraints, nonce, issued_at, expires_at, status) VALUES (${mandate.mandateId}, ${mandate.subjectId}, ${mandate.agentId}, ${mandate.purpose}, ${sql.json(mandate.merchantIds)}, ${mandate.allowedProductIds ? sql.json(mandate.allowedProductIds) : null}, ${mandate.maxSpendPerPurchase.amountPaise}, ${mandate.totalBudget.amountPaise}, ${mandate.spentPaise}, ${mandate.reservedPaise}, ${mandate.executionCount}, ${mandate.blockedCount}, ${mandate.approvalMode}, ${sql.json(mandate.constraints)}, ${mandate.nonce}, ${mandate.issuedAt}, ${mandate.expiresAt}, ${mandate.status}) ON CONFLICT (mandate_id) DO UPDATE SET purpose = EXCLUDED.purpose, merchant_ids = EXCLUDED.merchant_ids, allowed_product_ids = EXCLUDED.allowed_product_ids, max_spend_per_purchase_paise = EXCLUDED.max_spend_per_purchase_paise, total_budget_paise = EXCLUDED.total_budget_paise, spent_paise = EXCLUDED.spent_paise, reserved_paise = EXCLUDED.reserved_paise, execution_count = EXCLUDED.execution_count, blocked_count = EXCLUDED.blocked_count, constraints = EXCLUDED.constraints, expires_at = EXCLUDED.expires_at, status = EXCLUDED.status`; }
export async function loadDelegatedMandates(): Promise<DelegatedMandate[]> { if (!sql) return []; const rows = await sql<DelegatedMandateRow[]>`SELECT mandate_id, subject_id, agent_id, purpose, merchant_ids, allowed_product_ids, max_spend_per_purchase_paise, total_budget_paise, spent_paise, reserved_paise, execution_count, blocked_count, approval_mode, constraints, nonce, issued_at, expires_at, status FROM delegated_mandates ORDER BY issued_at ASC`; return rows.map(toDelegatedMandate); }
export async function saveDelegatedMandateExecution(execution: DelegatedMandateExecution): Promise<void> { if (!sql) return; await sql`INSERT INTO delegated_mandate_executions (execution_id, mandate_id, transaction_id, amount_paise, status, created_at) VALUES (${execution.executionId}, ${execution.mandateId}, ${execution.transactionId}, ${execution.amount.amountPaise}, ${execution.status}, ${execution.createdAt}) ON CONFLICT (execution_id) DO UPDATE SET transaction_id = EXCLUDED.transaction_id, amount_paise = EXCLUDED.amount_paise, status = EXCLUDED.status`; }
export async function loadDelegatedMandateExecutions(): Promise<DelegatedMandateExecution[]> { if (!sql) return []; const rows = await sql<DelegatedExecutionRow[]>`SELECT execution_id, mandate_id, transaction_id, amount_paise, status, created_at FROM delegated_mandate_executions ORDER BY created_at ASC`; return rows.map(toDelegatedExecution); }
export async function deleteDelegatedMandateExecution(executionId: string): Promise<void> { if (!sql) return; await sql`DELETE FROM delegated_mandate_executions WHERE execution_id = ${executionId}`; }
export async function reserveDelegatedMandateSpend(mandateId: string, amountPaise: number): Promise<boolean> { if (!sql) return true; const rows = await sql<{ mandate_id: string }[]>`UPDATE delegated_mandates SET reserved_paise = reserved_paise + ${amountPaise}, execution_count = execution_count + 1, status = CASE WHEN spent_paise + reserved_paise + ${amountPaise} >= total_budget_paise THEN 'exhausted' ELSE status END WHERE mandate_id = ${mandateId} AND status = 'active' AND expires_at > NOW() AND ${amountPaise} <= max_spend_per_purchase_paise AND spent_paise + reserved_paise + ${amountPaise} <= total_budget_paise RETURNING mandate_id`; return rows.length === 1; }
export async function settleDelegatedMandateSpend(mandateId: string, amountPaise: number, outcome: "confirmed" | "released"): Promise<void> { if (!sql) return; if (outcome === "confirmed") await sql`UPDATE delegated_mandates SET reserved_paise = GREATEST(reserved_paise - ${amountPaise}, 0), spent_paise = spent_paise + ${amountPaise}, status = CASE WHEN spent_paise + ${amountPaise} >= total_budget_paise THEN 'exhausted' ELSE status END WHERE mandate_id = ${mandateId}`; else await sql`UPDATE delegated_mandates SET reserved_paise = GREATEST(reserved_paise - ${amountPaise}, 0), status = CASE WHEN status = 'exhausted' AND spent_paise < total_budget_paise THEN 'active' ELSE status END WHERE mandate_id = ${mandateId}`; }
export async function claimWebhookEvent(input: { dedupeKey: string; eventName: string; razorpayOrderId?: string | null; razorpayPaymentId?: string | null }): Promise<boolean> { if (!sql) return true; const rows = await sql<{ dedupe_key: string }[]>`INSERT INTO webhook_events (dedupe_key, event_name, razorpay_order_id, razorpay_payment_id, received_at) VALUES (${input.dedupeKey}, ${input.eventName}, ${input.razorpayOrderId ?? null}, ${input.razorpayPaymentId ?? null}, NOW()) ON CONFLICT (dedupe_key) DO NOTHING RETURNING dedupe_key`; return rows.length === 1; }
export async function releaseWebhookEvent(dedupeKey: string): Promise<void> { if (!sql) return; await sql`DELETE FROM webhook_events WHERE dedupe_key = ${dedupeKey}`; }
export async function closePersistence(): Promise<void> { if (sql) await sql.end({ timeout: 5 }); }
