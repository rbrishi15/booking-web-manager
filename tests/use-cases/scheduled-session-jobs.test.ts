import { Participation, Session } from "@/domain";
import { AutoVerifyAttendance } from "@/use-cases/sessions/AutoVerifyAttendance";
import { ExpireReplacements } from "@/use-cases/sessions/ExpireReplacements";
import { PromoteFromWaitlist } from "@/use-cases/sessions/PromoteFromWaitlist";
import { RunScheduledSessionJobs } from "@/use-cases/sessions/RunScheduledSessionJobs";
import type { VerificationReminder } from "@/use-cases/sessions/scheduling-ports";
import { describe, expect, test } from "vitest";
import {
  createTestUser,
  createTestUserDetails,
} from "../domain/accounts/user-fixtures";
import {
  committedParticipation,
  hoursAfterSessionEnd,
  hoursBeforeSessionStart,
  sessionDetails,
  sessionStartsAt,
} from "../domain/sessions/session/session-fixtures";
import { InMemoryUnitOfWork } from "./support/in-memory-unit-of-work";
import { RecordingNotifier } from "./support/recording-notifier";

describe("Scheduled session jobs (UC2-05, UC2-06)", () => {
  test("marks unreplaced late withdrawals forfeiture-due once the session starts", async () => {
    // Arrange
    const session = rosterSession("s1", { committed: ["alice", "bob"] });
    withdrawLate(session, "alice");
    const { runner } = sweepScenario([session], sessionStartsAt);

    // Act
    const report = await runner.run("run-1");

    // Assert
    expect(report).toMatchObject({
      sessionsChecked: 1,
      forfeitureDue: ["p-alice"],
      promoted: [],
      autoVerified: [],
      failures: [],
    });
  });

  test("fills a free place that a deferred promotion left empty", async () => {
    // Arrange
    const session = rosterSession("s1", {
      committed: ["alice"],
      waitlisted: ["carol"],
    });
    const { runner, unitOfWork } = sweepScenario(
      [session],
      hoursBeforeSessionStart(24),
    );

    // Act
    const report = await runner.run("run-1");

    // Assert
    expect(report.promoted).toEqual(["p-carol"]);
    expect(unitOfWork.availableCents("carol")).toBe(9_500);
  });

  test("auto-verifies unverified participants 72h after the session ends", async () => {
    // Arrange
    const session = rosterSession("s1", { committed: ["alice", "bob"] });
    const { runner, unitOfWork } = sweepScenario(
      [session],
      hoursAfterSessionEnd(72),
    );

    // Act
    const report = await runner.run("run-1");

    // Assert
    expect(report.autoVerified).toEqual(["p-alice", "p-bob"]);
    expect(unitOfWork.requireSession("s1").status).toBe("AWAITING_PAYOUT");
  });

  test("records a failing job and still processes the remaining sessions", async () => {
    // Arrange
    // "ghost" is waitlisted but has no user record, so promotion fails for s1.
    const broken = rosterSession("s1", {
      committed: ["alice"],
      waitlisted: ["ghost"],
    });
    const healthy = rosterSession("s2", {
      committed: ["bob"],
      waitlisted: ["carol"],
    });
    const { runner } = sweepScenario(
      [broken, healthy],
      hoursBeforeSessionStart(24),
      { missingUsers: ["ghost"] },
    );

    // Act
    const report = await runner.run("run-1");

    // Assert
    expect(report.failures).toEqual([{ sessionId: "s1", job: "PROMOTE" }]);
    expect(report.promoted).toEqual(["p-carol"]);
    expect(report.sessionsChecked).toBe(2);
  });

  test("a session with nothing due is left unchanged", async () => {
    // Arrange
    const session = rosterSession("s1", { committed: ["alice", "bob"] });
    const { runner, unitOfWork } = sweepScenario(
      [session],
      hoursBeforeSessionStart(24),
    );

    // Act
    const report = await runner.run("run-1");

    // Assert
    expect(report).toMatchObject({
      forfeitureDue: [],
      promoted: [],
      autoVerified: [],
      failures: [],
    });
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
  });

  test("asks the due-session query for at most one batch", async () => {
    // Arrange
    const requests: { now: Date; limit: number }[] = [];
    const now = hoursBeforeSessionStart(24);
    const { runner } = sweepScenario([], now, {
      batchSize: 25,
      onQuery: (queriedAt, limit) => requests.push({ now: queriedAt, limit }),
    });

    // Act
    await runner.run("run-1");

    // Assert
    expect(requests).toEqual([{ now, limit: 25 }]);
  });

  test("reminds each claimed booker to verify attendance", async () => {
    // Arrange
    const { runner, notifier } = sweepScenario([], hoursAfterSessionEnd(1), {
      reminders: [
        { sessionId: "s1", bookerId: "booker-1" },
        { sessionId: "s2", bookerId: "booker-2" },
      ],
    });

    // Act
    const report = await runner.run("run-1");

    // Assert
    expect(report.verificationReminders).toEqual(["s1", "s2"]);
    expect(notifier.deliveries()).toEqual([
      ["VERIFICATION_REMINDER", "booker-1"],
      ["VERIFICATION_REMINDER", "booker-2"],
    ]);
  });

  test("releases claimed reminders for a retry when they cannot be handed off", async () => {
    // Arrange
    const { runner, notifier, released } = sweepScenario(
      [],
      hoursAfterSessionEnd(1),
      { reminders: [{ sessionId: "s1", bookerId: "booker-1" }] },
    );
    notifier.failNext = true;

    // Act
    const report = await runner.run("run-1");

    // Assert
    expect(released).toEqual(["s1"]);
    expect(report.verificationReminders).toEqual([]);
    expect(report.failures).toEqual([{ job: "VERIFICATION_REMINDERS" }]);
  });

  test("keeps the claims of reminders that were handed off", async () => {
    // Arrange
    const { runner, released } = sweepScenario([], hoursAfterSessionEnd(1), {
      reminders: [{ sessionId: "s1", bookerId: "booker-1" }],
    });

    // Act
    await runner.run("run-1");

    // Assert
    expect(released).toEqual([]);
  });

  test("records a failed reminder claim without failing the sweep", async () => {
    // Arrange
    const session = rosterSession("s1", { committed: ["alice", "bob"] });
    const { runner } = sweepScenario([session], hoursAfterSessionEnd(72), {
      failReminderClaim: true,
    });

    // Act
    const report = await runner.run("run-1");

    // Assert
    expect(report.failures).toEqual([{ job: "VERIFICATION_REMINDERS" }]);
    expect(report.autoVerified).toEqual(["p-alice", "p-bob"]);
  });
});

/** A two-slot, 1000-cent session: each share is 500 cents. */
function rosterSession(
  sessionId: string,
  roster: { committed: readonly string[]; waitlisted?: readonly string[] },
): Session {
  const details = sessionDetails({ sessionId });
  const terms = {
    holdingAccountId: details.holdingAccountId,
    bookingShare: details.booking.totalCost.divideFloor(details.totalSlots),
  };
  const waitlisted = roster.waitlisted ?? [];
  return new Session({
    ...details,
    participations: [
      ...roster.committed.map((userId) => committedParticipation(terms, userId)),
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

function withdrawLate(session: Session, userId: string): void {
  createTestUser({ userId })
    .asParticipant()
    .withdraw(session, {
      participationId: `p-${userId}`,
      now: hoursBeforeSessionStart(10),
      replacementMode: "OPEN_SLOT",
    });
}

function sweepScenario(
  sessions: readonly Session[],
  now: Date,
  options: {
    missingUsers?: readonly string[];
    reminders?: readonly VerificationReminder[];
    failReminderClaim?: boolean;
    batchSize?: number;
    onQuery?: (now: Date, limit: number) => void;
  } = {},
) {
  const userIds = new Set(
    sessions.flatMap((session) =>
      session.participantList.participations.map(({ userId }) => userId),
    ),
  );
  for (const missing of options.missingUsers ?? []) userIds.delete(missing);
  const unitOfWork = new InMemoryUnitOfWork({
    users: [...userIds].map((userId) => createTestUserDetails({ userId })),
    sessions,
  });
  let nextId = 0;
  const notifier = new RecordingNotifier();
  const released: string[] = [];
  const dependencies = {
    unitOfWork,
    clock: { now: () => now },
    ids: { next: () => `id-${++nextId}` },
    notifier,
  };
  const runner = new RunScheduledSessionJobs({
    dueSessions: {
      dueSessionIds: async (queriedAt, limit) => {
        options.onQuery?.(queriedAt, limit);
        return sessions.map((session) => session.sessionId);
      },
    },
    verificationReminders: {
      claimVerificationReminders: async () => {
        if (options.failReminderClaim) throw new Error("database unavailable");
        return options.reminders ?? [];
      },
      releaseVerificationReminders: async (sessionIds) => {
        released.push(...sessionIds);
      },
    },
    notifier,
    expireReplacements: new ExpireReplacements(dependencies),
    promote: new PromoteFromWaitlist(dependencies),
    autoVerify: new AutoVerifyAttendance(dependencies),
    clock: dependencies.clock,
    batchSize: options.batchSize ?? 50,
  });
  return { runner, unitOfWork, notifier, released };
}
