import { createPublicKey, verify } from "node:crypto";

export type X402PaymentRequirements = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

export type X402PaymentRequired = {
  x402Version: 2;
  error?: string;
  resource: { url: string; description?: string; mimeType?: string; serviceName?: string; tags?: string[] };
  accepts: X402PaymentRequirements[];
  extensions: Record<string, unknown>;
};

export type X402PaymentPayload = {
  x402Version: 2;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepted: X402PaymentRequirements;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
};

export type X402VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  extra?: Record<string, unknown>;
};

export type X402SettlementResponse = {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
  amount?: string;
  extensions?: Record<string, unknown>;
};

export type X402ServiceMandate = {
  version: 1;
  mandateId: string;
  subjectId: string;
  agentId: string;
  serviceId: string;
  network: string;
  asset: string;
  payTo: string;
  maxAmountAtomic: string;
  nonce: string;
  expiresAt: string;
  publicKeyPem: string;
  signatureBase64: string;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stableValue(entry)]));
  return value;
}

function canonicalUnsignedMandate(mandate: X402ServiceMandate): string {
  const { signatureBase64: _signature, ...unsigned } = mandate;
  return JSON.stringify(stableValue(unsigned));
}

export function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeBase64Json<T>(value: string): T {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("INVALID_BASE64_JSON");
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8")); } catch { throw new Error("INVALID_BASE64_JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_JSON_OBJECT");
  return parsed as T;
}

export function buildPaymentRequired(resourceUrl: string, serviceName: string, priceAtomic: string, network: string, asset: string, payTo: string, maxTimeoutSeconds = 60, error?: string): X402PaymentRequired {
  return {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: { url: resourceUrl, description: "Paid agent service resource", mimeType: "application/json", serviceName, tags: ["agent-service", "mandate"] },
    accepts: [{ scheme: "exact", network, amount: priceAtomic, asset, payTo, maxTimeoutSeconds, extra: { name: "USDC", version: "2" } }],
    extensions: {},
  };
}

export function paymentRequirementMatches(selected: X402PaymentRequirements, expected: X402PaymentRequirements): boolean {
  return selected.scheme === expected.scheme && selected.network === expected.network && selected.amount === expected.amount && selected.asset === expected.asset && selected.payTo === expected.payTo && selected.maxTimeoutSeconds === expected.maxTimeoutSeconds;
}

const consumedMandates = new Set<string>();

export function verifyX402ServiceMandate(mandate: X402ServiceMandate, expected: X402PaymentRequirements, serviceId: string, now = Date.now()): void {
  if (mandate.version !== 1) throw new Error("UNSUPPORTED_X402_MANDATE");
  if (!mandate.mandateId.trim() || !mandate.subjectId.trim() || !mandate.agentId.trim() || mandate.serviceId !== serviceId) throw new Error("X402_MANDATE_SCOPE_MISMATCH");
  if (mandate.network !== expected.network || mandate.asset !== expected.asset || mandate.payTo !== expected.payTo) throw new Error("X402_MANDATE_PAYMENT_MISMATCH");
  const maxAmount = BigInt(mandate.maxAmountAtomic);
  const requiredAmount = BigInt(expected.amount);
  if (maxAmount < requiredAmount) throw new Error("X402_MANDATE_LIMIT_EXCEEDED");
  const expires = Date.parse(mandate.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) throw new Error("X402_MANDATE_EXPIRED");
  if (!mandate.publicKeyPem.trim() || !mandate.signatureBase64.trim() || !mandate.nonce.trim()) throw new Error("X402_MANDATE_CREDENTIAL_INVALID");
  let publicKey;
  try { publicKey = createPublicKey(mandate.publicKeyPem); } catch { throw new Error("X402_MANDATE_PUBLIC_KEY_INVALID"); }
  let signature: Buffer;
  try { signature = Buffer.from(mandate.signatureBase64, "base64"); } catch { throw new Error("X402_MANDATE_SIGNATURE_INVALID"); }
  if (signature.length !== 64) throw new Error("X402_MANDATE_SIGNATURE_INVALID");
  if (!verify(null, Buffer.from(canonicalUnsignedMandate(mandate), "utf8"), publicKey, signature)) throw new Error("X402_MANDATE_SIGNATURE_INVALID");
  const replayKey = `${mandate.mandateId}:${mandate.nonce}:${expected.amount}:${expected.network}:${expected.asset}:${expected.payTo}`;
  if (consumedMandates.has(replayKey)) throw new Error("X402_MANDATE_REPLAY");
  consumedMandates.add(replayKey);
}

export function clearX402MandateReplayStore(): void { consumedMandates.clear(); }

export async function facilitatorVerify(baseUrl: string, paymentPayload: X402PaymentPayload, paymentRequirements: X402PaymentRequirements): Promise<X402VerifyResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }), cache: "no-store" });
  const body = await response.json().catch(() => null) as X402VerifyResponse | null;
  if (!response.ok || !body) throw new Error(`X402_FACILITATOR_VERIFY_HTTP_${response.status}`);
  return body;
}

export async function facilitatorSettle(baseUrl: string, paymentPayload: X402PaymentPayload, paymentRequirements: X402PaymentRequirements): Promise<X402SettlementResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/settle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }), cache: "no-store" });
  const body = await response.json().catch(() => null) as X402SettlementResponse | null;
  if (!response.ok || !body) throw new Error(`X402_FACILITATOR_SETTLE_HTTP_${response.status}`);
  return body;
}
