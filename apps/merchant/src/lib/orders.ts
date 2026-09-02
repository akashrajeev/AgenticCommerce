export type MerchantOrder = {
  id: string;
  transactionId: string;
  productId: string;
  quantity: number;
  amountPaise: number;
  currency: "INR";
  razorpayOrderId: string;
  razorpayPaymentId: string;
  status: "confirmed";
  createdAt: string;
};

const orders = new Map<string, MerchantOrder>();

export function createMerchantOrder(input: Omit<MerchantOrder, "id" | "createdAt" | "status">): MerchantOrder {
  const existing = [...orders.values()].find((order) => order.transactionId === input.transactionId);
  if (existing) return existing;

  const order: MerchantOrder = {
    ...input,
    id: `MM-${new Date().getFullYear()}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
    status: "confirmed",
    createdAt: new Date().toISOString(),
  };
  orders.set(order.id, order);
  return order;
}

export function listMerchantOrders(): MerchantOrder[] {
  return [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
