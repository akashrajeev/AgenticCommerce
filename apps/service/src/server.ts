import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { buildPaymentRequired, canonicalizeX402ServiceMandate, consumeX402ServiceMandate, decodeBase64Json, encodeBase64Json, facilitatorSettle, facilitatorVerify, paymentRequirementMatches, validateX402ServiceMandate, type X402PaymentPayload, type X402PaymentRequirements, type X402SettlementResponse, type X402ServiceMandate } from "./x402.js";

const port = Number.parseInt(process.env.X402_PORT ?? "4021", 10);
const facilitatorUrl = (process.env.X402_FACILITATOR_URL ?? "").trim();
const serviceId = process.env.X402_SERVICE_ID ?? "mandate-premium-data";
const serviceName = process.env.X402_SERVICE_NAME ?? "MANDATE Agent Service";
const priceAtomic = process.env.X402_PRICE_ATOMIC ?? "10000";
const network = process.env.X402_NETWORK ?? "eip155:84532";
const asset = process.env.X402_ASSET ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const payTo = process.env.X402_PAY_TO ?? "";
const maxTimeoutSeconds = Number.parseInt(process.env.X402_MAX_TIMEOUT_SECONDS ?? "60", 10);
const demoMode = process.env.X402_DEMO_MODE === "true";
const resourcePath = "/resource";

const demoKeyPair = generateKeyPairSync("ed25519");
const demoPublicKeyPem = demoKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
let lastSettlementProof: { at: string; facilitator: string; payer: string | null; transaction: string; network: string; amount: string; serviceId: string } | null = null;

type FacilitatorStatus = { configured: boolean; reachable: boolean; url: string | null; status: number; detail: string; supported?: unknown };

function expectedRequirements(): X402PaymentRequirements {
  return { scheme: "exact", network, amount: priceAtomic, asset, payTo, maxTimeoutSeconds, extra: { name: "USDC", version: "2" } };
}

function resourceUrl(request: IncomingMessage): string {
  const proto = typeof request.headers["x-forwarded-proto"] === "string" ? request.headers["x-forwarded-proto"] : "http";
  const host = typeof request.headers.host === "string" ? request.headers.host : `localhost:${port}`;
  return `${proto.split(",")[0]?.trim() ?? "http"}://${host}${resourcePath}`;
}

function writeJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(body));
}

async function facilitatorStatus(): Promise<FacilitatorStatus> {
  if (!facilitatorUrl) return { configured: false, reachable: false, url: null, status: 0, detail: "X402_FACILITATOR_NOT_CONFIGURED" };
  try {
    const response = await fetch(`${facilitatorUrl.replace(/\/$/, "")}/supported`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const supported = await response.json().catch(() => null);
    return { configured: true, reachable: response.ok, url: facilitatorUrl, status: response.status, detail: response.ok ? "Facilitator /supported reachable" : `Facilitator returned HTTP ${response.status}`, ...(supported === null ? {} : { supported }) };
  } catch (error) { return { configured: true, reachable: false, url: facilitatorUrl, status: 0, detail: error instanceof Error ? error.message : "X402_FACILITATOR_UNREACHABLE" }; }
}

function demoMandate(subjectId: string): X402ServiceMandate {
  const now = Date.now();
  const mandate: X402ServiceMandate = { version: 1, mandateId: `demo-x402-${randomUUID()}`, subjectId, agentId: "judge-browser-agent", serviceId, network, asset, payTo, maxAmountAtomic: priceAtomic, nonce: `0x${Buffer.from(randomUUID().replaceAll("-", ""), "hex").toString("hex").padEnd(64, "0").slice(0, 64)}`, expiresAt: new Date(now + 10 * 60_000).toISOString(), publicKeyPem: demoPublicKeyPem, signatureBase64: "" };
  mandate.signatureBase64 = sign(null, Buffer.from(canonicalizeX402ServiceMandate(mandate), "utf8"), demoKeyPair.privateKey).toString("base64");
  return mandate;
}

async function handleResource(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!payTo) return writeJson(response, 503, { error: "X402_SERVICE_NOT_CONFIGURED", detail: "Set X402_PAY_TO before serving a payable resource." });
  const expected = expectedRequirements();
  const required = buildPaymentRequired(resourceUrl(request), serviceName, priceAtomic, network, asset, payTo, maxTimeoutSeconds);
  const paymentHeader = typeof request.headers["payment-signature"] === "string" ? request.headers["payment-signature"] : "";
  if (!paymentHeader) { const challenge = { ...required, error: "PAYMENT-SIGNATURE header is required" }; return writeJson(response, 402, challenge, { "PAYMENT-REQUIRED": encodeBase64Json(challenge) }); }

  let paymentPayload: X402PaymentPayload;
  try { paymentPayload = decodeBase64Json<X402PaymentPayload>(paymentHeader); } catch (error) { const challenge = { ...required, error: error instanceof Error ? error.message : "INVALID_PAYMENT_SIGNATURE" }; return writeJson(response, 402, challenge, { "PAYMENT-REQUIRED": encodeBase64Json(challenge) }); }
  if (paymentPayload.x402Version !== 2 || !paymentRequirementMatches(paymentPayload.accepted, expected)) { const challenge = { ...required, error: "PAYMENT_REQUIREMENT_MISMATCH" }; return writeJson(response, 402, challenge, { "PAYMENT-REQUIRED": encodeBase64Json(challenge) }); }

  const mandateHeader = typeof request.headers["x-mandate-service-mandate"] === "string" ? request.headers["x-mandate-service-mandate"] : "";
  if (!mandateHeader) return writeJson(response, 403, { error: "MANDATE_SERVICE_AUTHORIZATION_REQUIRED", detail: "x402 payment authorization is necessary but not sufficient; a signed MANDATE service authorization is required." });
  let mandate: X402ServiceMandate;
  try { mandate = decodeBase64Json<X402ServiceMandate>(mandateHeader); validateX402ServiceMandate(mandate, expected, serviceId); } catch (error) { return writeJson(response, 403, { error: error instanceof Error ? error.message : "X402_MANDATE_INVALID" }); }

  const authorization = paymentPayload.payload.authorization;
  const payer = authorization && typeof authorization === "object" && typeof (authorization as Record<string, unknown>).from === "string" ? String((authorization as Record<string, unknown>).from) : "";
  if (!payer) return writeJson(response, 403, { error: "X402_PAYER_REQUIRED" });
  if (mandate.subjectId.toLowerCase() !== payer.toLowerCase()) return writeJson(response, 403, { error: "X402_MANDATE_SUBJECT_MISMATCH", detail: "The signed MANDATE service authorization must name the same payer address as the EIP-3009 payment." });

  if (!facilitatorUrl) return writeJson(response, 503, { error: "X402_FACILITATOR_NOT_CONFIGURED", detail: "Set X402_FACILITATOR_URL to a facilitator that supports the selected scheme/network." });
  try {
    const verification = await facilitatorVerify(facilitatorUrl, paymentPayload, expected);
    if (!verification.isValid) { const challenge = { ...required, error: verification.invalidReason ?? "PAYMENT_INVALID" }; return writeJson(response, 402, challenge, { "PAYMENT-REQUIRED": encodeBase64Json(challenge) }); }
    if (verification.payer && verification.payer.toLowerCase() !== payer.toLowerCase()) return writeJson(response, 403, { error: "X402_FACILITATOR_PAYER_MISMATCH" });
    const settlement = await facilitatorSettle(facilitatorUrl, paymentPayload, expected);
    const settlementHeader = encodeBase64Json(settlement satisfies X402SettlementResponse);
    if (!settlement.success) return writeJson(response, 402, { error: "PAYMENT_SETTLEMENT_FAILED", settlement }, { "PAYMENT-RESPONSE": settlementHeader, "PAYMENT-REQUIRED": encodeBase64Json({ ...required, error: settlement.errorReason ?? "Settlement failed" }) });
    consumeX402ServiceMandate(mandate, expected);
    lastSettlementProof = { at: new Date().toISOString(), facilitator: facilitatorUrl, payer: verification.payer ?? settlement.payer ?? payer, transaction: settlement.transaction, network: settlement.network, amount: settlement.amount ?? expected.amount, serviceId };
    return writeJson(response, 200, { service: serviceId, message: "Paid agent resource delivered by MANDATE-controlled x402 adapter.", payer: verification.payer ?? settlement.payer ?? payer, transaction: settlement.transaction, network: settlement.network, amount: settlement.amount ?? expected.amount }, { "PAYMENT-RESPONSE": settlementHeader });
  } catch (error) { return writeJson(response, 502, { error: error instanceof Error ? error.message : "X402_PAYMENT_PROCESSING_FAILED" }); }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") return writeJson(response, 200, { app: "mandate-x402-service", status: "ok", x402Version: 2, serviceId, network, asset, payToConfigured: Boolean(payTo), facilitatorConfigured: Boolean(facilitatorUrl), configured: Boolean(payTo && facilitatorUrl), demoMandateEnabled: demoMode });
  if (request.method === "GET" && request.url === "/facilitator-status") return writeJson(response, 200, await facilitatorStatus());
  if (request.method === "GET" && request.url === "/proof/latest") return writeJson(response, 200, { settlement: lastSettlementProof, live: Boolean(lastSettlementProof) });
  if (request.method === "GET" && request.url?.startsWith("/demo/mandate")) {
    if (!demoMode) return writeJson(response, 404, { error: "X402_DEMO_MANDATE_DISABLED" });
    if (!payTo) return writeJson(response, 503, { error: "X402_SERVICE_NOT_CONFIGURED", detail: "Set X402_PAY_TO before issuing the demo service authorization." });
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const subjectId = url.searchParams.get("subjectId")?.trim() ?? "";
    if (!subjectId) return writeJson(response, 400, { error: "X402_DEMO_SUBJECT_REQUIRED" });
    return writeJson(response, 200, { demoOnly: true, warning: "Self-signed demo credential; not a production issuer.", mandate: demoMandate(subjectId) });
  }
  if (request.method === "GET" && request.url === resourcePath) return handleResource(request, response);
  return writeJson(response, 404, { error: "NOT_FOUND" });
});

server.listen(port, () => console.log(`MANDATE x402 service listening on http://127.0.0.1:${port}${resourcePath}`));
