import type { MerchantManifest } from "./index.js";
import type { AgentIdentity, CommerceProtocol } from "./protocol.js";

export type ProtocolImplementationStatus = "implemented" | "compatible" | "adapter-ready" | "research" | "unsupported";
export type ProtocolRole = "commerce" | "authorization" | "payment";

export type ProtocolSupport = {
  protocol: CommerceProtocol;
  version: string;
  status: ProtocolImplementationStatus;
  role: ProtocolRole;
  capabilities: string[];
};

export type AgentEndpointDescriptor = {
  capabilityId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  requiresAuthentication: boolean;
};

export type PaymentCapability = {
  rail: "razorpay";
  environment: "test";
  methods: string[];
  capabilities: string[];
};

export type AgentCommerceCapabilityDocument = {
  schemaVersion: "1.0";
  agent: AgentIdentity;
  merchant: MerchantManifest;
  protocols: ProtocolSupport[];
  capabilities: Array<{
    capabilityId: string;
    name: string;
    version: string;
    protocol: CommerceProtocol;
    methods: string[];
    endpoint: string;
    requiresAuthentication: boolean;
  }>;
  endpoints: AgentEndpointDescriptor[];
  payments: PaymentCapability[];
  discovery: {
    wellKnown: string;
    capabilities: string;
  };
};

export function selectPreferredProtocol(protocols: ProtocolSupport[]): CommerceProtocol {
  const usable = protocols.filter((entry) => entry.status === "implemented" || entry.status === "compatible");
  const order: CommerceProtocol[] = ["mandate-native", "acp", "ap2", "uap", "x402"];
  const selected = order.find((protocol) => usable.some((entry) => entry.protocol === protocol));
  if (!selected) throw new Error("NO_SUPPORTED_COMMERCE_PROTOCOL");
  return selected;
}
