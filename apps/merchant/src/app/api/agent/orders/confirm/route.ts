import { findProduct } from "../../../../../lib/catalog";
import { createMerchantOrder } from "../../../../../lib/orders";

export async function POST(request: Request) {
  const expectedSecret = process.env.INTERNAL_GATEWAY_SECRET;
  const providedSecret = request.headers.get("x-mandate-gateway-secret");
  if (expectedSecret && providedSecret !== expectedSecret) {
    return Response.json({ error: "UNAUTHORIZED_GATEWAY" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId : "";
  const productId = typeof body?.productId === "string" ? body.productId : "";
  const quantity = typeof body?.quantity === "number" ? body.quantity : NaN;
  const amountPaise = typeof body?.amountPaise === "number" ? body.amountPaise : NaN;
  const razorpayOrderId = typeof body?.razorpayOrderId === "string" ? body.razorpayOrderId : "";
  const razorpayPaymentId = typeof body?.razorpayPaymentId === "string" ? body.razorpayPaymentId : "";

  const product = findProduct(productId);
  if (!transactionId || !product || !Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(amountPaise) || !razorpayOrderId || !razorpayPaymentId) {
    return Response.json({ error: "INVALID_ORDER_CONFIRMATION" }, { status: 400 });
  }

  const order = createMerchantOrder({
    transactionId,
    productId,
    quantity,
    amountPaise,
    currency: "INR",
    razorpayOrderId,
    razorpayPaymentId,
  });

  return Response.json({ order }, { status: 201 });
}
