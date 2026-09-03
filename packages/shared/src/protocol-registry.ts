export type ProtocolStatus = "implemented" | "experiment" | "adapter-target" | "semantic-alignment" | "research-adapter-ready";
export type ProtocolId = "mandate-native" | "acp" | "ap2" | "uap" | "x402" | "mcp";
export type ProtocolTarget = "merchant-checkout" | "agent-service" | "tool-payment" | "delegated-upi";

export type ProtocolDescriptor = {
  id: ProtocolId;
  name: string;
  status: ProtocolStatus;
  transport: string;
  authority: string;
  evidence: string;
  demoEnabled: boolean;
  target: ProtocolTarget[];
};

export const protocolRegistry: ProtocolDescriptor[] = [
  {
    id: "mandate-native",
    name: "MANDATE Native",
    status: "implemented",
    transport: "gateway-native JSON APIs",
    authority: "MANDATE authorization + policy gateway",
    evidence: "/negotiation · delegated mandates",
    demoEnabled: true,
    target: ["merchant-checkout", "delegated-upi"],
  },
  {
    id: "acp",
    name: "ACP Adapter",
    status: "adapter-target",
    transport: "ACP checkout session adapter",
    authority: "MANDATE gateway",
    evidence: "checkout-session adapter + capability advertisement",
    demoEnabled: false,
    target: ["merchant-checkout"],
  },
  {
    id: "ap2",
    name: "AP2 Alignment",
    status: "semantic-alignment",
    transport: "credential/cart mapping target",
    authority: "MANDATE gateway",
    evidence: "cart binding + mandate model alignment",
    demoEnabled: false,
    target: ["merchant-checkout"],
  },
  {
    id: "uap",
    name: "NPCI UAP Profile",
    status: "research-adapter-ready",
    transport: "NPCI delegated-payment profile",
    authority: "primary-user delegated authority",
    evidence: "adapter-ready bounded delegation policy; no public UAP wire spec claimed",
    demoEnabled: false,
    target: ["delegated-upi"],
  },
  {
    id: "x402",
    name: "x402 v2",
    status: "experiment",
    transport: "HTTP 402 + PAYMENT-REQUIRED/PAYMENT-SIGNATURE",
    authority: "signed service mandate + facilitator",
    evidence: "/x402 · apps/service x402 v2 tests",
    demoEnabled: true,
    target: ["agent-service"],
  },
  {
    id: "mcp",
    name: "MANDATE MCP Facade",
    status: "implemented",
    transport: "MCP 2026-07-28 stateless HTTP",
    authority: "MANDATE transaction + authorization boundary",
    evidence: "/mcp · guarded Razorpay tool suite",
    demoEnabled: true,
    target: ["tool-payment"],
  },
];

export function usableProtocols(target: ProtocolTarget): ProtocolDescriptor[] {
  return protocolRegistry.filter((protocol) => protocol.target.includes(target) && protocol.demoEnabled);
}

export function resolveProtocol(target: ProtocolTarget): ProtocolDescriptor {
  const selected = usableProtocols(target)[0];
  if (!selected) throw new Error(`NO_EXECUTABLE_PROTOCOL_FOR_${target.replace(/-/g, "_").toUpperCase()}`);
  return selected;
}

export function protocolSummary(): { total: number; executable: number; adapterReady: number; byStatus: Record<ProtocolStatus, number> } {
  const byStatus = protocolRegistry.reduce<Record<ProtocolStatus, number>>((counts, protocol) => {
    counts[protocol.status] = (counts[protocol.status] ?? 0) + 1;
    return counts;
  }, {
    implemented: 0,
    experiment: 0,
    "adapter-target": 0,
    "semantic-alignment": 0,
    "research-adapter-ready": 0,
  });
  return {
    total: protocolRegistry.length,
    executable: protocolRegistry.filter((protocol) => protocol.demoEnabled).length,
    adapterReady: protocolRegistry.filter((protocol) => protocol.status === "research-adapter-ready" || protocol.status === "adapter-target" || protocol.status === "semantic-alignment").length,
    byStatus,
  };
}
