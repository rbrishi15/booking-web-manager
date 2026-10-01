import { FundHold, Money, Participation, Session } from "@/domain";
import { describe, expect, test } from "vitest";
import { hoursBeforeSessionStart, sessionDetails } from "./session-fixtures";

describe("Session", () => {
  test("constructor_WhenReplacementTargetIsMissing_RejectsUnownedReference", () => {
    // Arrange
    const replacement = replacementCommitment("ben", "p-missing");
    const details = sessionDetails({ participations: [replacement] });

    // Act & Assert
    expect(() => new Session(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenDepartedWaiterClaimsInvitation_RejectsPhantomAcceptance", () => {
    // Arrange
    const inviter = refundedInvitation();
    const departedWaiter = new Participation({
      participationId: "p-ben",
      userId: "ben",
      status: "LEFT_WAITLIST",
      attendance: "UNVERIFIED",
      waitlistedAt: hoursBeforeSessionStart(48),
      queueSequence: 1,
      replacesParticipationId: "p-alice",
    });
    const details = sessionDetails({
      participations: [inviter, departedWaiter],
      nextQueueSequence: 2,
    });

    // Act & Assert
    expect(() => new Session(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenReplacementIsNotNamedInvitee_RejectsWrongRecipient", () => {
    // Arrange
    const inviter = refundedInvitation();
    const wrongRecipient = replacementCommitment("cara", "p-alice");
    const details = sessionDetails({
      participations: [inviter, wrongRecipient],
    });

    // Act & Assert
    expect(() => new Session(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenReplacedWithdrawalIsNotRefunded_RejectsUnsettledAcceptance", () => {
    // Arrange
    const aliceCommittedAt = hoursBeforeSessionStart(48);
    const aliceInvitedAt = hoursBeforeSessionStart(10);
    const inviter = new Participation({
      participationId: "p-alice",
      userId: "alice",
      status: "WITHDRAWN",
      attendance: "UNVERIFIED",
      committedAt: aliceCommittedAt,
      withdrawnAt: aliceInvitedAt,
      replacementMode: "DIRECT_INVITE",
      replacementInviteeId: "ben",
      hold: heldShare("alice").awaitReplacement(),
    });
    const replacement = replacementCommitment("ben", "p-alice");
    const details = sessionDetails({ participations: [inviter, replacement] });

    // Act & Assert
    expect(() => new Session(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenTargetWasCancelledWithoutWithdrawal_RejectsUnrelatedRefund", () => {
    // Arrange
    const aliceCommittedAt = hoursBeforeSessionStart(48);
    const cancelledAt = hoursBeforeSessionStart(40);
    const cancelledParticipant = new Participation({
      participationId: "p-alice",
      userId: "alice",
      status: "CANCELLED",
      attendance: "UNVERIFIED",
      committedAt: aliceCommittedAt,
      hold: heldShare("alice").refund(cancelledAt),
    });
    const replacement = replacementCommitment("ben", "p-alice");
    const details = sessionDetails({
      participations: [cancelledParticipant, replacement],
    });

    // Act & Assert
    expect(() => new Session(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenRemovedReplacementHasNoCommitmentHistory_RejectsPhantomAcceptance", () => {
    // Arrange
    const inviter = refundedInvitation();
    const uncommittedReplacement = new Participation({
      participationId: "p-ben",
      userId: "ben",
      status: "REMOVED",
      attendance: "UNVERIFIED",
      replacesParticipationId: "p-alice",
    });
    const details = sessionDetails({
      participations: [inviter, uncommittedReplacement],
    });

    // Act & Assert
    expect(() => new Session(details)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("constructor_WhenNamedReplacementCommitted_RestoresConsumedInvitation", () => {
    // Arrange
    const inviter = refundedInvitation();
    const replacement = replacementCommitment("ben", "p-alice");
    const details = sessionDetails({ participations: [inviter, replacement] });

    // Act
    const restored = new Session(details);

    // Assert
    expect(restored.participantList.reservedCount).toBe(0);
    expect(
      restored.participantList.personalReplacementForInvitee("ben"),
    ).toBeUndefined();
    expect(restored.participantList.committedCount).toBe(1);
    expect(restored.getAvailableSlots(hoursBeforeSessionStart(38))).toBe(1);
  });

  test("constructor_WhenAcceptedReplacementLaterWithdraws_KeepsOriginalInvitationConsumed", () => {
    // Arrange
    const benWithdrewAt = hoursBeforeSessionStart(10);
    const availabilityCheckedAt = hoursBeforeSessionStart(9);
    const inviter = refundedInvitation();
    const replacement = replacementCommitment("ben", "p-alice");
    const withdrawnReplacement = replacement.withdraw(
      replacement.hold!.awaitReplacement(),
      benWithdrewAt,
      "OPEN_SLOT",
    );
    const details = sessionDetails({
      participations: [inviter, withdrawnReplacement],
    });

    // Act
    const restored = new Session(details);

    // Assert
    expect(restored.participantList.reservedCount).toBe(0);
    expect(
      restored.participantList.personalReplacementForInvitee("ben"),
    ).toBeUndefined();
    expect(
      restored.participantList.requireParticipation("p-ben")
        .replacesParticipationId,
    ).toBe("p-alice");
    expect(restored.getAvailableSlots(availabilityCheckedAt)).toBe(2);
  });

  test("constructor_WhenAcceptedReplacementIsRemoved_KeepsOriginalInvitationConsumed", () => {
    // Arrange
    const benRemovedAt = hoursBeforeSessionStart(38);
    const availabilityCheckedAt = hoursBeforeSessionStart(37);
    const inviter = refundedInvitation();
    const replacement = replacementCommitment("ben", "p-alice");
    const removedReplacement = replacement.remove(
      replacement.hold!.refund(benRemovedAt),
    );
    const details = sessionDetails({
      participations: [inviter, removedReplacement],
    });

    // Act
    const restored = new Session(details);

    // Assert
    expect(restored.participantList.reservedCount).toBe(0);
    expect(
      restored.participantList.personalReplacementForInvitee("ben"),
    ).toBeUndefined();
    expect(
      restored.participantList.requireParticipation("p-ben")
        .replacesParticipationId,
    ).toBe("p-alice");
    expect(restored.getAvailableSlots(availabilityCheckedAt)).toBe(2);
  });

  test("constructor_WhenSessionWithAcceptedReplacementIsCancelled_RetainsReplacementHistory", () => {
    // Arrange
    const inviter = refundedInvitation();
    const replacement = replacementCommitment("ben", "p-alice");
    const details = sessionDetails({
      status: "CANCELLED",
      participations: [
        inviter.cancel(),
        replacement.cancel(
          replacement.hold!.refund(hoursBeforeSessionStart(38)),
        ),
      ],
    });

    // Act
    const restored = new Session(details);

    // Assert
    expect(restored.status).toBe("CANCELLED");
    expect(restored.participantList.reservedCount).toBe(0);
    expect(
      restored.participantList.personalReplacementForInvitee("ben"),
    ).toBeUndefined();
    expect(
      restored.participantList.requireParticipation("p-ben")
        .replacesParticipationId,
    ).toBe("p-alice");
    expect(
      restored.participantList.requireParticipation("p-alice").hold?.state,
    ).toBe("REFUNDED");
  });
});

function heldShare(
  userId: string,
  createdAt = hoursBeforeSessionStart(48),
): FundHold {
  return FundHold.create({
    holdId: `h-${userId}`,
    participationId: `p-${userId}`,
    walletId: `w-${userId}`,
    holdingAccountId: "platform",
    amount: Money.fromCents(500),
    createdAt,
  });
}

function refundedInvitation(): Participation {
  const aliceInvitedAt = hoursBeforeSessionStart(40);
  return new Participation({
    participationId: "p-alice",
    userId: "alice",
    status: "WITHDRAWN",
    attendance: "UNVERIFIED",
    committedAt: hoursBeforeSessionStart(48),
    withdrawnAt: aliceInvitedAt,
    replacementMode: "DIRECT_INVITE",
    replacementInviteeId: "ben",
    hold: heldShare("alice").refund(aliceInvitedAt),
  });
}

function replacementCommitment(
  userId: string,
  replacesParticipationId: string,
): Participation {
  const replacementCommittedAt = hoursBeforeSessionStart(39);
  return Participation.createCommitted({
    participationId: `p-${userId}`,
    userId,
    committedAt: replacementCommittedAt,
    hold: heldShare(userId, replacementCommittedAt),
    replacesParticipationId,
  });
}
