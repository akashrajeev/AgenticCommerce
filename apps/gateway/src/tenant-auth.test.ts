import assert from "node:assert/strict";
import test from "node:test";
import { assertTenantOwnership, authenticateTenantPrincipal, parseTenantApiKeys } from "./tenant-auth.js";

test("parses tenant API keys into immutable tenant principals", () => {
  const credentials = parseTenantApiKeys(JSON.stringify({
    key_alpha: { tenantId: "tenant_alpha", subjectId: "user_alpha", roles: ["owner", "buyer", "buyer"] },
    key_beta: "user_beta",
  }));

  assert.deepEqual(credentials.get("key_alpha"), {
    tenantId: "tenant_alpha",
    subjectId: "user_alpha",
    roles: ["owner", "buyer"],
  });
  assert.deepEqual(credentials.get("key_beta"), {
    tenantId: "user_beta",
    subjectId: "user_beta",
    roles: ["owner"],
  });
});

test("rejects malformed tenant key configuration", () => {
  assert.throws(() => parseTenantApiKeys("not-json"), /INVALID_TENANT_API_KEY_CONFIGURATION/);
  assert.throws(() => parseTenantApiKeys(JSON.stringify({ key: { tenantId: "", subjectId: "" } })), /INVALID_TENANT_API_KEY_CONFIGURATION/);
});

test("authenticates the configured bearer credential and rejects impostors", () => {
  const credentials = parseTenantApiKeys(JSON.stringify({
    alpha_secret: { tenantId: "tenant_alpha", subjectId: "user_alpha", roles: ["owner"] },
  }));

  assert.deepEqual(authenticateTenantPrincipal("Bearer alpha_secret", credentials), {
    tenantId: "tenant_alpha",
    subjectId: "user_alpha",
    roles: ["owner"],
  });
  assert.throws(() => authenticateTenantPrincipal(undefined, credentials), /TENANT_AUTH_REQUIRED/);
  assert.throws(() => authenticateTenantPrincipal("Bearer wrong_secret", credentials), /INVALID_TENANT_AUTH/);
  assert.throws(() => authenticateTenantPrincipal("Basic alpha_secret", credentials), /TENANT_AUTH_REQUIRED/);
});

test("tenant ownership rejects cross-tenant mandate access", () => {
  const principal = { tenantId: "tenant_alpha", subjectId: "user_alpha", roles: ["owner"] };
  assert.doesNotThrow(() => assertTenantOwnership(principal, "user_alpha"));
  assert.throws(() => assertTenantOwnership(principal, "user_beta"), /TENANT_OWNERSHIP_FORBIDDEN/);
});
