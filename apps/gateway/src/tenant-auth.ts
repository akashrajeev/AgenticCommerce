import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export type TenantPrincipal = {
  tenantId: string;
  subjectId: string;
  roles: string[];
};

type TenantCredentialInput =
  | string
  | {
      tenantId?: unknown;
      subjectId?: unknown;
      roles?: unknown;
    };

export function parseTenantApiKeys(raw: string): Map<string, TenantPrincipal> {
  if (!raw.trim()) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("INVALID_TENANT_API_KEY_CONFIGURATION");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_TENANT_API_KEY_CONFIGURATION");

  const result = new Map<string, TenantPrincipal>();
  for (const [apiKey, credential] of Object.entries(parsed as Record<string, TenantCredentialInput>)) {
    if (!apiKey.trim()) throw new Error("INVALID_TENANT_API_KEY_CONFIGURATION");
    const normalized = normalizeCredential(credential);
    result.set(apiKey, normalized);
  }
  return result;
}

function normalizeCredential(credential: TenantCredentialInput): TenantPrincipal {
  if (typeof credential === "string") {
    const subjectId = credential.trim();
    if (!subjectId) throw new Error("INVALID_TENANT_API_KEY_CONFIGURATION");
    return { tenantId: subjectId, subjectId, roles: ["owner"] };
  }
  if (!credential || typeof credential !== "object") throw new Error("INVALID_TENANT_API_KEY_CONFIGURATION");
  const subjectId = typeof credential.subjectId === "string" ? credential.subjectId.trim() : "";
  const tenantId = typeof credential.tenantId === "string" && credential.tenantId.trim() ? credential.tenantId.trim() : subjectId;
  const roles = Array.isArray(credential.roles) && credential.roles.every((role) => typeof role === "string")
    ? [...new Set(credential.roles.map((role) => role.trim()).filter(Boolean))]
    : ["owner"];
  if (!subjectId || !tenantId || roles.length === 0) throw new Error("INVALID_TENANT_API_KEY_CONFIGURATION");
  return { tenantId, subjectId, roles };
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export function authenticateTenantPrincipal(authorizationHeader: string | undefined, credentials: Map<string, TenantPrincipal>): TenantPrincipal {
  const header = authorizationHeader?.trim() ?? "";
  if (!header.startsWith("Bearer ")) throw new Error("TENANT_AUTH_REQUIRED");
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new Error("TENANT_AUTH_REQUIRED");

  for (const [apiKey, principal] of credentials) {
    if (sameSecret(token, apiKey)) return principal;
  }
  throw new Error("INVALID_TENANT_AUTH");
}

export function assertTenantOwnership(principal: TenantPrincipal, subjectId: string): void {
  if (principal.subjectId !== subjectId) throw new Error("TENANT_OWNERSHIP_FORBIDDEN");
}

export function requireTenantPrincipal(authorizationHeader?: string): TenantPrincipal | null {
  if (!config.tenantAuthRequired) return null;

  const credentials = parseTenantApiKeys(config.tenantApiKeysJson);
  if (credentials.size === 0) throw new Error("TENANT_AUTH_NOT_CONFIGURED");
  return authenticateTenantPrincipal(authorizationHeader, credentials);
}
