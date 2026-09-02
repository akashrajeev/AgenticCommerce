import { catalog, MERCHANT_ID } from "../../../../lib/catalog";

export function GET() {
  return Response.json(
    {
      merchantId: MERCHANT_ID,
      currency: "INR",
      products: catalog.map(({ description, specifications, ...product }) => ({
        ...product,
        description,
        specifications,
        price: product.pricePaise / 100,
        availability: product.inventory > 0 ? "in_stock" : "out_of_stock",
      })),
    },
    {
      headers: {
        "cache-control": "public, max-age=30",
        "access-control-allow-origin": "*",
      },
    },
  );
}
