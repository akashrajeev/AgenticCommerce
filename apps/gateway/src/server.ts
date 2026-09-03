import { createApp } from "./app.js";
import { authorizeCheckout, authorizeSignedCheckout } from "./mandate-authorization.js";
import { config } from "./config.js";

const app = createApp();

app.post("/v1/mandates/authorize", async (request, response) => {
  const providedSecret = request.header("x-mandate-gateway-secret") ?? "";
  if (!providedSecret || providedSecret !== config.internalGatewaySecret) return response.status(401).json({ error: "UNAUTHORIZED_MANDATE_AUTHORIZATION" });
  try {
    const body = request.body as { userMandate?: { credential?: unknown } } | null;
    if (!body || !body.userMandate) return response.status(400).json({ error: "MANDATE_REQUIRED" });
    const result = body.userMandate.credential
      ? await authorizeSignedCheckout(request.body)
      : await authorizeCheckout(request.body);
    return response.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "MANDATE_AUTHORIZATION_FAILED";
    const status = message.startsWith("MANDATE_POLICY_BLOCKED") ? 422 : message.startsWith("INVALID_") || message.includes("_MISMATCH") || message.includes("_EXCEEDED") || message === "MANDATE_EXPIRED" ? 400 : 422;
    return response.status(status).json({ error: message });
  }
});

app.listen(config.port, () => {
  console.log(`MANDATE gateway listening on http://localhost:${config.port}`);
});
