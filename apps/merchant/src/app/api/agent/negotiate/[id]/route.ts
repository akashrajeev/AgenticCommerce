import { getStoredNegotiation } from "../../../../lib/agent-negotiation";

const headers = {
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const negotiation = getStoredNegotiation(id);
  if (!negotiation) return Response.json({ error: "NEGOTIATION_NOT_FOUND" }, { status: 404, headers });
  return Response.json(negotiation, { headers });
}
