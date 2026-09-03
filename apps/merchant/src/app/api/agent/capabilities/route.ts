import { agentCommerceCapabilities } from "../../../../lib/agent-capabilities";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedVersion = url.searchParams.get("version");
  if (requestedVersion && requestedVersion !== agentCommerceCapabilities.schemaVersion) {
    return Response.json({
      error: "UNSUPPORTED_CAPABILITY_VERSION",
      supportedVersions: [agentCommerceCapabilities.schemaVersion],
    }, { status: 406 });
  }

  return Response.json(agentCommerceCapabilities, {
    headers: {
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
      "x-agent-commerce-version": agentCommerceCapabilities.schemaVersion,
    },
  });
}
