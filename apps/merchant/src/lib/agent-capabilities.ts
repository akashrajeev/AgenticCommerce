import type { AgentCommerceCapabilityDocument } from "@mandate/types";
import { MERCHANT_ID, merchantManifest } from "./catalog";

export const agentCommerceCapabilities: AgentCommerceCapabilityDocument = {
  schemaVersion: "1.0",
  agent: {
    agentId: `${MERCHANT_ID}-agent-v1`,
    agentType: "merchant",
    name: "Mandate Market Merchant Agent",
    issuer: MERCHANT_ID,
  },
  merchant: merchantManifest,
  protocols: [
    { protocol: "mandate-native", version: "1.0", status: "implemented", role: "commerce", capabilities: ["merchant-discovery", "catalog", "inventory", "checkout-preview", "agent-checkout", "recommendations", "orders"] },
    { protocol: "acp", version: "2026-04-17", status: "adapter-ready", role: "commerce", capabilities: ["checkout-session-mapping"] },
    { protocol: "ap2", version: "0.2", status: "research", role: "authorization", capabilities: ["checkout-mandate-model", "payment-mandate-model", "checkout-hash-binding"] },
    { protocol: "uap", version: "research", status: "research", role: "payment", capabilities: ["delegated-payment-model", "bounded-spend-model", "agent-identity-model"] },
    { protocol: "x402", version: "2", status: "adapter-ready", role: "payment", capabilities: ["service-payment-adapter-boundary"] },
  ],
  capabilities: [
    { capabilityId: "merchant-discovery", name: "Machine-readable merchant discovery", version: "1.0", protocol: "mandate-native", methods: ["GET"], endpoint: "/.well-known/agent-commerce", requiresAuthentication: false },
    { capabilityId: "agent-capabilities", name: "Versioned agent capability document", version: "1.0", protocol: "mandate-native", methods: ["GET"], endpoint: "/api/agent/capabilities", requiresAuthentication: false },
    { capabilityId: "catalog", name: "Product catalog", version: "1.0", protocol: "mandate-native", methods: ["GET"], endpoint: "/api/agent/catalog", requiresAuthentication: false },
    { capabilityId: "product-lookup", name: "Product lookup", version: "1.0", protocol: "mandate-native", methods: ["GET"], endpoint: "/api/agent/products/:id", requiresAuthentication: false },
    { capabilityId: "inventory", name: "Inventory lookup", version: "1.0", protocol: "mandate-native", methods: ["GET"], endpoint: "/api/agent/inventory/:id", requiresAuthentication: false },
    { capabilityId: "checkout-preview", name: "Fresh checkout quote", version: "1.0", protocol: "mandate-native", methods: ["POST"], endpoint: "/api/agent/checkout/preview", requiresAuthentication: false },
    { capabilityId: "quote-retrieval", name: "Checkout quote retrieval", version: "1.0", protocol: "mandate-native", methods: ["GET"], endpoint: "/api/agent/checkout/quotes/:id", requiresAuthentication: false },
    { capabilityId: "revenue-recommendations", name: "Merchant-owned upsell and cross-sell recommendations", version: "1.0", protocol: "mandate-native", methods: ["GET"], endpoint: "/api/agent/recommendations?productId=:id&maxSpendPaise=:limit", requiresAuthentication: false },
    { capabilityId: "agent-order-confirmation", name: "Gateway-authorized merchant order confirmation", version: "1.0", protocol: "mandate-native", methods: ["POST"], endpoint: "/api/agent/orders/confirm", requiresAuthentication: true },
  ],
  endpoints: [
    { capabilityId: "merchant-discovery", method: "GET", path: "/.well-known/agent-commerce", description: "Backward-compatible merchant manifest and discovery entry point.", requiresAuthentication: false },
    { capabilityId: "agent-capabilities", method: "GET", path: "/api/agent/capabilities", description: "Versioned machine-readable capabilities, protocol support and payment capabilities.", requiresAuthentication: false },
    { capabilityId: "catalog", method: "GET", path: "/api/agent/catalog", description: "Authoritative merchant catalog.", requiresAuthentication: false },
    { capabilityId: "product-lookup", method: "GET", path: "/api/agent/products/:id", description: "Authoritative product lookup.", requiresAuthentication: false },
    { capabilityId: "inventory", method: "GET", path: "/api/agent/inventory/:id", description: "Current merchant inventory.", requiresAuthentication: false },
    { capabilityId: "checkout-preview", method: "POST", path: "/api/agent/checkout/preview", description: "Authoritative merchant quote for a proposed basket.", requiresAuthentication: false },
    { capabilityId: "quote-retrieval", method: "GET", path: "/api/agent/checkout/quotes/:id", description: "Retrieves a previously issued quote while it is valid.", requiresAuthentication: false },
    { capabilityId: "revenue-recommendations", method: "GET", path: "/api/agent/recommendations?productId=:id&maxSpendPaise=:limit", description: "Inventory-aware merchant revenue opportunity recommendations.", requiresAuthentication: false },
    { capabilityId: "agent-order-confirmation", method: "POST", path: "/api/agent/orders/confirm", description: "Confirms an order only after gateway-side payment authorization.", requiresAuthentication: true },
  ],
  payments: [
    { rail: "razorpay", environment: "test", methods: ["standard_checkout"], capabilities: ["orders", "payments", "signature-verification", "webhooks"] },
  ],
  supportedCurrencies: ["INR"],
  supportedPaymentMethods: ["razorpay_standard_checkout"],
  supportedExtensions: ["multi-line-baskets", "merchant-recommendations", "deterministic-policy-gate", "audit-trail"],
  discovery: {
    wellKnown: "/.well-known/agent-commerce",
    capabilities: "/api/agent/capabilities",
  },
};
