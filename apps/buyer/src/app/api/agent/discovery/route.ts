import { selectPreferredProtocol, type AgentCommerceCapabilityDocument } from "@mandate/types";

const merchantInternalUrl = (process.env.MERCHANT_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");

function isValidCapabilityDocument(value: unknown): value is AgentCommerceCapabilityDocument {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<AgentCommerceCapabilityDocument>;
  return body.schemaVersion === "1.0"
    && Boolean(body.agent && typeof body.agent.agentId === "string" && body.agent.agentType === "merchant")
    && Boolean(body.merchant && typeof body.merchant.merchantId === "string")
    && Array.isArray(body.protocols)
    && Array.isArray(body.capabilities)
    && Array.isArray(body.endpoints)
    && Array.isArray(body.payments)
    && Boolean(body.discovery && typeof body.discovery.wellKnown === "string");
}

export async function GET() {
  const response = await fetch(`${merchantInternalUrl}/api/agent/capabilities?version=1.0`, { cache: "no-store" });
  if (!response.ok) {
    return Response.json({ error: "AGENT_DISCOVERY_FAILED", merchantStatus: response.status }, { status: 502 });
  }

  const payload = await response.json().catch(() => null);
  if (!isValidCapabilityDocument(payload)) {
    return Response.json({ error: "INVALID_AGENT_CAPABILITY_DOCUMENT" }, { status: 502 });
  }

  let selectedProtocol;
  try {
    selectedProtocol = selectPreferredProtocol(payload.protocols);
  } catch {
    return Response.json({ error: "NO_SUPPORTED_COMMERCE_PROTOCOL" }, { status: 409 });
  }

  return Response.json({
    merchant: payload.merchant,
    agent: payload.agent,
    schemaVersion: payload.schemaVersion,
    selectedProtocol,
    selectedProtocolVersion: payload.protocols.find((entry) => entry.protocol === selectedProtocol)?.version,
    protocols: payload.protocols,
    capabilities: payload.capabilities,
    endpoints: payload.endpoints,
    payments: payload.payments,
    discovery: payload.discovery,
  }, {
    headers: {
      "cache-control": "no-store",
    },
  });
}
