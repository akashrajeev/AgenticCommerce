import { generateKeyPairSync, privateDecrypt, sign } from "node:crypto";
import { config } from "./config";

export type MerchantAgentCredential = {
  algorithm: "Ed25519";
  keyId: string;
  merchantId: string;
  agentId: string;
  issuer: string;
  publicKeyPem: string;
};

let cached: { privateKeyPem: string; credential: MerchantAgentCredential } | null = null;

function buildIdentity() {
  if (cached) return cached;
  const merchantId = "mandate-market";
  const agentId = "merchant-agent:mandate-market";
  const issuer = merchantId;
  const privateKeyPem = config.merchantAgentPrivateKeyPem.trim();
  const keyId = config.merchantAgentKeyId.trim() || "merchant-agent-ed25519-1";

  if (privateKeyPem) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    void privateKey;
    void publicKey;
    throw new Error("MERCHANT_AGENT_PRIVATE_KEY_CONFIGURATION_UNSUPPORTED");
  }

  if (process.env.NODE_ENV === "production") throw new Error("MERCHANT_AGENT_PRIVATE_KEY_REQUIRED");
  const generated = generateKeyPairSync("ed25519");
  const privatePem = generated.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = generated.publicKey.export({ format: "pem", type: "spki" }).toString();
  cached = {
    privateKeyPem: privatePem,
    credential: { algorithm: "Ed25519", keyId, merchantId, agentId, issuer, publicKeyPem: publicPem },
  };
  return cached;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stableValue(entry)]));
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
  const signature = sign(null, payload, identity.privateKeyPem);
  return { credential: identity.credential, signatureBase64: signature.toString("base64") };
}
