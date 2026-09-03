import assert from "node:assert/strict";
import test from "node:test";
import { selectPreferredProtocol, type ProtocolSupport } from "@mandate/types";

test("preferred protocol selects implemented MANDATE before adapter targets", () => {
  const protocols: ProtocolSupport[] = [
    { protocol: "acp", version: "2026-04-17", status: "adapter-ready", role: "commerce", capabilities: [] },
    { protocol: "mandate-native", version: "1.0", status: "implemented", role: "commerce", capabilities: ["checkout"] },
  ];
  assert.equal(selectPreferredProtocol(protocols), "mandate-native");
});

test("compatible protocol is usable when native support is absent", () => {
  const protocols: ProtocolSupport[] = [
    { protocol: "acp", version: "2026-04-17", status: "compatible", role: "commerce", capabilities: ["checkout"] },
    { protocol: "ap2", version: "0.2", status: "research", role: "authorization", capabilities: [] },
  ];
  assert.equal(selectPreferredProtocol(protocols), "acp");
});

test("adapter-ready and research protocols cannot be selected", () => {
  const protocols: ProtocolSupport[] = [
    { protocol: "acp", version: "2026-04-17", status: "adapter-ready", role: "commerce", capabilities: [] },
    { protocol: "uap", version: "research", status: "research", role: "payment", capabilities: [] },
    { protocol: "x402", version: "2", status: "adapter-ready", role: "payment", capabilities: [] },
  ];
  assert.throws(() => selectPreferredProtocol(protocols), /NO_SUPPORTED_COMMERCE_PROTOCOL/);
});
