import assert from "node:assert/strict";
import test from "node:test";
import { parseTenantApiKeys } from "./tenant-auth.js";

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
