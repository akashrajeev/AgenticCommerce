import { checkoutPreviewSchema } from "@mandate/schemas";
import { buildQuote, findProduct, MERCHANT_ID } from "../../../../../lib/catalog";

export async function POST(request: Request) {
  const parsed = checkoutPreviewSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_CHECKOUT_REQUEST", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const product = findProduct(parsed.data.productId);
  if (!product) {
    return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }

  if (product.inventory < parsed.data.quantity) {
    return Response.json(
      {
        error: "INSUFFICIENT_INVENTORY",
        available: product.inventory,
        requested: parsed.data.quantity,
      },
      { status: 409 },
    );
  }

  const quote = buildQuote(product, parsed.data.quantity);

  return Response.json(
    { merchantId: MERCHANT_ID, quote },
    {
      headers: {
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    },
  );
}
