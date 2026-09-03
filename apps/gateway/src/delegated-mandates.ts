import type { CheckoutLineItem, DelegatedMandate, DelegatedMandateExecution, MoneyAmount, PurchaseIntent, Transaction } from "@mandate/types";
import { canonicalizeCheckoutBinding } from "@mandate/types";
import { config } from "./config.js";
import { authorizeCheckout, type MandateAuthorizationResult, type MandateCheckoutBindingInput } from "./mandate-authorization.js";
import { addMandateAuthorizationAudit } from "./transaction-core.js";
import {
  deleteDelegatedMandateExecution,
  loadDelegatedMandates,
  loadDelegatedMandateExecutions,
  saveDelegatedMandate,
  saveDelegatedMandateExecution,
  settleDelegatedMandateSpend,
} from "./persistence.js";

type DelegatedMandateCreateInput = {
  subjectId: string;
  agentId: string;
  purpose: string;
  merchantIds?: string[];
  allowedProductIds?: string[];
  maxSpendPerPurchase: MoneyAmount;
  totalBudget: MoneyAmount;
  constraints?: Record<string, string | number | boolean | null>;
  expiresAt: string;
};

const mandates = new Map<string, DelegatedMandate>();
const executions = new Map<string, DelegatedMandateExecution>();

function nowIso(): string { return new Date().toISOString(); }
function cleanList(values: string[] | undefined): string[] { return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]; }
function updateStatus(mandate: DelegatedMandate): DelegatedMandate {
  if (mandate.status === "active" && new Date(mandate.expiresAt).getTime() <= Date.now()) mandate.status = "expired";
  if (mandate.status === "active" && mandate.spentPaise + mandate.reservedPaise >= mandate.totalBudget.amountPaise) mandate.status = "exhausted";
  return mandate;
}
function remainingPaise(mandate: DelegatedMandate): number { return Math.max(mandate.totalBudget.amountPaise - mandate.spentPaise - mandate.reservedPaise, 0); }
function validateCreate(input: DelegatedMandateCreateInput): void {
  if (!input.subjectId?.trim() || !input.agentId?.trim() || !input.purpose?.trim()) throw new Error("INVALID_DELEGATED_MANDATE_IDENTITY");
  if (!input.maxSpendPerPurchase || input.maxSpendPerPurchase.currency !== "INR" || !Number.isSafeInteger(input.maxSpendPerPurchase.amountPaise) || input.maxSpendPerPurchase.amountPaise <= 0) throw new Error("INVALID_MAX_SPEND_PER_PURCHASE");
  if (!input.totalBudget || input.totalBudget.currency !== "INR" || !Number.isSafeInteger(input.totalBudget.amountPaise) || input.totalBudget.amountPaise <= 0) throw new Error("INVALID_TOTAL_BUDGET");
  if (input.maxSpendPerPurchase.amountPaise > input.totalBudget.amountPaise) throw new Error("MAX_SPEND_EXCEEDS_TOTAL_BUDGET");
  const expiry = new Date(input.expiresAt).getTime();
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("INVALID_DELEGATED_MANDATE_EXPIRY");
}

export function hydrateDelegatedMandateStore(input: { mandates: DelegatedMandate[]; executions: DelegatedMandateExecution[] }): void {
  mandates.clear(); executions.clear();
  for (const mandate of input.mandates) mandates.set(mandate.mandateId, mandate);
  for (const execution of input.executions) executions.set(execution.executionId, execution);
  for (const mandate of mandates.values()) updateStatus(mandate);
}

export async function hydrateDelegatedMandatesFromPersistence(): Promise<void> {
  if (!config.databaseUrl) return;
  const loaded = await loadDelegatedMandates();
  const loadedExecutions = await loadDelegatedMandateExecutions();
  hydrateDelegatedMandateStore({ mandates: loaded, executions: loadedExecutions });
}

export async function createDelegatedMandate(input: DelegatedMandateCreateInput): Promise<DelegatedMandate> {
  validateCreate(input);
  const createdAt = nowIso();
  const mandate: DelegatedMandate = {
    mandateId: `dmdt_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    subjectId: input.subjectId.trim(),
    agentId: input.agentId.trim(),
    purpose: input.purpose.trim(),
    merchantIds: cleanList(input.merchantIds),
    allowedProductIds: input.allowedProductIds ? cleanList(input.allowedProductIds) : undefined,
    maxSpendPerPurchase: input.maxSpendPerPurchase,
    totalBudget: input.totalBudget,
    spentPaise: 0,
    reservedPaise: 0,
    executionCount: 0,
    blockedCount: 0,
    approvalMode: "delegated_autonomous",
    constraints: input.constraints ?? {},
    nonce: `dnonce_${crypto.randomUUID().replaceAll("-", "")}`,
    issuedAt: createdAt,
    expiresAt: new Date(input.expiresAt).toISOString(),
    status: "active",
  };
  mandates.set(mandate.mandateId, mandate);
  await saveDelegatedMandate(mandate);
  return mandate;
}

export function getDelegatedMandate(mandateId: string): DelegatedMandate | undefined {
  const mandate = mandates.get(mandateId);
  return mandate ? updateStatus(mandate) : undefined;
}

export function listDelegatedMandates(): DelegatedMandate[] {
  return [...mandates.values()].map(updateStatus).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

export async function revokeDelegatedMandate(mandateId: string): Promise<DelegatedMandate> {
  const mandate = getDelegatedMandate(mandateId);
  if (!mandate) throw new Error("DELEGATED_MANDATE_NOT_FOUND");
  if (mandate.status === "expired" || mandate.status === "exhausted") return mandate;
  mandate.status = "revoked";
  await saveDelegatedMandate(mandate);
  return mandate;
}

function getEffectiveLineItems(checkout: MandateCheckoutBindingInput): CheckoutLineItem[] { return checkout.lineItems; }
function validateAgainstMandate(mandate: DelegatedMandate, checkout: MandateCheckoutBindingInput): void {
  updateStatus(mandate);
  if (mandate.status !== "active") throw new Error(mandate.status === "expired" ? "DELEGATED_MANDATE_EXPIRED" : mandate.status === "exhausted" ? "DELEGATED_MANDATE_EXHAUSTED" : "DELEGATED_MANDATE_REVOKED");
  if (checkout.currency !== "INR") throw new Error("DELEGATED_MANDATE_CURRENCY_MISMATCH");
  if (checkout.totalPaise > mandate.maxSpendPerPurchase.amountPaise) throw new Error("DELEGATED_MANDATE_PER_PURCHASE_LIMIT");
  if (remainingPaise(mandate) < checkout.totalPaise) throw new Error("DELEGATED_MANDATE_REMAINING_BUDGET");
  if (mandate.merchantIds.length && !mandate.merchantIds.includes(checkout.merchantId)) throw new Error("DELEGATED_MANDATE_MERCHANT_NOT_ALLOWED");
  if (mandate.allowedProductIds) {
    const allowed = new Set(mandate.allowedProductIds);
    if (getEffectiveLineItems(checkout).some((line) => !allowed.has(line.productId))) throw new Error("DELEGATED_MANDATE_PRODUCT_NOT_ALLOWED");
  }
  const binding = canonicalizeCheckoutBinding(checkout);
  if (!binding) throw new Error("DELEGATED_MANDATE_BINDING_INVALID");
}

export async function executeDelegatedMandate(mandateId: string, checkout: MandateCheckoutBindingInput): Promise<{ mandate: DelegatedMandate; execution: DelegatedMandateExecution; authorization: MandateAuthorizationResult }> {
  const mandate = getDelegatedMandate(mandateId);
  if (!mandate) throw new Error("DELEGATED_MANDATE_NOT_FOUND");
  try {
    validateAgainstMandate(mandate, checkout);
  } catch (error) {
    mandate.blockedCount += 1;
    await saveDelegatedMandate(mandate);
    throw error;
  }

  const executionId = `dexec_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const execution: DelegatedMandateExecution = { executionId, mandateId, transactionId: "", amount: { currency: "INR", amountPaise: checkout.totalPaise }, status: "reserved", createdAt: nowIso() };
  mandate.reservedPaise += checkout.totalPaise;
  mandate.executionCount += 1;
  await saveDelegatedMandate(mandate);
  executions.set(executionId, execution);
  try {
    const firstLine = checkout.lineItems[0];
    if (!firstLine) throw new Error("INVALID_CHECKOUT_ITEMS");
    const userMandate = {
      mandateId,
      subjectId: mandate.subjectId,
      agentId: mandate.agentId,
      merchantId: checkout.merchantId,
      purpose: mandate.purpose,
      maxSpend: mandate.maxSpendPerPurchase,
      allowedProductIds: mandate.allowedProductIds,
      constraints: mandate.constraints,
      approvalMode: "delegated_autonomous" as const,
      nonce: `${mandate.nonce}:${executionId}`,
      issuedAt: mandate.issuedAt,
      expiresAt: mandate.expiresAt,
    };
    const authorization = await authorizeCheckout({ userMandate, checkout, paymentRail: "razorpay_standard_checkout" });
    execution.transactionId = authorization.transaction.id;
    await saveDelegatedMandateExecution(execution);
    addMandateAuthorizationAudit(authorization.transaction.id, {
      mandateId,
      executionId,
      approvalMode: "delegated_autonomous",
      reservedPaise: checkout.totalPaise,
      remainingBeforePaise: mandate.totalBudget.amountPaise - mandate.spentPaise - mandate.reservedPaise + checkout.totalPaise,
      remainingAfterReservationPaise: remainingPaise(mandate),
    });
    return { mandate, execution, authorization };
  } catch (error) {
    mandate.reservedPaise = Math.max(0, mandate.reservedPaise - checkout.totalPaise);
    updateStatus(mandate);
    await saveDelegatedMandate(mandate);
    executions.delete(executionId);
    await deleteDelegatedMandateExecution(executionId);
    throw error;
  }
}

export async function settleDelegatedExecution(transactionId: string, outcome: "confirmed" | "released"): Promise<void> {
  const execution = [...executions.values()].find((item) => item.transactionId === transactionId && item.status === "reserved");
  if (!execution) return;
  const mandate = getDelegatedMandate(execution.mandateId);
  if (!mandate) return;
  execution.status = outcome;
  mandate.reservedPaise = Math.max(0, mandate.reservedPaise - execution.amount.amountPaise);
  if (outcome === "confirmed") mandate.spentPaise += execution.amount.amountPaise;
  updateStatus(mandate);
  await saveDelegatedMandate(mandate);
  await saveDelegatedMandateExecution(execution);
}

export function delegatedMandateStats(mandateId: string) {
  const mandate = getDelegatedMandate(mandateId);
  if (!mandate) return undefined;
  return {
    ...mandate,
    remainingPaise: remainingPaise(mandate),
    remainingDisplay: `₹${(remainingPaise(mandate) / 100).toFixed(2)}`,
  };
}
