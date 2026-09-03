import { getMerchantAgentCredential } from "../../../lib/agent-identity";

export function GET() {
  try {
    return Response.json(
      {
        version: "1.0",
        credential: getMerchantAgentCredential(),
      },
      {
        headers: {
          "cache-control": "public, max-age=300",
          "access-control-allow-origin": "*",
          "x-agent-commerce-version": "1.0",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "MERCHANT_AGENT_CREDENTIAL_UNAVAILABLE";
    return Response.json({ error: message }, { status: message === "MERCHANT_AGENT_PRIVATE_KEY_REQUIRED" ? 503 : 500 });
  }
}
