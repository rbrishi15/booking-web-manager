import { Participation, Session, type UserDetails } from "@/domain";
import { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { PromoteFromWaitlist } from "@/use-cases/sessions/PromoteFromWaitlist";
import { describe, expect, test } from "vitest";
import {
  createTestUser,
  createTestUserDetails,
} from "../domain/accounts/user-fixtures";
import {
  committedParticipation,
  hoursBeforeSessionStart,
  sessionDetails,
  sessionStartsAt,
} from "../domain/sessions/session/session-fixtures";
import { InMemoryUnitOfWork } from "./support/in-memory-unit-of-work";
import { RecordingNotifier } from "./support/recording-notifier";

// sessionDetails() books a 1000-cent venue, so each share is 1000 / totalSlots.
const sessionId = "s";

// Owner: Yajie (Wyjessie) — /app/commit
describe("UC2-04 Commit to Session", () => {
  test("locks the participant's share and creates the commitment row in one transaction", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice" })],
    });

    // Act
    const result = await commitToSession.forParticipant(
      commitRequest("alice"),
    );

    // Assert
    expect(result).toEqual({
      kind: "COMMITTED",
      sessionId,
      participationId: "id-1",
      heldCents: 500,
      refundedParticipationId: undefined,
    });
    const participation = unitOfWork
      .requireSession(sessionId)
      .participantList.requireParticipation("id-1");
    expect(participation.status).toBe("COMMITTED");
    expect(participation.hold?.state).toBe("HELD");
    expect(participation.hold?.amount.toCents()).toBe(500);
    expect(unitOfWork.ledgerInstructions).toHaveLength(1);
    expect(unitOfWork.ledgerInstructions[0]).toMatchObject({
      kind: "LOCK",
      walletId: "w-alice",
      holdId: "id-2",
      participationId: "id-1",
    });
    expect(unitOfWork.availableCents("alice")).toBe(9_500);
  });

  test("rolls back the commitment when its fund lock cannot be written", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice" })],
    });
    unitOfWork.failNextLedgerAppend = true;

    // Act & Assert
    await expect(
      commitToSession.forParticipant(commitRequest("alice")),
    ).rejects.toThrow("Ledger append failed");
    expect(
      unitOfWork.requireSession(sessionId).participantList.participations,
    ).toHaveLength(0);
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
    expect(unitOfWork.availableCents("alice")).toBe(10_000);
  });

  test("commits a slot only when capacity remains, otherwise adds to the waitlist FIFO on joined_at", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      session: fullSession(),
      users: ["carol", "dave"].map((userId) =>
        createTestUserDetails({ userId }),
      ),
    });

    // Act
    const carol = await commitToSession.forParticipant(commitRequest("carol"));
    const dave = await commitToSession.forParticipant(commitRequest("dave"));

    // Assert
    expect(carol).toMatchObject({ kind: "WAITLISTED", heldCents: 0 });
    expect(dave).toMatchObject({ kind: "WAITLISTED", heldCents: 0 });
    const list = unitOfWork.requireSession(sessionId).participantList;
    expect(list.committedCount).toBe(2);
    expect(list.requireParticipation(carol.participationId).queueSequence).toBe(
      1,
    );
    expect(list.requireParticipation(dave.participationId).queueSequence).toBe(
      2,
    );
    expect(list.nextWaitlisted()?.userId).toBe("carol");
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
    expect(unitOfWork.availableCents("carol")).toBe(10_000);
  });

  test("rejects a commit when the wallet's available balance is insufficient", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice", availableFundsCents: 499 })],
    });

    // Act & Assert
    await expect(
      commitToSession.forParticipant(commitRequest("alice")),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(
      unitOfWork.requireSession(sessionId).participantList.participations,
    ).toHaveLength(0);
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
  });

  test("rejects a private session without its room token or group membership", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      session: new Session(sessionDetails({ visibility: "PRIVATE" })),
      users: [createTestUserDetails({ userId: "alice" })],
    });

    // Act & Assert
    await expect(
      commitToSession.forParticipant(commitRequest("alice")),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS" });
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
  });

  test("admits to a private session with its room token", async () => {
    // Arrange
    const { commitToSession } = commitmentScenario({
      session: new Session(sessionDetails({ visibility: "PRIVATE" })),
      users: [createTestUserDetails({ userId: "alice" })],
    });

    // Act
    const result = await commitToSession.forParticipant({
      ...commitRequest("alice"),
      roomToken: "room",
    });

    // Assert
    expect(result.kind).toBe("COMMITTED");
  });

  test("a repeated request with the same idempotency key returns the original result without re-locking funds", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice" })],
    });
    const first = await commitToSession.forParticipant(commitRequest("alice"));

    // Act
    const retry = await commitToSession.forParticipant(commitRequest("alice"));

    // Assert
    expect(retry).toEqual(first);
    expect(unitOfWork.ledgerInstructions).toHaveLength(1);
    expect(unitOfWork.availableCents("alice")).toBe(9_500);
  });

  test("a new idempotency key for a participant who already committed is rejected without locking again", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice" })],
    });
    await commitToSession.forParticipant(commitRequest("alice", "first"));

    // Act & Assert
    await expect(
      commitToSession.forParticipant(commitRequest("alice", "second")),
    ).rejects.toMatchObject({ code: "ALREADY_PARTICIPATING" });
    expect(unitOfWork.ledgerInstructions).toHaveLength(1);
    expect(unitOfWork.availableCents("alice")).toBe(9_500);
  });

  test("rejects an unknown session without writing anything", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice" })],
    });

    // Act & Assert
    await expect(
      commitToSession.forParticipant({
        ...commitRequest("alice"),
        sessionId: "missing",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
  });

  // The priority test — see CLAUDE.md "Testing". Filtered by `npm run test:concurrency`.
  test("concurrency: 20 concurrent commits on an 8-slot session — exactly 8 succeed, 12 waitlist, total locked = 8 × share", async () => {
    // Arrange
    const userIds = Array.from({ length: 20 }, (_, index) => `user-${index}`);
    const { commitToSession, unitOfWork } = commitmentScenario({
      session: new Session(sessionDetails({ totalSlots: 8 })),
      users: userIds.map((userId) => createTestUserDetails({ userId })),
    });
    const share = 125;

    // Act
    const results = await Promise.all(
      userIds.map((userId) =>
        commitToSession.forParticipant(commitRequest(userId)),
      ),
    );

    // Assert
    const committed = results.filter((result) => result.kind === "COMMITTED");
    const waitlisted = results.filter((result) => result.kind === "WAITLISTED");
    expect(committed).toHaveLength(8);
    expect(waitlisted).toHaveLength(12);
    const locks = unitOfWork.ledgerInstructions.filter(
      (instruction) => instruction.kind === "LOCK",
    );
    const totalLocked = locks.reduce(
      (sum, instruction) => sum + instruction.amount.toCents(),
      0,
    );
    expect(totalLocked).toBe(8 * share);
    expect(new Set(locks.map((lock) => lock.walletId)).size).toBe(8);
    const list = unitOfWork.requireSession(sessionId).participantList;
    expect(list.committedCount).toBe(8);
    expect(
      list.participations
        .filter((participation) => participation.status === "WAITLISTED")
        .map((participation) => participation.queueSequence)
        .sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });

  describe("waitlist promotion", () => {
    test("promotes the FIFO queue head into a free place and locks their share", async () => {
      // Arrange
      const { promote, unitOfWork } = promotionScenario({
        totalSlots: 2,
        committed: ["alice"],
        waitlisted: ["carol", "dave"],
      });

      // Act
      const result = await promote.forSession(promotionRequest());

      // Assert
      expect(result).toEqual({
        sessionId,
        promoted: [
          {
            participationId: "p-carol",
            userId: "carol",
            refundedParticipationId: undefined,
          },
        ],
        skipped: [],
        awaitingInvitee: undefined,
      });
      const list = unitOfWork.requireSession(sessionId).participantList;
      expect(list.requireParticipation("p-carol").status).toBe("COMMITTED");
      expect(list.nextWaitlisted()?.userId).toBe("dave");
      expect(unitOfWork.ledgerInstructions).toHaveLength(1);
      expect(unitOfWork.ledgerInstructions[0]).toMatchObject({
        kind: "LOCK",
        walletId: "w-carol",
      });
      expect(unitOfWork.availableCents("carol")).toBe(9_500);
    });

    test("fills every free place in one transaction, in FIFO order", async () => {
      // Arrange
      const { promote, unitOfWork } = promotionScenario({
        totalSlots: 3,
        committed: ["alice"],
        waitlisted: ["carol", "dave", "erin"],
      });

      // Act
      const result = await promote.forSession(promotionRequest());

      // Assert
      expect(result.promoted.map((entry) => entry.userId)).toEqual([
        "carol",
        "dave",
      ]);
      const list = unitOfWork.requireSession(sessionId).participantList;
      expect(list.committedCount).toBe(3);
      expect(list.nextWaitlisted()?.userId).toBe("erin");
    });

    test("skips a queue head who cannot fund their share and promotes the next person", async () => {
      // Arrange
      const { promote, unitOfWork } = promotionScenario({
        totalSlots: 2,
        committed: ["alice"],
        waitlisted: ["carol", "dave"],
        fundsCents: { carol: 499 },
      });

      // Act
      const result = await promote.forSession(promotionRequest());

      // Assert
      expect(result.skipped).toEqual([
        {
          participationId: "p-carol",
          userId: "carol",
          reason: "INSUFFICIENT_FUNDS",
        },
      ]);
      expect(result.promoted.map((entry) => entry.userId)).toEqual(["dave"]);
      const list = unitOfWork.requireSession(sessionId).participantList;
      expect(list.requireParticipation("p-carol").status).toBe(
        "LEFT_WAITLIST",
      );
      expect(unitOfWork.availableCents("carol")).toBe(499);
    });

    test("refunds the oldest late open-slot withdrawal replaced by the promoted person", async () => {
      // Arrange
      const lateWithdrawal = hoursBeforeSessionStart(10);
      const session = promotionSession({
        totalSlots: 2,
        committed: ["alice", "bob"],
        waitlisted: ["carol"],
      });
      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(session, {
          participationId: "p-alice",
          now: lateWithdrawal,
          replacementMode: "OPEN_SLOT",
        });
      const { promote, unitOfWork } = promotionScenario({
        session,
        now: lateWithdrawal,
      });

      // Act
      const result = await promote.forSession(promotionRequest());

      // Assert
      expect(result.promoted).toEqual([
        {
          participationId: "p-carol",
          userId: "carol",
          refundedParticipationId: "p-alice",
        },
      ]);
      expect(
        unitOfWork.ledgerInstructions.map((instruction) => [
          instruction.kind,
          instruction.walletId,
          instruction.amount.toCents(),
        ]),
      ).toEqual([
        ["LOCK", "w-carol", 500],
        ["REFUND", "w-alice", 500],
      ]);
      const alice = unitOfWork
        .requireSession(sessionId)
        .participantList.requireParticipation("p-alice");
      expect(alice.hold?.state).toBe("REFUNDED");
    });

    test("waits for an invited queue head to accept instead of skipping or charging them", async () => {
      // Arrange
      const lateWithdrawal = hoursBeforeSessionStart(10);
      const session = promotionSession({
        totalSlots: 3,
        committed: ["alice", "bob"],
        waitlisted: ["carol", "dave"],
      });
      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(session, {
          participationId: "p-alice",
          now: lateWithdrawal,
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "carol",
        });
      const { promote, unitOfWork } = promotionScenario({
        session,
        now: lateWithdrawal,
      });

      // Act
      const result = await promote.forSession(promotionRequest());

      // Assert
      expect(result).toMatchObject({
        promoted: [],
        skipped: [],
        awaitingInvitee: { participationId: "p-carol", userId: "carol" },
      });
      const list = unitOfWork.requireSession(sessionId).participantList;
      expect(list.nextWaitlisted()?.userId).toBe("carol");
      expect(list.requireParticipation("p-dave").status).toBe("WAITLISTED");
      expect(unitOfWork.ledgerInstructions).toHaveLength(0);
    });

    test("does nothing when no place is free", async () => {
      // Arrange
      const { promote, unitOfWork } = promotionScenario({
        totalSlots: 2,
        committed: ["alice", "bob"],
        waitlisted: ["carol"],
      });

      // Act
      const result = await promote.forSession(promotionRequest());

      // Assert
      expect(result).toMatchObject({ promoted: [], skipped: [] });
      expect(unitOfWork.ledgerInstructions).toHaveLength(0);
    });

    test("does nothing once the session has started", async () => {
      // Arrange
      const { promote, unitOfWork } = promotionScenario({
        totalSlots: 2,
        committed: ["alice"],
        waitlisted: ["carol"],
        now: sessionStartsAt,
      });

      // Act
      const result = await promote.forSession(promotionRequest());

      // Assert
      expect(result).toMatchObject({ promoted: [], skipped: [] });
      expect(
        unitOfWork
          .requireSession(sessionId)
          .participantList.requireParticipation("p-carol").status,
      ).toBe("WAITLISTED");
      expect(unitOfWork.ledgerInstructions).toHaveLength(0);
    });

    test("promotes nobody when the ledger write fails", async () => {
      // Arrange
      const { promote, unitOfWork } = promotionScenario({
        totalSlots: 3,
        committed: ["alice"],
        waitlisted: ["carol", "dave"],
      });
      unitOfWork.failNextLedgerAppend = true;

      // Act & Assert
      await expect(promote.forSession(promotionRequest())).rejects.toThrow(
        "Ledger append failed",
      );
      const list = unitOfWork.requireSession(sessionId).participantList;
      expect(list.committedCount).toBe(1);
      expect(list.nextWaitlisted()?.userId).toBe("carol");
      expect(unitOfWork.ledgerInstructions).toHaveLength(0);
    });

    test("notifies each promoted participant, but not a skipped one", async () => {
      // Arrange
      const { promote, notifier } = promotionScenario({
        totalSlots: 2,
        committed: ["alice"],
        waitlisted: ["carol", "dave"],
        fundsCents: { carol: 499 },
      });

      // Act
      await promote.forSession(promotionRequest());

      // Assert
      expect(notifier.deliveries()).toEqual([["PROMOTED", "dave"]]);
    });

    test("keeps a promotion when its notification cannot be delivered", async () => {
      // Arrange
      const { promote, unitOfWork, notifier } = promotionScenario({
        totalSlots: 2,
        committed: ["alice"],
        waitlisted: ["carol"],
      });
      notifier.failNext = true;

      // Act
      const result = await promote.forSession(promotionRequest());

      // Assert
      expect(result.promoted.map((entry) => entry.userId)).toEqual(["carol"]);
      expect(
        unitOfWork
          .requireSession(sessionId)
          .participantList.requireParticipation("p-carol").status,
      ).toBe("COMMITTED");
    });

    test("a repeated trigger key replays its result without locking again", async () => {
      // Arrange
      const { promote, unitOfWork } = promotionScenario({
        totalSlots: 2,
        committed: ["alice"],
        waitlisted: ["carol"],
      });
      const first = await promote.forSession(promotionRequest("withdrawal-1"));

      // Act
      const retry = await promote.forSession(promotionRequest("withdrawal-1"));

      // Assert
      expect(retry).toEqual(first);
      expect(unitOfWork.ledgerInstructions).toHaveLength(1);
      expect(unitOfWork.availableCents("carol")).toBe(9_500);
    });
  });
});

function commitmentScenario(options: {
  users: readonly UserDetails[];
  session?: Session;
}) {
  const unitOfWork = new InMemoryUnitOfWork({
    users: options.users,
    sessions: [options.session ?? new Session(sessionDetails())],
  });
  let nextId = 0;
  const commitToSession = new CommitToSession({
    unitOfWork,
    clock: { now: () => hoursBeforeSessionStart(48) },
    ids: { next: () => `id-${++nextId}` },
  });
  return { commitToSession, unitOfWork };
}

function commitRequest(userId: string, idempotencyKey = `commit-${userId}`) {
  return { userId, sessionId, idempotencyKey };
}

/** A two-slot session whose slots alice and bob already hold. */
function fullSession(): Session {
  const details = sessionDetails();
  const terms = {
    holdingAccountId: details.holdingAccountId,
    bookingShare: details.booking.totalCost.divideFloor(details.totalSlots),
  };
  return new Session({
    ...details,
    participations: ["alice", "bob"].map((userId) =>
      committedParticipation(terms, userId),
    ),
  });
}

interface PromotionRoster {
  readonly totalSlots: number;
  readonly committed: readonly string[];
  readonly waitlisted: readonly string[];
}

/** A session in the stated roster; waiters queue in the order given. */
function promotionSession({
  totalSlots,
  committed,
  waitlisted,
}: PromotionRoster): Session {
  const details = sessionDetails({ totalSlots });
  const terms = {
    holdingAccountId: details.holdingAccountId,
    bookingShare: details.booking.totalCost.divideFloor(totalSlots),
  };
  return new Session({
    ...details,
    participations: [
      ...committed.map((userId) => committedParticipation(terms, userId)),
      ...waitlisted.map((userId, index) =>
        Participation.createWaitlisted({
          participationId: `p-${userId}`,
          userId,
          waitlistedAt: hoursBeforeSessionStart(48),
          queueSequence: index + 1,
        }),
      ),
    ],
    nextQueueSequence: waitlisted.length + 1,
  });
}

function promotionScenario(
  options: (PromotionRoster | { session: Session }) & {
    fundsCents?: Readonly<Record<string, number>>;
    now?: Date;
  },
) {
  const session =
    "session" in options ? options.session : promotionSession(options);
  const users = session.participantList.participations.map(({ userId }) =>
    createTestUserDetails({
      userId,
      availableFundsCents: options.fundsCents?.[userId] ?? 10_000,
    }),
  );
  const unitOfWork = new InMemoryUnitOfWork({ users, sessions: [session] });
  let nextId = 0;
  const notifier = new RecordingNotifier();
  const promote = new PromoteFromWaitlist({
    unitOfWork,
    clock: { now: () => options.now ?? hoursBeforeSessionStart(24) },
    ids: { next: () => `id-${++nextId}` },
    notifier,
  });
  return { promote, unitOfWork, notifier };
}

function promotionRequest(triggerKey = "trigger-1") {
  return { sessionId, triggerKey };
}
