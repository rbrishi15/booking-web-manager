import { Participation, Session } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  at,
  before,
  committedParticipation,
  createTestSession,
  sessionDetails,
} from "./session/session-fixtures";

describe("ParticipantList", () => {
  test("participations_WhenInputAndReturnedArraysAreMutated_PreservesEntriesAndLookups", () => {
    // Arrange
    const source = createTestSession({ committedUserIds: ["alice", "ben"] });
    const alice = source.participantList.requireParticipation("p-alice");
    const ben = source.participantList.requireParticipation("p-ben");
    const participations = [alice, ben];
    const list = new Session(sessionDetails({ participations }))
      .participantList;

    // Act
    participations.reverse();
    participations.pop();
    (list.participations as Participation[]).pop();
    (list.participations as Participation[]).reverse();

    // Assert
    expect(list.participations).toEqual([alice, ben]);
    expect(list.requireParticipation("p-alice")).toBe(alice);
    expect(list.findByUserId("alice")).toBe(alice);
    expect(list.requireParticipation("p-ben")).toBe(ben);
    expect(list.findByUserId("ben")).toBe(ben);
    expect(list.committedCount).toBe(2);
    expect(list.nextQueueSequence).toBe(1);
  });

  test("nextWaitlisted_WhenHydrationOrderDiffersFromQueue_SelectsLowestSequence", () => {
    // Arrange
    const alice = Participation.createWaitlisted({
      participationId: "p-alice",
      userId: "alice",
      waitlistedAt: before,
      queueSequence: 3,
    });
    const ben = Participation.createWaitlisted({
      participationId: "p-ben",
      userId: "ben",
      waitlistedAt: before,
      queueSequence: 1,
    });
    const cara = Participation.createWaitlisted({
      participationId: "p-cara",
      userId: "cara",
      waitlistedAt: before,
      queueSequence: 2,
    });
    const list = new Session(
      sessionDetails({
        participations: [alice, ben, cara],
        nextQueueSequence: 4,
      }),
    ).participantList;

    // Act
    const nextWaiter = list.nextWaitlisted();

    // Assert
    expect(nextWaiter).toBe(ben);
    expect(list.participations).toEqual([alice, ben, cara]);
    expect(list.findByUserId("ben")).toBe(nextWaiter);
    expect(list.committedCount).toBe(0);
    expect(list.nextQueueSequence).toBe(4);
  });

  test("oldestAwaitingReplacement_WhenWithdrawalTimesTie_PreservesHydrationOrder", () => {
    // Arrange
    const source = createTestSession();
    const alice = committedParticipation(source, "alice");
    const ben = committedParticipation(source, "ben");
    const cara = committedParticipation(source, "cara");
    const refundedCara = cara.withdraw(cara.hold!.refund(before), before);
    const withdrawnAlice = alice.withdraw(
      alice.hold!.awaitReplacement(),
      at(10),
      "OPEN_SLOT",
    );
    const withdrawnBen = ben.withdraw(
      ben.hold!.awaitReplacement(),
      at(10),
      "INVITE_LINK",
      "ben-replacement",
    );
    const list = new Session(
      sessionDetails({
        participations: [refundedCara, withdrawnBen, withdrawnAlice],
      }),
    ).participantList;

    // Act
    const oldestReplacement = list.oldestAwaitingReplacement();

    // Assert
    expect(oldestReplacement).toBe(withdrawnBen);
    expect(list.participations).toEqual([
      refundedCara,
      withdrawnBen,
      withdrawnAlice,
    ]);
    expect(list.findByUserId("ben")).toBe(oldestReplacement);
    expect(list.committedCount).toBe(0);
    expect(list.nextWaitlisted()).toBeUndefined();
  });
});
