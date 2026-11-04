import { Session } from "@/domain";
import { AcceptReplacement } from "@/use-cases/sessions/AcceptReplacement";
import { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { ExpireReplacements } from "@/use-cases/sessions/ExpireReplacements";
import { LeaveWaitlist } from "@/use-cases/sessions/LeaveWaitlist";
import { PromoteFromWaitlist } from "@/use-cases/sessions/PromoteFromWaitlist";
import {
  type ReplacementChoice,
  WithdrawFromSession,
} from "@/use-cases/sessions/WithdrawFromSession";
import { describe, expect, test } from "vitest";
import { createTestUserDetails } from "../domain/accounts/user-fixtures";
import {
  hoursBeforeSessionStart,
  sessionDetails,
  sessionStartsAt,
} from "../domain/sessions/session/session-fixtures";
import { InMemoryUnitOfWork } from "./support/in-memory-unit-of-work";
import { RecordingNotifier } from "./support/recording-notifier";

// A two-slot session for a 1000-cent booking: each share is 500 cents.
const sessionId = "s";
const openSlot: ReplacementChoice = { mode: "OPEN_SLOT" };

// Owner: Yajie (Wyjessie) — /app/commit
describe("UC2-05 Withdraw from Session", () => {
  test("full refund when withdrawing 30h and one second before session start", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(new Date(hoursBeforeSessionStart(30).getTime() - 1_000));

    // Act
    const result = await scenario.withdraw("alice", openSlot);

    // Assert
    expect(result).toMatchObject({
      kind: "REFUNDED",
      participationId: "id-1",
      refundedCents: 500,
    });
    expect(scenario.unitOfWork.availableCents("alice")).toBe(10_000);
    expect(scenario.participation("id-1").hold?.state).toBe("REFUNDED");
  });

  test("less than 30h before start, keeps the share held pending replacement", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(new Date(hoursBeforeSessionStart(30).getTime() + 1_000));

    // Act
    const result = await scenario.withdraw("alice", { mode: "DIRECT_INVITE", inviteeId: "dave" });

    // Assert
    expect(result).toMatchObject({
      kind: "AWAITING_REPLACEMENT",
      refundedCents: 0,
    });
    expect(scenario.unitOfWork.availableCents("alice")).toBe(9_500);
    expect(scenario.participation("id-1").hold?.state).toBe(
      "AWAITING_REPLACEMENT",
    );
  });

  test("at exactly 30h, refunds the full held share in the withdrawal transaction", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(30));

    // Act
    const result = await scenario.withdraw("alice", openSlot);

    // Assert
    expect(result).toMatchObject({
      kind: "REFUNDED",
      participationId: "id-1",
      refundedCents: 500,
    });
    expect(scenario.unitOfWork.availableCents("alice")).toBe(10_000);
    expect(scenario.participation("id-1").hold?.state).toBe("REFUNDED");
    expect(scenario.ledgerKinds()).toEqual(["LOCK", "REFUND"]);
  });

  test("forfeits (credits the booker) if no replacement is found before session start", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(10));
    await scenario.withdraw("alice", { mode: "DIRECT_INVITE", inviteeId: "dave" });
    scenario.setTime(sessionStartsAt);

    // Act
    const result = await scenario.expireReplacements.forSession({
      sessionId,
      triggerKey: "start-sweep",
    });

    // Assert
    // The share stays held for the booker; the FORFEIT ledger line is written
    // when the session's payout completes (Booker settlement), not here.
    expect(result).toEqual({
      sessionId,
      forfeitureDue: [{ participationId: "id-1", userId: "alice" }],
    });
    expect(scenario.participation("id-1").hold?.state).toBe("FORFEITURE_DUE");
    expect(scenario.unitOfWork.availableCents("alice")).toBe(9_500);
    expect(scenario.ledgerKinds()).toEqual(["LOCK"]);
  });

  test("a replacement found before session start resolves out of awaiting_replacement without forfeiture", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(10));
    await scenario.withdraw("alice", { mode: "DIRECT_INVITE", inviteeId: "dave" });

    // Act
    const result = await scenario.acceptReplacement("dave");

    // Assert
    expect(result).toMatchObject({
      heldCents: 500,
      refundedParticipationId: "id-1",
    });
    expect(scenario.participation("id-1").hold?.state).toBe("REFUNDED");
    expect(scenario.participation(result.participationId).status).toBe(
      "COMMITTED",
    );
    expect(scenario.unitOfWork.availableCents("alice")).toBe(10_000);
    expect(scenario.unitOfWork.availableCents("dave")).toBe(9_500);
  });

  test("a late open-slot withdrawal is rejected without refunding or promoting the waitlist", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    await scenario.commit("bob");
    await scenario.commit("carol");
    scenario.setTime(hoursBeforeSessionStart(10));

    // Act
    await expect(scenario.withdraw("alice", openSlot)).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Assert
    expect(scenario.participation("id-1").status).toBe("COMMITTED");
    expect(scenario.participation("id-1").hold?.state).toBe("HELD");
    expect(scenario.unitOfWork.availableCents("alice")).toBe(9_500);
    expect(scenario.unitOfWork.availableCents("carol")).toBe(10_000);
    expect(scenario.unitOfWork.requireSession(sessionId).participantList.nextWaitlisted()?.userId).toBe("carol");
    expect(scenario.ledgerKinds()).toEqual(["LOCK", "LOCK"]);
  });

  test("an early open-slot withdrawal is refunded once and still promotes the waitlist head", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    await scenario.commit("bob");
    await scenario.commit("carol");
    scenario.setTime(hoursBeforeSessionStart(31));

    // Act
    const result = await scenario.withdraw("alice", openSlot);

    // Assert
    expect(result).toMatchObject({ kind: "REFUNDED", refundedCents: 500 });
    expect(result.promotion).toMatchObject({
      status: "COMPLETED",
      result: { promoted: [{ userId: "carol" }] },
    });
    expect(scenario.unitOfWork.availableCents("alice")).toBe(10_000);
    expect(scenario.ledgerKinds().filter((kind) => kind === "REFUND")).toEqual([
      "REFUND",
    ]);
  });

  test("a named invitation reserves the place instead of promoting the waitlist", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    await scenario.commit("bob");
    await scenario.commit("carol");
    scenario.setTime(hoursBeforeSessionStart(10));

    // Act
    const result = await scenario.withdraw("alice", {
      mode: "DIRECT_INVITE",
      inviteeId: "dave",
    });

    // Assert
    expect(result.promotion).toEqual({ status: "NOT_NEEDED" });
    const list = scenario.unitOfWork.requireSession(sessionId).participantList;
    expect(list.nextWaitlisted()?.userId).toBe("carol");
    expect(list.personalReplacementForInvitee("dave")?.participationId).toBe(
      "id-1",
    );
  });

  test("a late forfeit gives the share to the booker and closes the place without promoting anyone", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    await scenario.commit("bob");
    await scenario.commit("carol");
    scenario.setTime(hoursBeforeSessionStart(10));

    // Act
    const result = await scenario.withdraw("alice", { mode: "FORFEIT" });

    // Assert
    expect(result).toMatchObject({ kind: "FORFEITURE_DUE", refundedCents: 0 });
    expect(result.promotion).toEqual({ status: "NOT_NEEDED" });
    expect(scenario.participation("id-1").hold?.state).toBe("FORFEITURE_DUE");
    expect(scenario.unitOfWork.availableCents("alice")).toBe(9_500);
    expect(scenario.ledgerKinds()).not.toContain("REFUND");
    const session = scenario.unitOfWork.requireSession(sessionId);
    expect(session.participantList.nextWaitlisted()?.userId).toBe("carol");
    expect(session.getAvailableSlots(hoursBeforeSessionStart(10))).toBe(0);
  });

  test.each([30, 31])("rejects a forfeit %sh before start, which is refunded in full instead", async (hours) => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(hours));

    // Act
    const withdrawal = scenario.withdraw("alice", { mode: "FORFEIT" });

    // Assert
    await expect(withdrawal).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(scenario.participation("id-1").status).toBe("COMMITTED");
    expect(scenario.unitOfWork.availableCents("alice")).toBe(9_500);
  });

  test("keeps a withdrawal that committed even when the follow-up promotion fails", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    await scenario.commit("bob");
    await scenario.commit("carol");
    scenario.setTime(hoursBeforeSessionStart(31));
    // The REFUND succeeds, but the subsequent promotion's LOCK fails.
    const append = scenario.unitOfWork.execute.bind(scenario.unitOfWork);
    scenario.unitOfWork.execute = async (key, work) => {
      if (key.includes("promote")) scenario.unitOfWork.failNextLedgerAppend = true;
      return append(key, work);
    };

    // Act
    const result = await scenario.withdraw("alice", openSlot);

    // Assert
    expect(result.kind).toBe("REFUNDED");
    expect(result.promotion).toEqual({ status: "DEFERRED" });
    expect(scenario.participation("id-1").status).toBe("WITHDRAWN");
    const list = scenario.unitOfWork.requireSession(sessionId).participantList;
    expect(list.nextWaitlisted()?.userId).toBe("carol");
  });

  test("a retried withdrawal returns the original result without refunding twice", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(31));
    const first = await scenario.withdraw("alice", openSlot);

    // Act
    const retry = await scenario.withdraw("alice", openSlot);

    // Assert
    expect(retry).toEqual(first);
    expect(scenario.ledgerKinds()).toEqual(["LOCK", "REFUND"]);
    expect(scenario.unitOfWork.availableCents("alice")).toBe(10_000);
  });

  test("rejects a withdrawal from a session the user is not in", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");

    // Act & Assert
    await expect(scenario.withdraw("bob", openSlot)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(scenario.ledgerKinds()).toEqual(["LOCK"]);
  });

  test("rejects an invitation naming an unknown user without withdrawing", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(10));

    // Act & Assert
    await expect(
      scenario.withdraw("alice", { mode: "DIRECT_INVITE", inviteeId: "nobody" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(scenario.participation("id-1").status).toBe("COMMITTED");
  });

  test("rejects a replacement acceptance by someone who was not invited", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(10));
    await scenario.withdraw("alice", { mode: "DIRECT_INVITE", inviteeId: "dave" });

    // Act & Assert
    await expect(scenario.acceptReplacement("erin")).rejects.toMatchObject({
      code: "INVALID_ACCESS",
    });
    expect(scenario.participation("id-1").hold?.state).toBe(
      "AWAITING_REPLACEMENT",
    );
  });

  test("rejects a replacement acceptance after the session has started", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(10));
    await scenario.withdraw("alice", { mode: "DIRECT_INVITE", inviteeId: "dave" });
    scenario.setTime(sessionStartsAt);

    // Act & Assert
    await expect(scenario.acceptReplacement("dave")).rejects.toMatchObject({
      code: "SESSION_STARTED",
    });
    expect(scenario.unitOfWork.availableCents("dave")).toBe(10_000);
  });

  test("the forfeiture sweep does nothing before the session starts", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(10));
    await scenario.withdraw("alice", { mode: "DIRECT_INVITE", inviteeId: "dave" });

    // Act
    const result = await scenario.expireReplacements.forSession({
      sessionId,
      triggerKey: "early-sweep",
    });

    // Assert
    expect(result.forfeitureDue).toEqual([]);
    expect(scenario.participation("id-1").hold?.state).toBe(
      "AWAITING_REPLACEMENT",
    );
  });

  test("a waiting participant can leave the waitlist without any ledger entry", async () => {
    // Arrange
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    await scenario.commit("bob");
    const carol = await scenario.commit("carol");

    // Act
    const result = await scenario.leaveWaitlist.forParticipant({
      userId: "carol",
      sessionId,
      idempotencyKey: "leave-carol",
    });

    // Assert
    expect(result.participationId).toBe(carol.participationId);
    expect(scenario.participation(carol.participationId).status).toBe(
      "LEFT_WAITLIST",
    );
    expect(scenario.ledgerKinds()).toEqual(["LOCK", "LOCK"]);
  });

  test("an invited queue head leaving the waitlist lets the next person be promoted", async () => {
    // Arrange
    const scenario = withdrawalScenario({ totalSlots: 4 });
    await scenario.commit("alice");
    await scenario.commit("bob");
    await scenario.commit("erin");
    await scenario.commit("carol");
    await scenario.commit("dave");
    scenario.setTime(hoursBeforeSessionStart(31));
    await scenario.withdraw("erin", { mode: "DIRECT_INVITE", inviteeId: "carol" });
    await scenario.withdraw("alice", openSlot);

    // Act
    const result = await scenario.leaveWaitlist.forParticipant({
      userId: "carol",
      sessionId,
      idempotencyKey: "leave-carol",
    });

    // Assert
    expect(result.promotion).toMatchObject({
      status: "COMPLETED",
      result: { promoted: [{ userId: "dave" }] },
    });
  });

  describe("notifications", () => {
    test("a late named-invite withdrawal invites the invitee and warns the withdrawer", async () => {
      // Arrange
      const scenario = withdrawalScenario();
      await scenario.commit("alice");
      scenario.setTime(hoursBeforeSessionStart(10));

      // Act
      await scenario.withdraw("alice", {
        mode: "DIRECT_INVITE",
        inviteeId: "dave",
      });

      // Assert
      expect(scenario.unitOfWork.notifications.filter((entry) => !["BOOKING_JOINED", "WAITLIST_ENTERED"].includes(entry.kind)).map((entry) => [entry.kind, entry.recipientId])).toEqual([
        ["REPLACEMENT_INVITATION", "dave"],
        ["FORFEITURE_WARNING", "alice"],
      ]);
    });

    test("an early withdrawal sends no forfeiture warning, only the promotion notice", async () => {
      // Arrange
      const scenario = withdrawalScenario();
      await scenario.commit("alice");
      await scenario.commit("bob");
      await scenario.commit("carol");
      scenario.setTime(hoursBeforeSessionStart(31));

      // Act
      await scenario.withdraw("alice", openSlot);

      // Assert
      expect(scenario.unitOfWork.notifications.filter((entry) => !["BOOKING_JOINED", "WAITLIST_ENTERED"].includes(entry.kind)).map((entry) => [entry.kind, entry.recipientId])).toEqual([["PROMOTED", "carol"]]);
    });

    test("a late forfeit sends no forfeiture warning, because the share is already the booker's", async () => {
      // Arrange
      const scenario = withdrawalScenario();
      await scenario.commit("alice");
      scenario.setTime(hoursBeforeSessionStart(10));

      // Act
      await scenario.withdraw("alice", { mode: "FORFEIT" });

      // Assert
      expect(scenario.unitOfWork.notifications.filter((entry) => !["BOOKING_JOINED", "WAITLIST_ENTERED"].includes(entry.kind))).toEqual([]);
    });

    test("the forfeiture sweep records that the share is due for forfeiture", async () => {
      // Arrange
      const scenario = withdrawalScenario();
      await scenario.commit("alice");
      scenario.setTime(hoursBeforeSessionStart(10));
      await scenario.withdraw("alice", { mode: "DIRECT_INVITE", inviteeId: "dave" });
      scenario.unitOfWork.notifications.length = 0;
      scenario.setTime(sessionStartsAt);

      // Act
      await scenario.expireReplacements.forSession({
        sessionId,
        triggerKey: "start-sweep",
      });

      // Assert
      expect(scenario.unitOfWork.notifications.filter((entry) => !["BOOKING_JOINED", "WAITLIST_ENTERED"].includes(entry.kind)).map((entry) => [entry.kind, entry.recipientId])).toEqual([
        ["FORFEITURE_DUE", "alice"],
      ]);
    });

    test("persists a withdrawal independently of the legacy external notifier", async () => {
      // Arrange
      const scenario = withdrawalScenario();
      await scenario.commit("alice");
      scenario.setTime(hoursBeforeSessionStart(10));
      scenario.notifier.failNext = true;

      // Act
      const result = await scenario.withdraw("alice", {
        mode: "DIRECT_INVITE",
        inviteeId: "dave",
      });

      // Assert
      expect(result.kind).toBe("AWAITING_REPLACEMENT");
      expect(scenario.participation("id-1").status).toBe("WITHDRAWN");
    });
  });
});

function withdrawalScenario({ totalSlots = 3 } = {}) {
  const unitOfWork = new InMemoryUnitOfWork({
    users: ["alice", "bob", "carol", "dave", "erin"].map((userId) =>
      createTestUserDetails({ userId }),
    ),
    sessions: [new Session(sessionDetails({ totalSlots }))],
  });
  let now = hoursBeforeSessionStart(48);
  let nextId = 0;
  const notifier = new RecordingNotifier();
  const dependencies = {
    unitOfWork,
    clock: { now: () => now },
    ids: { next: () => `id-${++nextId}` },
    notifier,
  };
  const promote = new PromoteFromWaitlist(dependencies);
  const commitToSession = new CommitToSession(dependencies);
  const withdrawFromSession = new WithdrawFromSession({ ...dependencies, promote });
  const acceptReplacement = new AcceptReplacement(dependencies);

  return {
    unitOfWork,
    notifier,
    expireReplacements: new ExpireReplacements(dependencies),
    leaveWaitlist: new LeaveWaitlist({ ...dependencies, promote }),
    setTime(at: Date) {
      now = at;
    },
    commit(userId: string) {
      return commitToSession.forParticipant({
        userId,
        sessionId,
        idempotencyKey: `commit-${userId}`,
      });
    },
    withdraw(userId: string, replacement: ReplacementChoice) {
      return withdrawFromSession.forParticipant({
        userId,
        sessionId,
        idempotencyKey: `withdraw-${userId}`,
        replacement,
      });
    },
    acceptReplacement(userId: string) {
      return acceptReplacement.forInvitee({
        userId,
        sessionId,
        idempotencyKey: `accept-${userId}`,
      });
    },
    participation(participationId: string) {
      return unitOfWork
        .requireSession(sessionId)
        .participantList.requireParticipation(participationId);
    },
    ledgerKinds() {
      return unitOfWork.ledgerInstructions.map((instruction) => instruction.kind);
    },
  };
}


describe("replacement notification receipts", () => {
  test.each([48, 10])("acceptance %sh before start sends one departing-person outcome and never claims an earlier refund again", async (hours) => {
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(hours));
    await scenario.withdraw("alice", { mode: "DIRECT_INVITE", inviteeId: "dave" });
    scenario.unitOfWork.notifications.length = 0;
    await scenario.acceptReplacement("dave");
    expect(scenario.unitOfWork.notifications).toEqual([
      expect.objectContaining({ kind: "BOOKING_JOINED", recipientId: "dave" }),
      expect.objectContaining({ kind: "REPLACEMENT_ACCEPTED", recipientId: "alice", refundCents: hours === 10 ? 500 : 0 }),
    ]);
  });

  test("an ordinary entrant replacing a legacy late open-slot withdrawal still sends the actual refund receipt", async () => {
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(10));
    // Hydrate the old state without creating a new late waitlist withdrawal.
    await scenario.unitOfWork.execute("seed-legacy-open-withdrawal", async ({ sessions }) => {
      const session = (await sessions.get(sessionId))!;
      const before = session.participantList.requireParticipation("id-1");
      session.recordParticipationTransition(before, before.withdraw(before.hold!.awaitReplacement(), hoursBeforeSessionStart(10), "OPEN_SLOT"), hoursBeforeSessionStart(10));
      await sessions.save(session);
    });
    scenario.unitOfWork.notifications.length = 0;
    await scenario.commit("dave");
    expect(scenario.unitOfWork.notifications).toContainEqual(expect.objectContaining({ kind: "REPLACEMENT_REFUNDED", recipientId: "alice", refundCents: 500 }));
  });

  test("failed invitation persistence leaves the held share and participation committed", async () => {
    const scenario = withdrawalScenario();
    await scenario.commit("alice");
    scenario.setTime(hoursBeforeSessionStart(10));
    scenario.unitOfWork.failNextNotificationAppend = true;
    await expect(scenario.withdraw("alice", { mode: "DIRECT_INVITE", inviteeId: "dave" })).rejects.toThrow("Notification append failed");
    expect(scenario.participation("id-1").status).toBe("COMMITTED");
    expect(scenario.participation("id-1").hold?.state).toBe("HELD");
    expect(scenario.unitOfWork.notifications).toHaveLength(1);
  });
});
