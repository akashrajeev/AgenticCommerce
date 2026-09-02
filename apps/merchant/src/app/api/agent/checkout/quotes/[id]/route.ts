import { getQuote } from "../../../../../../../lib/catalog";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const quote = getQuote(id);

  if (!quote) {
    return Response.json({ error: "QUOTE_NOT_FOUND" }, { status: 404 });
  }

  return Response.json(
    { quote },
    {
      headers: {
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    },
  );
}
