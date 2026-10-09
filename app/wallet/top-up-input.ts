import type { UUID } from "@/domain";
import { DomainError } from "@/domain";
import { invalidRequest } from "@/app/http/request-failure";
import { walletTopUpRequestSchema } from "./contracts";
import type { WalletTopUpRequest } from "./dependencies";
import { z } from "zod";

export interface TopUpActionInput {
  readonly userId: UUID;
  readonly body: WalletTopUpRequest;
}

/**
 * Validates the top-up body and combines it with the authenticated user ID.
 * Ensures amount is bounded between SGD 1.00 (100 cents) and SGD 1,000.00 (100,000 cents).
 */
export function parseTopUpInput(userId: UUID, body: unknown): TopUpActionInput {
  if (typeof body !== "object" || body === null) {
    throw invalidRequest("Request body must be an object");
  }

  const record = body as Record<string, unknown>;

  if (
    typeof record.amountCents === "number" &&
    Number.isInteger(record.amountCents) &&
    (record.amountCents < 100 || record.amountCents > 100000)
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "Amount must be between SGD 1.00 and SGD 1,000.00 (100 to 100,000 cents)",
    );
  }

  try {
    const parsed = walletTopUpRequestSchema.parse(body);
    return { userId, body: parsed };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw invalidRequest(
        error.issues[0]?.message ?? "Invalid top-up request",
      );
    }
    throw invalidRequest("Invalid top-up request");
  }
}
