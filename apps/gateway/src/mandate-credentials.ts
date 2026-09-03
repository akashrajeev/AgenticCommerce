import { createPublicKey, verify } from "node:crypto";
import type { SignedUserMandate, UserMandate } from "@mandate/types";

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

export function canonicalizeUserMandate(mandate: UserMandate): string {
  return JSON.stringify(stableValue(mandate));
}

export function verifySignedUserMandate(mandate: SignedUserMandate): void {
  if (mandate.credential.algorithm !== "Ed25519") throw new Error("UNSUPPORTED_MANDATE_CREDENTIAL");
  if (!mandate.credential.publicKeyPem.trim() || !mandate.credential.signatureBase64.trim()) throw new Error("INVALID_MANDATE_CREDENTIAL");

  const { credential, ...unsignedMandate } = mandate;
  void credential;
  let publicKey;
  try {
    publicKey = createPublicKey(mandate.credential.publicKeyPem);
  } catch {
    throw new Error("INVALID_MANDATE_PUBLIC_KEY");
  }

  let signature: Buffer;
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(mandate.credential.signatureBase64) || mandate.credential.signatureBase64.length % 4 !== 0) {
      throw new Error("INVALID_BASE64");
    }
    signature = Buffer.from(mandate.credential.signatureBase64, "base64");
  } catch {
    throw new Error("INVALID_MANDATE_SIGNATURE");
  }
  if (signature.length !== 64) throw new Error("INVALID_MANDATE_SIGNATURE");

  const valid = verify(null, Buffer.from(canonicalizeUserMandate(unsignedMandate), "utf8"), publicKey, signature);
  if (!valid) throw new Error("INVALID_MANDATE_SIGNATURE");
}
