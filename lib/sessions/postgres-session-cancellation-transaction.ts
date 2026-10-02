import type { Pool } from "pg";
import { z } from "zod";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { isRetryable } from "@/lib/money/errors";
import { fingerprintOf, PostgresIdempotencyStore } from "@/lib/money/idempotency";
import { PostgresLedgerWriter } from "@/lib/money/ledger-write-adapter";
import type { Clock } from "@/use-cases/shared/contracts";
import type { SessionCancellationRepositories, SessionCancellationTransaction } from "@/use-cases/sessions/session-cancellation-transaction";
import { PostgresUserReader } from "./postgres-user-reader";
import { PostgresSessionCancellationRepository } from "./postgres-session-cancellation-repository";
import { SessionPersistenceError } from "./postgres-row-values";

const committedResult = z.object({
  sessionId: z.string().uuid(), status: z.literal("CANCELLED"),
  refundRecipientCount: z.number().int().safe().nonnegative(),
  totalRefundCents: z.number().int().safe().nonnegative(),
}).strict();

/** Submission-scoped serializable atomic cancellation with durable response replay. */
export class PostgresSessionCancellationTransaction implements SessionCancellationTransaction {
  constructor(private readonly getPool: () => Pool, private readonly clock: Clock, private readonly submissionKey: string) {}

  async run<T>(work: (repositories: SessionCancellationRepositories) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await new PostgresTransactor(this.getPool(), "serializable").transaction(async (sql) => {
          const keys = new PostgresIdempotencyStore(sql);
          // The writer's key is initialized after authoritative actor authorization.
          let writer: PostgresLedgerWriter | undefined;
          return work({
            users: new PostgresUserReader(sql, this.clock),
            sessions: new PostgresSessionCancellationRepository(sql),
            ledger: { append: async (instructions) => {
              if (!writer) throw new SessionPersistenceError("Ledger write outside a claimed cancellation");
              await writer.append(instructions);
            } },
            submission: { once: async (bookerId, sessionId, previewVersion, perform) => {
              const key = JSON.stringify(["UC2-03c", bookerId, this.submissionKey]);
              const claim = await keys.claim({ idempotencyKey: key, scope: "UC2-03c", fingerprint: fingerprintOf({ sessionId, previewVersion }) });
              if (claim.status === "REPLAY") {
                const result = committedResult.parse(claim.value);
                if (result.sessionId !== sessionId) throw new SessionPersistenceError("Replay session does not match");
                return result;
              }
              writer = new PostgresLedgerWriter(sql, key);
              const result = committedResult.parse(await perform());
              await keys.succeed(key, result);
              return result;
            } },
          });
        });
      } catch (error) {
        if (isRetryable(error) && attempt < 3) continue;
        throw error;
      }
    }
  }
}
