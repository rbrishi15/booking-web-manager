import { z } from "@/app/openapi/contracts";

export const uuidSchema = z.string().uuid();
export const centsSchema = z.number().int().nonnegative().safe();
export const positiveCentsSchema = z.number().int().positive().safe();
export const idempotencyKeySchema = z.string().trim().min(1).max(200);

export const activeHoldSchema = z.object({
  holdId: uuidSchema,
  sessionId: uuidSchema,
  isBooker: z.boolean().optional().describe("Whether the wallet owner booked this session"),
  heldCents: centsSchema,
  originalCents: positiveCentsSchema,
  createdAt: z.string().datetime(),
  venueName: z.string().optional(),
  sport: z.string().optional(),
  startAt: z.string().datetime().optional(),
});

export const walletSummarySchema = z.object({
  walletId: uuidSchema,
  userId: uuidSchema,
  availableBalanceCents: centsSchema,
  heldBalanceCents: centsSchema,
  pendingPayoutCents: centsSchema,
  currency: z.literal("SGD"),
  activeHolds: z.array(activeHoldSchema),
});

export const transactionKindSchema = z.enum([
  "TOP_UP",
  "LOCK",
  "RELEASE",
  "REFUND",
  "FORFEIT",
  "PAYOUT",
]);

export const walletTransactionSchema = z.object({
  transactionId: uuidSchema,
  kind: transactionKindSchema,
  amountCents: positiveCentsSchema,
  occurredAt: z.string().datetime(),
  idempotencyKey: z.string(),
  externalReference: z.string().nullable(),
  holdId: uuidSchema.nullable(),
  payoutId: uuidSchema.nullable(),
  sport: z.string().min(1).optional(),
});

export const walletTransactionsResponseSchema = z.object({
  items: z.array(walletTransactionSchema),
  nextCursor: z.string().nullable(),
});

export const walletTopUpRequestSchema = z.object({
  amountCents: z
    .number()
    .int()
    .min(100, "Minimum top-up is SGD 1.00 (100 cents)")
    .max(100000, "Maximum top-up is SGD 1,000.00 (100,000 cents)"),
  idempotencyKey: idempotencyKeySchema,
});

export const walletTopUpResultSchema = z.object({
  paymentIntentId: z.string(),
  clientSecret: z.string(),
  amountCents: positiveCentsSchema,
  currency: z.literal("SGD"),
  status: z.string(),
  qrCode: z.object({
    imageUrlPng: z.string().url(),
    hostedInstructionsUrl: z.string().url().optional(),
    testPaymentUrl: z.string().url().optional(),
    expiresAt: z.number().int().positive(),
  }),
});
