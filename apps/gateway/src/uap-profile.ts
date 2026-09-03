export const NPCI_DELEGATION_PROFILE = {
  profileId: "npci-delegated-upi-v1",
  status: "research-adapter-ready" as const,
  nativeUapSpecAvailable: false,
  paymentContext: "domestic-p2m" as const,
  requireExplicitUserAction: true,
  maxPerTransactionPaise: 500_000,
  maxMonthlyPaise: 1_500_000,
  sourceNote: "Derived from NPCI UPI Circle IoT delegation limits published in NPCI/UPI/2024-25/OC-201B; not claimed as the UAP wire protocol.",
};

export type NpciDelegationRequest = {
  subjectId: string;
  agentId: string;
  merchantId: string;
  amountPaise: number;
  monthlyUsedPaise: number;
  paymentContext: "domestic-p2m" | string;
  explicitUserAction: boolean;
};

export type NpciDelegationDecision = {
  allowed: boolean;
  profileId: string;
  reasons: string[];
  remainingMonthlyPaise: number;
  maxPerTransactionPaise: number;
};

export function evaluateNpciDelegation(request: NpciDelegationRequest): NpciDelegationDecision {
  const reasons: string[] = [];
  if (!request.subjectId.trim() || !request.agentId.trim() || !request.merchantId.trim()) reasons.push("DELEGATION_IDENTITY_REQUIRED");
  if (!Number.isSafeInteger(request.amountPaise) || request.amountPaise <= 0) reasons.push("INVALID_AMOUNT");
  if (!Number.isSafeInteger(request.monthlyUsedPaise) || request.monthlyUsedPaise < 0) reasons.push("INVALID_MONTHLY_USAGE");
  if (request.paymentContext !== NPCI_DELEGATION_PROFILE.paymentContext) reasons.push("DOMESTIC_P2M_REQUIRED");
  if (!request.explicitUserAction && NPCI_DELEGATION_PROFILE.requireExplicitUserAction) reasons.push("EXPLICIT_USER_ACTION_REQUIRED");
  if (request.amountPaise > NPCI_DELEGATION_PROFILE.maxPerTransactionPaise) reasons.push("PER_TRANSACTION_LIMIT_EXCEEDED");
  if (request.monthlyUsedPaise + request.amountPaise > NPCI_DELEGATION_PROFILE.maxMonthlyPaise) reasons.push("MONTHLY_LIMIT_EXCEEDED");

  return {
    allowed: reasons.length === 0,
    profileId: NPCI_DELEGATION_PROFILE.profileId,
    reasons,
    remainingMonthlyPaise: Math.max(0, NPCI_DELEGATION_PROFILE.maxMonthlyPaise - request.monthlyUsedPaise),
    maxPerTransactionPaise: NPCI_DELEGATION_PROFILE.maxPerTransactionPaise,
  };
}

export function buildNpciAdapterEnvelope(request: NpciDelegationRequest): {
  protocol: "uap";
  status: "adapter-ready-not-native";
  subjectId: string;
  agentId: string;
  merchantId: string;
  amountPaise: number;
  policy: NpciDelegationDecision;
  nextAuthority: "mandate-native";
} {
  const policy = evaluateNpciDelegation(request);
  return {
    protocol: "uap",
    status: "adapter-ready-not-native",
    subjectId: request.subjectId,
    agentId: request.agentId,
    merchantId: request.merchantId,
    amountPaise: request.amountPaise,
    policy,
    nextAuthority: "mandate-native",
  };
}
