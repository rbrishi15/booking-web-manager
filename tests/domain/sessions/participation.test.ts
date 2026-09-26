import {
  DomainError,
  FundHold,
  type FundHoldDetails,
  Money,
  Participation,
  type ParticipationDetails,
} from "@/domain";
import { describe, expect, test } from "vitest";

const createdAt = new Date("2026-10-01");
const settledAt = new Date("2026-10-03");

describe("Participation", () => {
  describe("Construction and isolation", () => {
    test("constructor_WhenDatesAreMutated_PreservesTimestampAndImmutableHold", () => {
      // Arrange
      const input = participationDetails();
      const participation = new Participation(input);

      // Act
      input.committedAt?.setTime(0);
      participation.committedAt?.setTime(0);

      // Assert
      expect(participation.committedAt).toEqual(createdAt);
      expect(participation.hold).toBe(input.hold);
    });

    test("constructor_WhenHoldBelongsToAnotherParticipation_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({
        hold: new FundHold(holdDetails({ participationId: "foreign" })),
      });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenCommittedHoldIsMissing_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({ hold: undefined });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenCommitmentDateIsMissing_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({ committedAt: undefined });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenAttendanceHasNoVerification_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({ attendance: "ATTENDED" });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenUnverifiedAttendanceHasMetadata_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({
        verifiedAt: settledAt,
        verificationMethod: "BOOKER",
      });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenWaitlistMetadataIsMissing_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({
        status: "WAITLISTED",
        hold: undefined,
      });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenWaitlistedParticipationHasHold_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({
        status: "WAITLISTED",
        waitlistedAt: createdAt,
        queueSequence: 1,
      });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenWithdrawnParticipationHasHeldFunds_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({
        status: "WITHDRAWN",
        withdrawnAt: settledAt,
      });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenCancelledParticipationHasHeldFunds_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({ status: "CANCELLED" });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenRemovedParticipationHasHold_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({ status: "REMOVED" });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenQueueSequenceIsZero_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({ queueSequence: 0 });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenParticipationReplacesItself_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({
        replacesParticipationId: "participation",
      });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenCommittedParticipationHasReplacementInvitation_ThrowsDomainError", () => {
      // Arrange
      const details = participationDetails({
        replacementMode: "INVITE_LINK",
        replacementToken: "token",
      });

      // Act & Assert
      expect(() => new Participation(details)).toThrow(DomainError);
    });
  });

  describe("Commitment and replacement", () => {
    test("commit_WhenPromotedAsReplacement_PreservesQueueEntryAndReplacementIdentity", () => {
      // Arrange
      const queued = Participation.createWaitlisted({
        participationId: "participation",
        userId: "user",
        waitlistedAt: createdAt,
        queueSequence: 1,
      });

      // Act
      const committed = queued.commit(
        new FundHold(holdDetails()),
        createdAt,
        "previous",
      );

      // Assert
      expect(committed.replacesParticipationId).toBe("previous");
      expect(queued.status).toBe("WAITLISTED");
      expect(queued.hold).toBeUndefined();
    });

    test("refundReplacement_WhenReplacementIsFound_ReturnsNewChild", () => {
      // Arrange
      const committed = new Participation(participationDetails());
      const withdrawn = committed.withdraw(
        committed.hold!.awaitReplacement(),
        createdAt,
      );

      // Act
      const finalized = withdrawn.refundReplacement(settledAt);

      // Assert
      expect(committed.status).toBe("COMMITTED");
      expect(committed.hold?.state).toBe("HELD");
      expect(withdrawn.hold?.state).toBe("AWAITING_REPLACEMENT");
      expect(finalized.hold?.state).toBe("REFUNDED");
    });
  });

  describe("Settlement", () => {
    test("settleHold_WhenReplacementExpires_ReturnsNewChild", () => {
      // Arrange
      const committed = new Participation(participationDetails());
      const withdrawn = committed.withdraw(
        committed.hold!.awaitReplacement(),
        createdAt,
      );

      // Act
      const finalized = withdrawn
        .expireReplacement(settledAt)
        .settleHold("FORFEIT", "payout", settledAt);

      // Assert
      expect(committed.status).toBe("COMMITTED");
      expect(committed.hold?.state).toBe("HELD");
      expect(withdrawn.hold?.state).toBe("AWAITING_REPLACEMENT");
      expect(finalized.hold?.state).toBe("FORFEITED");
      expect(finalized.reliabilityOutcome(settledAt)?.value).toBe(0);
    });

    test("settleHold_WhenAttendanceIsUnverified_RejectsRelease", () => {
      // Arrange
      const committed = new Participation(participationDetails());

      // Act & Assert
      expect(() =>
        committed.settleHold("RELEASE", "payout", settledAt),
      ).toThrow(DomainError);
    });

    test("settleHold_WhenAttendanceIsVerified_ReturnsReleasedCopy", () => {
      // Arrange
      const committed = new Participation(participationDetails());
      const attended = committed.verify("ATTENDED", "BOOKER", settledAt);

      // Act
      const settled = attended.settleHold("RELEASE", "payout", settledAt);

      // Assert
      expect(settled.hold?.state).toBe("RELEASED");
      expect(attended.hold?.state).toBe("HELD");
    });

    test("settleHold_WhenParticipantAttended_RejectsForfeiture", () => {
      // Arrange
      const committed = new Participation(participationDetails());
      const attended = committed.verify("ATTENDED", "BOOKER", settledAt);

      // Act & Assert
      expect(() => attended.settleHold("FORFEIT", "payout", settledAt)).toThrow(
        DomainError,
      );
    });
  });
});

function holdDetails(
  overrides: Partial<FundHoldDetails> = {},
): FundHoldDetails {
  return {
    holdId: "hold",
    participationId: "participation",
    holdingAccountId: "platform",
    walletId: "wallet",
    amount: Money.fromCents(500),
    state: "HELD",
    createdAt: new Date(createdAt),
    ...overrides,
  };
}

function participationDetails(
  overrides: Partial<ParticipationDetails> = {},
): ParticipationDetails {
  return {
    participationId: "participation",
    userId: "user",
    status: "COMMITTED",
    attendance: "UNVERIFIED",
    committedAt: new Date(createdAt),
    hold: new FundHold(holdDetails()),
    ...overrides,
  };
}
