import { checkoutPreviewSchema } from "@mandate/schemas";
import { buildMultiLineQuote, buildQuote, findProduct, MERCHANT_ID } from "../../../../../lib/catalog";

const corsHeaders = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
export function OPTIONS() { return new Response(null, { status: 204, headers: corsHeaders }); }
export async function POST(request: Request) {
  const parsed = checkoutPreviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "INVALID_CHECKOUT_REQUEST", details: parsed.error.flatten() }, { status: 400, headers: corsHeaders });
  const lineItems = parsed.data.lineItems?.length ? parsed.data.lineItems : [{ productId: parsed.data.productId, quantity: parsed.data.quantity }];
  for (const item of lineItems) {
    const product = findProduct(item.productId);
    if (!product) return Response.json({ error: "PRODUCT_NOT_FOUND", productId: item.productId }, { status: 404, headers: corsHeaders });
    if (product.inventory < item.quantity) return Response.json({ error: "INSUFFICIENT_INVENTORY", productId: item.productId, available: product.inventory, requested: item.quantity }, { status: 409, headers: corsHeaders });
  }
  const quote = lineItems.length === 1 ? buildQuote(findProduct(lineItems[0].productId)!, lineItems[0].quantity) : buildMultiLineQuote(lineItems);
  return Response.json({ merchantId: MERCHANT_ID, quote }, { headers: { ...corsHeaders, "cache-control": "no-store" } });
}
