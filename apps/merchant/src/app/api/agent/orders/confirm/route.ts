import { findProduct } from "../../../../../lib/catalog";
import { createMerchantOrder } from "../../../../../lib/orders";
import type { CheckoutLineItem } from "@mandate/types";
export async function POST(request: Request) {
  const expectedSecret = process.env.INTERNAL_GATEWAY_SECRET; const providedSecret = request.headers.get("x-mandate-gateway-secret"); if (expectedSecret && providedSecret !== expectedSecret) return Response.json({ error: "UNAUTHORIZED_GATEWAY" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null; const transactionId = typeof body?.transactionId === "string" ? body.transactionId : ""; const productId = typeof body?.productId === "string" ? body.productId : ""; const quantity = typeof body?.quantity === "number" ? body.quantity : NaN; const amountPaise = typeof body?.amountPaise === "number" ? body.amountPaise : NaN; const razorpayOrderId = typeof body?.razorpayOrderId === "string" ? body.razorpayOrderId : ""; const razorpayPaymentId = typeof body?.razorpayPaymentId === "string" ? body.razorpayPaymentId : "";
  const rawLineItems = Array.isArray(body?.lineItems) ? body.lineItems : undefined; const lineItems = rawLineItems?.map((item) => { const line = item as Record<string, unknown>; return { productId: typeof line?.productId === "string" ? line.productId : "", quantity: typeof line?.quantity === "number" ? line.quantity : NaN }; }) as CheckoutLineItem[] | undefined;
  const effective = lineItems?.length ? lineItems : [{ productId, quantity }];
  if (!transactionId || !Number.isInteger(amountPaise) || !razorpayOrderId || !razorpayPaymentId || effective.some((line) => !findProduct(line.productId) || !Number.isInteger(line.quantity) || line.quantity < 1)) return Response.json({ error: "INVALID_ORDER_CONFIRMATION" }, { status: 400 });
  const order = createMerchantOrder({ transactionId, productId: effective[0].productId, quantity: effective[0].quantity, lineItems: effective, amountPaise, currency: "INR", razorpayOrderId, razorpayPaymentId });
  return Response.json({ order }, { status: 201 });
}
