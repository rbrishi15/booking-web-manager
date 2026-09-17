import { Money, type FinancialInstruction } from "@/domain";
import {
  LedgerError,
  LedgerUnitOfWork,
  PLATFORM_HOLDING_ACCOUNT_ID,
  type LedgerWorkContext,
} from "@/lib/money";
import { FakeLedgerDatabase } from "./support/fake-ledger-database";
import { beforeEach, describe, expect, test } from "vitest";

/**
 * The five money operations, and the rules that stop them being misused.
 *
 * Runs against the in-memory model, so it covers the adapter's validation and
 * the shape of what it writes. The schema's own constraints are covered by
 * `ledger-concurrency.db.test.ts`.
 */

const WALLET_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PARTICIPATION_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const HOLD_ID = "cccccccc-0000-4000-8000-000000000001";
const PAYOUT_ID = "dddddddd-0000-4000-8000-000000000001";
const SHARE = Money.fromCents(1250);
const OCCURRED_AT = new Date("2026-09-17T12:00:00.000Z");

describe("the five money operations", () => {
  let database: FakeLedgerDatabase;
  let unitOfWork: LedgerUnitOfWork;

  beforeEach(() => {
    database = new FakeLedgerDatabase();
    unitOfWork = new LedgerUnitOfWork(database);
    database.addWallet(WALLET_ID, 0);
  });

  test("top-up credit is the only way money enters a wallet", async () => {
    // Act
    await run(unitOfWork, "top-up", async ({ ledger }) => {
      await ledger.creditTopUp({
        walletId: WALLET_ID,
        amount: Money.fromCents(5000),
        occurredAt: OCCURRED_AT,
        externalReference: "pi_test_123",
      });
    });

    // Assert
    expect(database.balanceOf(WALLET_ID)).toBe(5000);
    expect(database.entries[0]?.kind).toBe("TOP_UP");
  });

  test("lock moves the share out of the wallet and into a hold", async () => {
    // Arrange
    await fund(unitOfWork, 5000);

    // Act
    await run(unitOfWork, "lock", async ({ ledger }) => {
      await ledger.append([instruction("LOCK")]);
    });

    // Assert
    expect(database.balanceOf(WALLET_ID)).toBe(5000 - SHARE.toCents());
    expect(database.holds.get(HOLD_ID)?.heldCents).toBe(SHARE.toCents());
    expect(database.totalHeldFor(SESSION_ID)).toBe(SHARE.toCents());
  });

  test("refund returns the hold to the wallet it came from", async () => {
    // Arrange
    await fund(unitOfWork, 5000);
    await run(unitOfWork, "lock", async ({ ledger }) => {
      await ledger.append([instruction("LOCK")]);
    });

    // Act
    await run(unitOfWork, "refund", async ({ ledger }) => {
      await ledger.append([instruction("REFUND")]);
    });

    // Assert
    expect(database.balanceOf(WALLET_ID)).toBe(5000);
    expect(database.holds.get(HOLD_ID)?.heldCents).toBe(0);
    expect(database.holds.get(HOLD_ID)?.settledKind).toBe("REFUND");
  });

  test.each(["RELEASE", "FORFEIT"] as const)(
    "%s settles the hold towards the booker rather than back to the wallet",
    async (kind) => {
      // Arrange
      await fund(unitOfWork, 5000);
      await run(unitOfWork, "lock", async ({ ledger }) => {
        await ledger.append([instruction("LOCK")]);
      });

      // Act
      await run(unitOfWork, kind, async ({ ledger }) => {
        await ledger.append([instruction(kind, PAYOUT_ID)]);
      });

      // Assert
      expect(database.balanceOf(WALLET_ID)).toBe(5000 - SHARE.toCents());
      expect(database.holds.get(HOLD_ID)?.settledKind).toBe(kind);
      expect(database.payables.get(PAYOUT_ID)?.payableCents).toBe(
        SHARE.toCents(),
      );
    },
  );

  test("a hold cannot be settled twice", async () => {
    // Arrange
    await fund(unitOfWork, 5000);
    await run(unitOfWork, "lock", async ({ ledger }) => {
      await ledger.append([instruction("LOCK")]);
    });
    await run(unitOfWork, "refund", async ({ ledger }) => {
      await ledger.append([instruction("REFUND")]);
    });

    // Act and assert
    await expect(
      run(unitOfWork, "forfeit", async ({ ledger }) => {
        await ledger.append([instruction("FORFEIT", PAYOUT_ID)]);
      }),
    ).rejects.toMatchObject({ code: "HOLD_NOT_OPEN" });
  });

  test("a lock cannot be recorded twice against the same hold", async () => {
    // Arrange
    await fund(unitOfWork, 5000);
    await run(unitOfWork, "lock", async ({ ledger }) => {
      await ledger.append([instruction("LOCK")]);
    });

    // Act and assert
    await expect(
      run(unitOfWork, "lock-again", async ({ ledger }) => {
        await ledger.append([instruction("LOCK")]);
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_ENTRY" });
  });

  test("a wallet cannot be driven below zero", async () => {
    // Arrange
    await fund(unitOfWork, SHARE.toCents() - 1);

    // Act and assert
    await expect(
      run(unitOfWork, "lock", async ({ ledger }) => {
        await ledger.append([instruction("LOCK")]);
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });

    expect(database.balanceOf(WALLET_ID)).toBe(SHARE.toCents() - 1);
    expect(database.holds.has(HOLD_ID)).toBe(false);
  });

  test("a settlement must name the payout it pays", async () => {
    // Act and assert
    await expect(
      run(unitOfWork, "release", async ({ ledger }) => {
        await ledger.append([instruction("RELEASE")]);
      }),
    ).rejects.toMatchObject({ code: "INVALID_INSTRUCTION" });
  });

  test("a lock must not name a payout", async () => {
    // Act and assert
    await expect(
      run(unitOfWork, "lock", async ({ ledger }) => {
        await ledger.append([instruction("LOCK", PAYOUT_ID)]);
      }),
    ).rejects.toMatchObject({ code: "INVALID_INSTRUCTION" });
  });

  test("an amount of zero is not a money movement", async () => {
    // Act and assert
    await expect(
      run(unitOfWork, "lock", async ({ ledger }) => {
        await ledger.append([
          { ...instruction("LOCK"), amount: Money.fromCents(0) },
        ]);
      }),
    ).rejects.toMatchObject({ code: "INVALID_INSTRUCTION" });
  });

  test("a payout can only move what was settled to it", async () => {
    // Arrange
    await fund(unitOfWork, 5000);
    await run(unitOfWork, "lock", async ({ ledger }) => {
      await ledger.append([instruction("LOCK")]);
    });
    await run(unitOfWork, "release", async ({ ledger }) => {
      await ledger.append([instruction("RELEASE", PAYOUT_ID)]);
    });

    // Act and assert
    await expect(
      run(unitOfWork, "payout", async ({ ledger }) => {
        await ledger.recordPayout({
          payoutId: PAYOUT_ID,
          sessionId: SESSION_ID,
          amount: SHARE.add(Money.fromCents(1)),
          occurredAt: OCCURRED_AT,
          externalReference: "po_test_123",
        });
      }),
    ).rejects.toBeInstanceOf(LedgerError);

    expect(database.payables.get(PAYOUT_ID)?.payableCents).toBe(
      SHARE.toCents(),
    );
  });

  test("each entry in a batch gets its own derived idempotency key", async () => {
    // Arrange
    await fund(unitOfWork, 5000);
    const second = {
      ...instruction("LOCK"),
      holdId: "cccccccc-0000-4000-8000-000000000002",
      participationId: "bbbbbbbb-0000-4000-8000-000000000002",
    };

    // Act
    await run(unitOfWork, "batch", async ({ ledger }) => {
      await ledger.append([instruction("LOCK"), second]);
    });

    // Assert
    const keys = database.entries
      .filter((entry) => entry.kind === "LOCK")
      .map((entry) => entry.idempotencyKey);
    expect(keys).toEqual(["batch#0", "batch#1"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("the same key used for a different request is refused", async () => {
    // Arrange
    await fund(unitOfWork, 5000);
    await unitOfWork.execute(
      { idempotencyKey: "shared", scope: "test", request: { first: true } },
      async () => ({ done: true }),
    );

    // Act and assert
    await expect(
      unitOfWork.execute(
        { idempotencyKey: "shared", scope: "test", request: { first: false } },
        async () => ({ done: true }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
});

type Work = (context: LedgerWorkContext) => Promise<void>;

async function run(
  unitOfWork: LedgerUnitOfWork,
  idempotencyKey: string,
  work: Work,
): Promise<unknown> {
  return unitOfWork.execute(
    { idempotencyKey, scope: "test", request: { idempotencyKey } },
    async (context) => {
      await work(context);
      return { ok: true };
    },
  );
}

async function fund(
  unitOfWork: LedgerUnitOfWork,
  cents: number,
): Promise<void> {
  await run(unitOfWork, `fund-${cents}`, async ({ ledger }) => {
    await ledger.creditTopUp({
      walletId: WALLET_ID,
      amount: Money.fromCents(cents),
      occurredAt: OCCURRED_AT,
      externalReference: `pi_fund_${cents}`,
    });
  });
}

function instruction(
  kind: FinancialInstruction["kind"],
  payoutId?: string,
): FinancialInstruction {
  return {
    kind,
    sessionId: SESSION_ID,
    participationId: PARTICIPATION_ID,
    holdId: HOLD_ID,
    holdingAccountId: PLATFORM_HOLDING_ACCOUNT_ID,
    walletId: WALLET_ID,
    amount: SHARE,
    occurredAt: OCCURRED_AT,
    ...(payoutId === undefined ? {} : { payoutId }),
  };
}
