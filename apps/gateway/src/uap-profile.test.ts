import assert from "node:assert/strict";
import test from "node:test";
import { buildNpciAdapterEnvelope, evaluateNpciDelegation, NPCI_DELEGATION_PROFILE } from "./uap-profile.js";

test("allows a bounded domestic P2M delegation with explicit user action", () => {
  const decision = evaluateNpciDelegation({
    subjectId: "user_001",
    agentId: "ai-profile-001",
    merchantId: "mandate-market",
    amountPaise: 5_000,
    monthlyUsedPaise: 100_000,
    paymentContext: "domestic-p2m",
    explicitUserAction: true,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.profileId, NPCI_DELEGATION_PROFILE.profileId);
  assert.equal(decision.remainingMonthlyPaise, 1_400_000);
});

test("blocks amounts above the verified per-transaction limit", () => {
  const decision = evaluateNpciDelegation({
    subjectId: "user_001",
    agentId: "ai-profile-001",
    merchantId: "mandate-market",
    amountPaise: 5_001,
    monthlyUsedPaise: 0,
    paymentContext: "domestic-p2m",
    explicitUserAction: true,
  });
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.includes("PER_TRANSACTION_LIMIT_EXCEEDED"));
});

test("blocks monthly budget overflow and missing user action", () => {
  const decision = evaluateNpciDelegation({
    subjectId: "user_001",
    agentId: "ai-profile-001",
    merchantId: "mandate-market",
    amountPaise: 10_000,
    monthlyUsedPaise: 1_495_001,
    paymentContext: "domestic-p2m",
    explicitUserAction: false,
  });
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.includes("MONTHLY_LIMIT_EXCEEDED"));
  assert.ok(decision.reasons.includes("EXPLICIT_USER_ACTION_REQUIRED"));
});

test("builds an adapter envelope without claiming native UAP execution", () => {
  const envelope = buildNpciAdapterEnvelope({
    subjectId: "user_001",
    agentId: "ai-profile-001",
    merchantId: "mandate-market",
    amountPaise: 2_500,
    monthlyUsedPaise: 0,
    paymentContext: "domestic-p2m",
    explicitUserAction: true,
  });
  assert.equal(envelope.protocol, "uap");
  assert.equal(envelope.status, "adapter-ready-not-native");
  assert.equal(envelope.nextAuthority, "mandate-native");
});
