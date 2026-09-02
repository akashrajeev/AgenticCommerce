import { z } from "zod";

export const moneyAmountSchema = z.object({
  currency: z.literal("INR"),
  amountPaise: z.number().int().nonnegative(),
});

export const healthStatusSchema = z.object({
  app: z.enum(["merchant", "buyer", "gateway"]),
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

export type MoneyAmountInput = z.infer<typeof moneyAmountSchema>;
export type HealthStatusInput = z.infer<typeof healthStatusSchema>;
