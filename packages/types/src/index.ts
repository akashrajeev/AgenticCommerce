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

export type TransactionState =
  | "intent_proposed"
  | "policy_authorized"
  | "policy_blocked"
  | "razorpay_order_created"
  | "checkout_started"
  | "payment_verified"
  | "payment_failed"
  | "cancelled";

export type AuditActor = "user" | "ai_buyer" | "policy_engine" | "gateway" | "razorpay";

export type AuditEvent = {
  id: string;
  transactionId: string;
  actor: AuditActor;
  action: string;
  reason: string;
  createdAt: string;
};
