import type { Pool } from "pg";
import { z } from "zod";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { isRetryable } from "@/lib/money/errors";
import { fingerprintOf, PostgresIdempotencyStore } from "@/lib/money/idempotency";
import { PostgresLedgerWriter } from "@/lib/money/ledger-write-adapter";
import type { Clock } from "@/use-cases/shared/contracts";
import type { SessionRemovalRepositories, SessionRemovalTransaction } from "@/use-cases/sessions/session-removal-transaction";
import { PostgresUserReader } from "./postgres-user-reader";
import { PostgresSessionRemovalRepository } from "./postgres-session-removal-repository";
import { SessionPersistenceError } from "./postgres-row-values";

const committedResult = z.object({
  sessionId: z.string().uuid(), participationId: z.string().uuid(), status: z.literal("REMOVED"),
  refundCents: z.number().int().safe().positive(),
}).strict();

/** Submission-scoped refund/removal transaction with validated, durable replay. */
export class PostgresSessionRemovalTransaction implements SessionRemovalTransaction {
  constructor(private readonly getPool: () => Pool, private readonly clock: Clock, private readonly submissionKey: string) {}

  async run<T>(work: (repositories: SessionRemovalRepositories) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await new PostgresTransactor(this.getPool(), "serializable").transaction(async (sql) => {
          const keys = new PostgresIdempotencyStore(sql);
          let writer: PostgresLedgerWriter | undefined;
          return work({
            users: new PostgresUserReader(sql, this.clock),
            sessions: new PostgresSessionRemovalRepository(sql),
            ledger: { append: async (instructions) => {
              if (!writer) throw new SessionPersistenceError("Ledger write outside a claimed removal");
              await writer.append(instructions);
            } },
            submission: { once: async (bookerId, sessionId, participationId, previewVersion, perform) => {
              const key = JSON.stringify(["UC2-03b", bookerId, this.submissionKey]);
              const claim = await keys.claim({ idempotencyKey: key, scope: "UC2-03b",
                fingerprint: fingerprintOf({ sessionId, participationId, previewVersion }) });
              if (claim.status === "REPLAY") {
                const result = committedResult.parse(claim.value);
                if (result.sessionId !== sessionId || result.participationId !== participationId)
                  throw new SessionPersistenceError("Replay removal target does not match");
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
