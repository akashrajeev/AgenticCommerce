import { z } from "zod";

export const moneyAmountSchema = z.object({ currency: z.literal("INR"), amountPaise: z.number().int().nonnegative() });
export const healthStatusSchema = z.object({ app: z.enum(["merchant", "buyer", "gateway"]), status: z.literal("ok"), timestamp: z.string().datetime() });

export const purchaseIntentLineItemSchema = z.object({ productId: z.string().min(1), quantity: z.number().int().positive().max(10) });
export const purchaseIntentSchema = z.object({
  merchantId: z.string().min(1), productId: z.string().min(1), quantity: z.number().int().positive().max(10),
  lineItems: z.array(purchaseIntentLineItemSchema).min(1).max(10).optional(),
  maxSpendPaise: z.number().int().nonnegative(), reason: z.string().min(1).max(500), quoteId: z.string().min(1),
});
export const checkoutPreviewLineItemSchema = z.object({ productId: z.string().min(1), quantity: z.number().int().positive().max(10) });
export const checkoutPreviewSchema = z.object({ productId: z.string().min(1), quantity: z.number().int().positive().max(10), lineItems: z.array(checkoutPreviewLineItemSchema).min(1).max(10).optional() });
export type MoneyAmountInput = z.infer<typeof moneyAmountSchema>;
export type HealthStatusInput = z.infer<typeof healthStatusSchema>;
export type PurchaseIntentInput = z.infer<typeof purchaseIntentSchema>;
export type CheckoutPreviewInput = z.infer<typeof checkoutPreviewSchema>;
