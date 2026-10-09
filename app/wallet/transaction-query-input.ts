import type { UUID } from "@/domain";
import { invalidRequest } from "@/app/http/request-failure";
import { z } from "zod";

const transactionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().datetime().optional(),
});

export interface TransactionQueryActionInput {
  readonly userId: UUID;
  readonly query: {
    readonly limit?: number;
    readonly before?: Date;
  };
}

/**
 * Validates the transaction pagination query and combines it with the authenticated user ID.
 */
export function parseTransactionQueryInput(
  userId: UUID,
  request: Request,
): TransactionQueryActionInput {
  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const beforeParam = url.searchParams.get("before");

    const parsed = transactionQuerySchema.parse({
      limit: limitParam === null ? undefined : limitParam,
      before: beforeParam === null ? undefined : beforeParam,
    });

    return {
      userId,
      query: {
        limit: parsed.limit,
        before: parsed.before ? new Date(parsed.before) : undefined,
      },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw invalidRequest(
        error.issues[0]?.message ?? "Invalid transaction query",
      );
    }
    throw invalidRequest("Invalid transaction query parameters");
  }
}
