import { findProduct, MERCHANT_ID } from "../../../../../lib/catalog";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const product = findProduct(id);

  if (!product) {
    return Response.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }

  return Response.json(
    {
      merchantId: MERCHANT_ID,
      product: {
        ...product,
        price: product.pricePaise / 100,
        availability: product.inventory > 0 ? "in_stock" : "out_of_stock",
      },
    },
    { headers: { "access-control-allow-origin": "*" } },
  );
}
