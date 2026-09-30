import { type AttendanceMark, PayoutAccount, Session } from "@/domain";
import { AutoVerifyAttendance } from "@/use-cases/sessions/AutoVerifyAttendance";
import { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { VerifyAttendance } from "@/use-cases/sessions/VerifyAttendance";
import { describe, expect, test } from "vitest";
import {
  createTestUserDetails,
  readyBookerUser,
} from "../domain/accounts/user-fixtures";
import {
  hoursAfterSessionEnd,
  hoursBeforeSessionStart,
  sessionDetails,
} from "../domain/sessions/session/session-fixtures";
import { InMemoryUnitOfWork } from "./support/in-memory-unit-of-work";

// A two-slot session booked by "booker" for 1000 cents: each share is 500.
const sessionId = "s";

// Owner: Yajie (Wyjessie) — /app/commit
describe("UC2-06 Verify Attendance", () => {
  test("releases held funds to the booker on manual verification", async () => {
    // Arrange
    const scenario = await verificationScenario();
    scenario.setTime(hoursAfterSessionEnd(1));

    // Act
    const result = await scenario.verify("booker", [
      scenario.mark("alice", "ATTENDED"),
      scenario.mark("bob", "ABSENT"),
    ]);

    // Assert
    expect(result).toEqual({ sessionId, status: "AWAITING_PAYOUT" });
    // Verification makes both shares payable to the booker; the payout flow
    // writes the RELEASE/FORFEIT ledger lines when the provider confirms.
    expect(scenario.payableLines()).toEqual([
      ["alice", "RELEASE", 500],
      ["bob", "FORFEIT", 500],
    ]);
    expect(scenario.ledgerKinds()).toEqual(["LOCK", "LOCK"]);
  });

  test("a partial verification keeps the session open for the remaining marks", async () => {
    // Arrange
    const scenario = await verificationScenario();
    scenario.setTime(hoursAfterSessionEnd(1));

    // Act
    const result = await scenario.verify("booker", [
      scenario.mark("alice", "ATTENDED"),
    ]);

    // Assert
    expect(result.status).toBe("OPEN");
    expect(scenario.participation("alice").attendance).toBe("ATTENDED");
    expect(scenario.participation("bob").attendance).toBe("UNVERIFIED");
  });

  test("rejects verification by anyone other than the booker", async () => {
    // Arrange
    const scenario = await verificationScenario();
    scenario.setTime(hoursAfterSessionEnd(1));

    // Act & Assert
    await expect(
      scenario.verify("alice", [
        scenario.mark("bob", "ABSENT"),
      ]),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(scenario.participation("bob").attendance).toBe("UNVERIFIED");
  });

  test("rejects verification before the session has ended", async () => {
    // Arrange
    const scenario = await verificationScenario();
    scenario.setTime(hoursAfterSessionEnd(-1));

    // Act & Assert
    await expect(
      scenario.verify("booker", [
        scenario.mark("alice", "ATTENDED"),
      ]),
    ).rejects.toMatchObject({ code: "SESSION_NOT_ENDED" });
  });

  test("a retried verification returns the original result", async () => {
    // Arrange
    const scenario = await verificationScenario();
    scenario.setTime(hoursAfterSessionEnd(1));
    const marks = [scenario.mark("alice", "ATTENDED")];
    const first = await scenario.verify("booker", marks);

    // Act
    const retry = await scenario.verify("booker", marks);

    // Assert
    expect(retry).toEqual(first);
  });

  test("auto-verifies and releases funds 72h after session end (not start) if unverified", async () => {
    // Arrange
    const scenario = await verificationScenario();
    scenario.setTime(hoursAfterSessionEnd(72));

    // Act
    const result = await scenario.autoVerify("sweep-72h");

    // Assert
    expect(result).toEqual({
      outcome: "VERIFIED",
      sessionId,
      verifiedParticipationIds: scenario.idsOf("alice", "bob"),
      status: "AWAITING_PAYOUT",
    });
    expect(scenario.participation("alice").verificationMethod).toBe(
      "AUTOMATIC",
    );
    expect(scenario.payableLines()).toEqual([
      ["alice", "RELEASE", 500],
      ["bob", "RELEASE", 500],
    ]);
  });

  test("auto-verification is not due just before 72h after session end", async () => {
    // Arrange
    const scenario = await verificationScenario();
    // Well over 72h after start, but under 72h after end.
    scenario.setTime(hoursAfterSessionEnd(71));

    // Act
    const result = await scenario.autoVerify("sweep-71h");

    // Assert
    expect(result).toEqual({ outcome: "NOT_DUE", sessionId });
    expect(scenario.participation("alice").attendance).toBe("UNVERIFIED");
  });

  test("auto-verification keeps the booker's existing marks", async () => {
    // Arrange
    const scenario = await verificationScenario();
    scenario.setTime(hoursAfterSessionEnd(1));
    await scenario.verify("booker", [
      scenario.mark("bob", "ABSENT"),
    ]);
    scenario.setTime(hoursAfterSessionEnd(72));

    // Act
    const result = await scenario.autoVerify("sweep-72h");

    // Assert
    expect(result).toMatchObject({
      verifiedParticipationIds: scenario.idsOf("alice"),
    });
    expect(scenario.participation("bob").attendance).toBe("ABSENT");
    expect(scenario.payableLines()).toEqual([
      ["alice", "RELEASE", 500],
      ["bob", "FORFEIT", 500],
    ]);
  });

  test("auto-verification leaves a session that is no longer open unchanged", async () => {
    // Arrange
    const scenario = await verificationScenario();
    scenario.setTime(hoursAfterSessionEnd(1));
    await scenario.verify("booker", [
      scenario.mark("alice", "ATTENDED"),
      scenario.mark("bob", "ATTENDED"),
    ]);
    scenario.setTime(hoursAfterSessionEnd(72));

    // Act
    const result = await scenario.autoVerify("sweep-72h");

    // Assert
    expect(result).toEqual({ outcome: "NOT_OPEN", sessionId });
    expect(scenario.participation("alice").verificationMethod).toBe("BOOKER");
  });
});

/** alice and bob have each committed 500 cents to the booker's session. */
async function verificationScenario() {
  const booker = readyBookerUser("booker");
  const unitOfWork = new InMemoryUnitOfWork({
    users: [
      createTestUserDetails({
        userId: "booker",
        payoutAccount: booker.payoutAccount as PayoutAccount,
      }),
      createTestUserDetails({ userId: "alice" }),
      createTestUserDetails({ userId: "bob" }),
    ],
    sessions: [new Session(sessionDetails())],
  });
  let now = hoursBeforeSessionStart(48);
  let nextId = 0;
  const dependencies = {
    unitOfWork,
    clock: { now: () => now },
    ids: { next: () => `id-${++nextId}` },
  };
  const participationIds = new Map<string, string>();
  const commitToSession = new CommitToSession(dependencies);
  for (const userId of ["alice", "bob"]) {
    const commitment = await commitToSession.forParticipant({
      userId,
      sessionId,
      idempotencyKey: `commit-${userId}`,
    });
    participationIds.set(userId, commitment.participationId);
  }
  const idOf = (userId: string) => {
    const id = participationIds.get(userId);
    if (id === undefined) throw new Error(`${userId} has not committed`);
    return id;
  };
  const userOf = (participationId: string) =>
    [...participationIds].find(([, id]) => id === participationId)?.[0];
  const verifyAttendance = new VerifyAttendance(dependencies);
  const autoVerifyAttendance = new AutoVerifyAttendance(dependencies);

  return {
    setTime(at: Date) {
      now = at;
    },
    mark(userId: string, attendance: AttendanceMark["attendance"]) {
      return { participationId: idOf(userId), attendance };
    },
    idsOf(...userIds: string[]) {
      return userIds.map(idOf);
    },
    verify(userId: string, marks: readonly AttendanceMark[]) {
      return verifyAttendance.forBooker({
        userId,
        sessionId,
        idempotencyKey: `verify-${marks.map((mark) => mark.participationId).join()}`,
        marks,
      });
    },
    autoVerify(triggerKey: string) {
      return autoVerifyAttendance.forSession({ sessionId, triggerKey });
    },
    participation(userId: string) {
      return unitOfWork
        .requireSession(sessionId)
        .participantList.requireParticipation(idOf(userId));
    },
    ledgerKinds() {
      return unitOfWork.ledgerInstructions.map((instruction) => instruction.kind);
    },
    /** The lines the booker's next payout would carry, as [user, kind, cents]. */
    payableLines() {
      const batch = booker.asBooker().preparePayout(
        unitOfWork.requireSession(sessionId),
        { payoutId: "payout", idempotencyKey: "payout", now },
      );
      return (batch?.lines ?? []).map((line) => [
        userOf(line.participationId),
        line.kind,
        line.amount.toCents(),
      ]);
    },
  };
}
