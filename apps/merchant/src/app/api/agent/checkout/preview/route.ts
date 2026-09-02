import { checkoutPreviewSchema } from "@mandate/schemas";
import { buildQuote, findProduct, MERCHANT_ID } from "../../../../../lib/catalog";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const parsed = checkoutPreviewSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_CHECKOUT_REQUEST", details: parsed.error.flatten() },
      { status: 400, headers: corsHeaders },
    );
  }

  const product = findProduct(parsed.data.productId);
  if (!product) {
    return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404, headers: corsHeaders });
  }

  if (product.inventory < parsed.data.quantity) {
    return Response.json(
      {
        error: "INSUFFICIENT_INVENTORY",
        available: product.inventory,
        requested: parsed.data.quantity,
      },
      { status: 409, headers: corsHeaders },
    );
  }

  const quote = buildQuote(product, parsed.data.quantity);

  return Response.json(
    { merchantId: MERCHANT_ID, quote },
    {
      headers: {
        ...corsHeaders,
        "cache-control": "no-store",
      },
    },
  );
}
