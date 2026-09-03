import type { CheckoutLineItem } from "@mandate/types";

export type MerchantOrder = {
  id: string;
  transactionId: string;
  productId: string;
  quantity: number;
  lineItems?: CheckoutLineItem[];
  amountPaise: number;
  baseAmountPaise: number;
  incrementalRevenuePaise: number;
  currency: "INR";
  razorpayOrderId: string;
  razorpayPaymentId: string;
  status: "confirmed";
  createdAt: string;
};

const orders = new Map<string, MerchantOrder>();

export function createMerchantOrder(input: Omit<MerchantOrder, "id" | "createdAt" | "status" | "baseAmountPaise" | "incrementalRevenuePaise">): MerchantOrder {
  const existing = [...orders.values()].find((order) => order.transactionId === input.transactionId);
  if (existing) return existing;
  const lineItems = input.lineItems ?? [{ productId: input.productId, quantity: input.quantity, unitPricePaise: input.amountPaise, lineTotalPaise: input.amountPaise }];
  const baseAmountPaise = lineItems[0]?.lineTotalPaise ?? input.amountPaise;
  const merchandiseTotalPaise = lineItems.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  const incrementalRevenuePaise = Math.max(merchandiseTotalPaise - baseAmountPaise, 0);
  const order: MerchantOrder = { ...input, lineItems, baseAmountPaise, incrementalRevenuePaise, id: `MM-${new Date().getFullYear()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`, status: "confirmed", createdAt: new Date().toISOString() };
  orders.set(order.id, order);
  return order;
}

export function listMerchantOrders(): MerchantOrder[] {
  return [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getMerchantOrderByTransaction(transactionId: string): MerchantOrder | undefined {
  return [...orders.values()].find((order) => order.transactionId === transactionId);
}

export function getRealizedRevenueAttribution(): { confirmedOrders: number; realizedIncrementalRevenuePaise: number; upliftedOrders: number } {
  const confirmedOrders = orders.size;
  const realizedIncrementalRevenuePaise = [...orders.values()].reduce((sum, order) => sum + order.incrementalRevenuePaise, 0);
  const upliftedOrders = [...orders.values()].filter((order) => order.incrementalRevenuePaise > 0).length;
  return { confirmedOrders, realizedIncrementalRevenuePaise, upliftedOrders };
}
