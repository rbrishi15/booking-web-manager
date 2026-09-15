import { describe, expect, it } from "vitest";
import type { Payout } from "../domain/entities/payout";
import type { RegularGroup } from "../domain/entities/regular-group";
import type { Session } from "../domain/entities/session";
import { User } from "../domain/entities/user";
import type {
  AdmissionFacts,
  DeactivationFacts,
  FinancialInstruction,
  PayoutRequestedIntent,
} from "../domain/operations";
import { Booking } from "../domain/value-objects/booking";
import { Money } from "../domain/value-objects/money";
import { ReliabilityScore } from "../domain/value-objects/reliability-score";
import type { DomainTransaction, Repository } from "./contracts";
import {
  GroupApplicationService,
  SessionApplicationService,
  UserApplicationService,
} from "./services";

const hour = 3_600_000;
const start = new Date("2026-10-10T10:00:00Z");
const end = new Date(start.getTime() + 2 * hour);

class MemoryRepository<T> implements Repository<T> {
  readonly values = new Map<string, T>();
  constructor(private readonly id: (value: T) => string) {}
  async get(id: string): Promise<T | null> {
    return this.values.get(id) ?? null;
  }
  async save(value: T): Promise<void> {
    this.values.set(this.id(value), value);
  }
}

class FakeApplicationTransaction {
  readonly users = new MemoryRepository<User>((value) => value.userId);
  readonly sessions = new MemoryRepository<Session>((value) => value.sessionId);
  readonly groups = new MemoryRepository<RegularGroup>(
    (value) => value.groupId,
  );
  readonly payouts = new MemoryRepository<Payout>((value) => value.payoutId);
  readonly instructions: FinancialInstruction[] = [];
  readonly intents: PayoutRequestedIntent[] = [];
  readonly admissionFacts: {
    get: (sessionId: string, userId: string) => Promise<AdmissionFacts>;
  } = {
    get: async (_sessionId, userId) => ({
      userId,
      walletId: `wallet-${userId}`,
      accountStatus: "ACTIVE",
      score: ReliabilityScore.from(100),
      availableBalance: Money.fromCents(10_000),
      memberGroupIds: [],
    }),
  };
  readonly deactivationFacts: {
    get: (userId: string) => Promise<DeactivationFacts>;
  } = {
    get: async () => ({
      availableBalance: Money.fromCents(0),
      heldBalance: Money.fromCents(0),
      activeCommitments: 0,
      unsettledOwnedSessions: 0,
      pendingPayouts: 0,
      activeOwnedGroups: 0,
    }),
  };
  readonly ledger = {
    append: async (instructions: readonly FinancialInstruction[]) => {
      this.instructions.push(...instructions);
    },
  };
  readonly payoutIntents = {
    append: async (intent: PayoutRequestedIntent) => {
      this.intents.push(intent);
    },
  };
  context(): DomainTransaction {
    return this as unknown as DomainTransaction;
  }
}

describe("application coordinators", () => {
  it("save aggregate changes, ledger instructions, and payout intents in the same unit of work", async () => {
    const state = new FakeApplicationTransaction();
    let current = new Date(start.getTime() - 48 * hour);
    const ids = ["participation-a", "hold-a", "payout-a"];
    const dependencies = {
      unitOfWork: {
        execute: async <T>(
          _key: string,
          work: (tx: DomainTransaction) => Promise<T>,
        ) => work(state.context()),
      },
      clock: { now: () => new Date(current) },
      ids: { next: () => ids.shift() ?? "generated" },
    };
    const userService = new UserApplicationService(dependencies);
    const user = User.create({ userId: "booker", email: "booker@example.com" });
    await state.users.save(user);
    await userService.beginPayoutSetup({
      userId: "booker",
      payoutAccountId: "account",
      providerAccountReference: "provider",
      idempotencyKey: "setup",
    });
    await userService.completePayoutSetup({
      userId: "booker",
      bankAccountReference: "bank",
      idempotencyKey: "complete-setup",
    });

    const sessions = new SessionApplicationService(dependencies);
    const session = await sessions.create({
      sessionId: "session",
      bookerId: "booker",
      booking: Booking.create({
        venueName: "Court",
        region: "North",
        sport: "Badminton",
        startAt: start,
        endAt: end,
        totalCost: Money.fromCents(1000),
      }),
      totalSlots: 2,
      minimumHeadcount: 2,
      roomToken: "room",
      holdingAccountId: "platform",
      visibility: "PUBLIC",
      idempotencyKey: "create-session",
    });
    expect(session.status).toBe("OPEN");
    await sessions.join({
      sessionId: "session",
      userId: "player",
      idempotencyKey: "join",
    });
    expect(state.instructions.map((instruction) => instruction.kind)).toEqual([
      "LOCK",
    ]);

    current = end;
    await sessions.verifyAttendance({
      sessionId: "session",
      bookerId: "booker",
      marks: [{ participationId: "participation-a", attendance: "ATTENDED" }],
      idempotencyKey: "verify",
    });
    const requested = await sessions.requestSettlement({
      sessionId: "session",
      bookerId: "booker",
      idempotencyKey: "settle",
    });
    expect(requested.payout?.status).toBe("REQUESTED");
    expect(state.intents).toHaveLength(1);
    expect(state.instructions.map((instruction) => instruction.kind)).toEqual([
      "LOCK",
    ]);
    current = new Date(end.getTime() + hour);
    const completed = await sessions.completePayout({
      payoutId: "payout-a",
      providerReference: "provider-payout",
      idempotencyKey: "callback",
    });
    expect(completed.applied).toBe(true);
    expect(state.instructions.map((instruction) => instruction.kind)).toEqual([
      "LOCK",
      "RELEASE",
    ]);
    expect((await state.sessions.get("session"))?.status).toBe("SETTLED");
  });

  it("keeps group policy in the group aggregate", async () => {
    const state = new FakeApplicationTransaction();
    const deps = {
      unitOfWork: {
        execute: async <T>(
          _key: string,
          work: (tx: DomainTransaction) => Promise<T>,
        ) => work(state.context()),
      },
      clock: { now: () => new Date("2026-09-15T00:00:00Z") },
      ids: { next: () => "unused" },
    };
    const service = new GroupApplicationService(deps);
    await service.create({
      groupId: "group",
      ownerId: "owner",
      name: "Sunday badminton",
      invitationToken: "token",
      idempotencyKey: "create",
    });
    expect(
      await service.join({
        groupId: "group",
        userId: "member",
        invitationToken: "token",
        idempotencyKey: "join",
      }),
    ).toBe("JOINED");
    expect((await state.groups.get("group"))?.memberships).toHaveLength(2);
  });
});
