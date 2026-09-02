export type AppName = "merchant" | "buyer" | "gateway";

export type HealthStatus = {
  app: AppName;
  status: "ok";
  timestamp: string;
};

export type MoneyAmount = {
  currency: "INR";
  amountPaise: number;
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  category: string;
  pricePaise: number;
  currency: "INR";
  rating: number;
  reviewCount: number;
  inventory: number;
  shortDescription: string;
  description: string;
  features: string[];
  specifications: Record<string, string>;
  tags: string[];
};

export type MerchantManifest = {
  name: string;
  merchantId: string;
  version: string;
  currency: "INR";
  capabilities: {
    catalog: boolean;
    productLookup: boolean;
    inventory: boolean;
    checkoutPreview: boolean;
    agentCheckout: boolean;
    payment: "razorpay";
  };
  endpoints: {
    catalog: string;
    product: string;
    inventory: string;
    checkoutPreview: string;
  };
};

export type CheckoutQuote = {
  quoteId: string;
  merchantId: string;
  lineItems: Array<{
    productId: string;
    quantity: number;
    unitPricePaise: number;
    lineTotalPaise: number;
  }>;
  subtotalPaise: number;
  shippingPaise: number;
  taxPaise: number;
  discountPaise: number;
  totalPaise: number;
  currency: "INR";
  expiresAt: string;
};

export type PurchaseIntent = {
  id: string;
  merchantId: string;
  productId: string;
  quantity: number;
  maxSpendPaise: number;
  reason: string;
  quoteId: string;
};

export type PolicyCheck = {
  rule: string;
  result: "PASS" | "FAIL";
  observed: string;
  expected: string;
  reason: string;
};

export type PolicyDecision = {
  decision: "ALLOW" | "BLOCK";
  checks: PolicyCheck[];
  evaluatedAt: string;
};

export type TransactionState =
  | "intent_proposed"
  | "price_verified"
  | "policy_pending"
  | "policy_authorized"
  | "policy_blocked"
  | "razorpay_order_created"
  | "checkout_started"
  | "payment_authorized"
  | "payment_captured"
  | "payment_verified"
  | "payment_failed"
  | "order_confirmed"
  | "cancelled";

export type AuditActor =
  | "user"
  | "ai_buyer"
  | "policy_engine"
  | "gateway"
  | "razorpay"
  | "merchant";

export type AuditEvent = {
  id: string;
  transactionId: string;
  actor: AuditActor;
  action: string;
  reason: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
};

export type Transaction = {
  id: string;
  state: TransactionState;
  intent: PurchaseIntent;
  quote: CheckoutQuote;
  policy?: PolicyDecision;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  createdAt: string;
  updatedAt: string;
};
