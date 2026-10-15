import type { Pool } from "pg";
import { Money, type UUID } from "@/domain";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { LedgerUnitOfWork } from "@/lib/money/ledger-unit-of-work";

/** A provider payment that completed a wallet top-up. */
export interface TopUpPayment {
  readonly paymentReference: string;
  readonly walletId: UUID;
  readonly amountCents: number;
  readonly succeededAt: Date;
}

export interface TopUpEvent {
  readonly eventId: string;
  readonly eventType: string;
}

/**
 * The only path that credits a wallet (CLAUDE.md rule #2): a verified
 * provider event that a top-up payment succeeded.
 *
 * One transaction claims an idempotency key per payment, so a payment credits
 * at most once however many events mention it, records the event in
 * `processed_events`, and appends the TOP_UP entry. A replay returns the
 * first outcome without writing again. The ledger trigger moves the balance.
 */
export class PostgresTopUpCredits {
  constructor(private readonly getPool: () => Pool) {}

  async credit(event: TopUpEvent, payment: TopUpPayment): Promise<"CREDITED"> {
    const idempotencyKey = JSON.stringify(["UC1-05:top-up", payment.paymentReference]);
    const unitOfWork = new LedgerUnitOfWork(
      new PostgresTransactor(this.getPool(), "read committed"),
    );
    return unitOfWork.execute(
      {
        idempotencyKey,
        scope: "UC1-05:top-up",
        request: {
          paymentReference: payment.paymentReference,
          walletId: payment.walletId,
          amountCents: payment.amountCents,
        },
      },
      async ({ sql, ledger }) => {
        await ledger.creditTopUp({
          walletId: payment.walletId,
          amount: Money.fromCents(payment.amountCents),
          occurredAt: payment.succeededAt,
          externalReference: payment.paymentReference,
        });
        // The writer derives the first entry's key as `${key}#0`.
        await sql.query(
          `insert into processed_events (event_id, provider, event_type, processed_at, ledger_entry_id)
           select $1, 'stripe', $2, now(), entry_id
             from ledger_entries where idempotency_key = $3
           on conflict (event_id) do nothing`,
          [event.eventId, event.eventType, `${idempotencyKey}#0`],
        );
        return "CREDITED" as const;
      },
    );
  }
}
