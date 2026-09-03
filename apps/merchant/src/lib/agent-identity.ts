import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

export type MerchantAgentCredential = {
  algorithm: "Ed25519";
  keyId: string;
  merchantId: string;
  agentId: string;
  issuer: string;
  publicKeyPem: string;
};

type MerchantAgentIdentity = {
  privateKey: ReturnType<typeof createPrivateKey>;
  credential: MerchantAgentCredential;
};

let cached: MerchantAgentIdentity | null = null;

function buildIdentity(): MerchantAgentIdentity {
  if (cached) return cached;
  const merchantId = "mandate-market";
  const agentId = "merchant-agent:mandate-market";
  const issuer = merchantId;
  const keyId = process.env.MERCHANT_AGENT_KEY_ID?.trim() || "merchant-agent-ed25519-1";
  const configuredKey = process.env.MERCHANT_AGENT_PRIVATE_KEY_B64?.trim() || "";

  if (!configuredKey && process.env.NODE_ENV === "production") throw new Error("MERCHANT_AGENT_PRIVATE_KEY_REQUIRED");

  let privateKey: ReturnType<typeof createPrivateKey>;
  if (configuredKey) {
    try {
      privateKey = createPrivateKey({
        key: Buffer.from(configuredKey, "base64").toString("utf8"),
        format: "pem",
        type: "pkcs8",
      });
    } catch {
      throw new Error("INVALID_MERCHANT_AGENT_PRIVATE_KEY");
    }
  } else {
    privateKey = generateKeyPairSync("ed25519").privateKey;
  }

  const publicKeyPem = createPublicKey(privateKey).export({ format: "pem", type: "spki" }).toString();
  cached = {
    privateKey,
    credential: { algorithm: "Ed25519", keyId, merchantId, agentId, issuer, publicKeyPem },
  };
  return cached;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function canonicalizeMerchantOfferAttestation(input: { offer: unknown; credential: MerchantAgentCredential }): string {
  return JSON.stringify(stableValue(input));
}

export function getMerchantAgentCredential(): MerchantAgentCredential {
  return buildIdentity().credential;
}

export function signMerchantOffer(offer: unknown): { credential: MerchantAgentCredential; signatureBase64: string } {
  const identity = buildIdentity();
  const payload = Buffer.from(canonicalizeMerchantOfferAttestation({ offer, credential: identity.credential }), "utf8");
  const signature = sign(null, payload, identity.privateKey);
  return { credential: identity.credential, signatureBase64: signature.toString("base64") };
}
