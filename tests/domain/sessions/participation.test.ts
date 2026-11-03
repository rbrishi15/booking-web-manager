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

describe("Participation state and fund lifecycle", () => {
  describe("Commitment and queue state", () => {
    test("constructor_WhenDatesAreMutated_PreservesTimestampAndImmutableHold", () => {
      const input = participationDetails();

      const participation = new Participation(input);
      input.committedAt?.setTime(0);
      participation.committedAt?.setTime(0);

      expect(participation.committedAt).toEqual(createdAt);
      expect(participation.hold).toBe(input.hold);
    });

    test("constructor_WhenHoldBelongsToAnotherParticipation_ThrowsDomainError", () => {
      const details = participationDetails({
        hold: new FundHold(holdDetails({ participationId: "foreign" })),
      });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenCommittedHoldIsMissing_ThrowsDomainError", () => {
      const details = participationDetails({ hold: undefined });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenCommitmentDateIsMissing_ThrowsDomainError", () => {
      const details = participationDetails({ committedAt: undefined });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenWaitlistMetadataIsMissing_ThrowsDomainError", () => {
      const details = participationDetails({
        status: "WAITLISTED",
        hold: undefined,
      });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenWaitlistedParticipationHasHold_ThrowsDomainError", () => {
      const details = participationDetails({
        status: "WAITLISTED",
        waitlistedAt: createdAt,
        queueSequence: 1,
      });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenQueueSequenceIsZero_ThrowsDomainError", () => {
      const details = participationDetails({ queueSequence: 0 });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("commit_WhenPromotedAsReplacement_PreservesQueueEntryAndReplacementIdentity", () => {
      const queued = Participation.createWaitlisted({
        participationId: "participation",
        userId: "user",
        waitlistedAt: createdAt,
        queueSequence: 1,
      });

      const committed = queued.commit(
        new FundHold(holdDetails()),
        createdAt,
        "previous",
      );

      expect(committed.replacesParticipationId).toBe("previous");
      expect(queued.status).toBe("WAITLISTED");
      expect(queued.hold).toBeUndefined();
    });
  });

  describe("Withdrawal and replacement reservations", () => {
    test("withdraw_WhenAcceptedReplacementLeaves_PreservesReplacementHistory", () => {
      const replacement = new Participation(
        participationDetails({ replacesParticipationId: "original-participation" }),
      );
      const awaitingHold = new FundHold(
        holdDetails({ state: "AWAITING_REPLACEMENT" }),
      );

      const withdrawn = replacement.withdraw(awaitingHold, settledAt, "OPEN_SLOT");

      expect(withdrawn.status).toBe("WITHDRAWN");
      expect(withdrawn.replacesParticipationId).toBe("original-participation");
      expect(withdrawn.hold?.state).toBe("AWAITING_REPLACEMENT");
      expect(replacement.status).toBe("COMMITTED");
    });

    test("constructor_WhenWithdrawnParticipationHasHeldFunds_ThrowsDomainError", () => {
      const details = participationDetails({
        status: "WITHDRAWN",
        withdrawnAt: settledAt,
      });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenParticipationReplacesItself_ThrowsDomainError", () => {
      const details = participationDetails({
        replacesParticipationId: "participation",
      });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenCommittedParticipationHasReplacementInvitation_ThrowsDomainError", () => {
      const details = participationDetails({
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "ben",
      });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenInvitationHasNoNamedInvitee_RejectsInvitation", () => {
      const details = participationDetails({
        status: "WITHDRAWN",
        withdrawnAt: settledAt,
        hold: new FundHold(holdDetails({ state: "AWAITING_REPLACEMENT" })),
        replacementMode: "DIRECT_INVITE",
      });

      expect(() => new Participation(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenInvitationHasBlankNamedInvitee_RejectsInvitation", () => {
      const details = participationDetails({
        status: "WITHDRAWN",
        withdrawnAt: settledAt,
        hold: new FundHold(holdDetails({ state: "AWAITING_REPLACEMENT" })),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: " ",
      });

      expect(() => new Participation(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenInvitationNamesWithdrawingParticipant_RejectsSelfReplacement", () => {
      const details = participationDetails({
        status: "WITHDRAWN",
        withdrawnAt: settledAt,
        hold: new FundHold(holdDetails({ state: "AWAITING_REPLACEMENT" })),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "user",
      });

      expect(() => new Participation(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenOpenPlaceHasNamedInvitee_RejectsReservationMetadata", () => {
      const details = participationDetails({
        status: "WITHDRAWN",
        withdrawnAt: settledAt,
        hold: new FundHold(holdDetails({ state: "AWAITING_REPLACEMENT" })),
        replacementMode: "OPEN_SLOT",
        replacementInviteeId: "ben",
      });

      expect(() => new Participation(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenInviteeHasNoReplacementMode_RejectsReservationMetadata", () => {
      const details = participationDetails({
        status: "WITHDRAWN",
        withdrawnAt: settledAt,
        hold: new FundHold(holdDetails({ state: "AWAITING_REPLACEMENT" })),
        replacementInviteeId: "ben",
      });

      expect(() => new Participation(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("withdraw_WhenEarlyWithdrawalInvitesOneNamedPerson_PreservesInvitationWithRefund", () => {
      const committed = new Participation(participationDetails());
      const refundedHold = new FundHold(
        holdDetails({ state: "REFUNDED", settledAt }),
      );

      const withdrawn = committed.withdraw(
        refundedHold,
        settledAt,
        "DIRECT_INVITE",
        "ben",
      );

      expect(withdrawn.status).toBe("WITHDRAWN");
      expect(withdrawn.hold?.state).toBe("REFUNDED");
      expect(withdrawn.replacementMode).toBe("DIRECT_INVITE");
      expect(withdrawn.replacementInviteeId).toBe("ben");
      expect(committed.status).toBe("COMMITTED");
      expect(committed.replacementInviteeId).toBeUndefined();
    });

    test("withdraw_WhenLateWithdrawalInvitesOneNamedPerson_PreservesInvitationWhileAwaitingReplacement", () => {
      const committed = new Participation(participationDetails());
      const awaitingHold = new FundHold(
        holdDetails({ state: "AWAITING_REPLACEMENT" }),
      );

      const withdrawn = committed.withdraw(
        awaitingHold,
        settledAt,
        "DIRECT_INVITE",
        "ben",
      );

      expect(withdrawn.status).toBe("WITHDRAWN");
      expect(withdrawn.hold?.state).toBe("AWAITING_REPLACEMENT");
      expect(withdrawn.replacementInviteeId).toBe("ben");
      expect(committed.hold?.state).toBe("HELD");
    });

    test("withdraw_WhenPersonalInvitationAlreadyChosen_RejectsSwitchToOpenPlace", () => {
      const withdrawn = new Participation(
        participationDetails({
          status: "WITHDRAWN",
          withdrawnAt: settledAt,
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "ben",
          hold: new FundHold(holdDetails({ state: "REFUNDED", settledAt })),
        }),
      );

      expect(() =>
        withdrawn.withdraw(withdrawn.hold!, settledAt, "OPEN_SLOT"),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(withdrawn.replacementMode).toBe("DIRECT_INVITE");
      expect(withdrawn.replacementInviteeId).toBe("ben");
      expect(withdrawn.hold?.state).toBe("REFUNDED");
    });

    test("withdraw_WhenOpenPlaceAlreadyChosen_RejectsSwitchToPersonalInvitation", () => {
      const withdrawn = new Participation(
        participationDetails({
          status: "WITHDRAWN",
          withdrawnAt: settledAt,
          replacementMode: "OPEN_SLOT",
          hold: new FundHold(holdDetails({ state: "AWAITING_REPLACEMENT" })),
        }),
      );

      expect(() =>
        withdrawn.withdraw(withdrawn.hold!, settledAt, "DIRECT_INVITE", "ben"),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(withdrawn.replacementMode).toBe("OPEN_SLOT");
      expect(withdrawn.replacementInviteeId).toBeUndefined();
      expect(withdrawn.hold?.state).toBe("AWAITING_REPLACEMENT");
    });

    test("refundReplacement_WhenReplacementIsFound_ReturnsNewChild", () => {
      const committed = new Participation(participationDetails());
      const withdrawn = committed.withdraw(
        committed.hold!.awaitReplacement(),
        createdAt,
        "DIRECT_INVITE",
        "ben",
      );

      const finalized = withdrawn.refundReplacement(settledAt);

      expect(committed.status).toBe("COMMITTED");
      expect(committed.hold?.state).toBe("HELD");
      expect(withdrawn.hold?.state).toBe("AWAITING_REPLACEMENT");
      expect(finalized.hold?.state).toBe("REFUNDED");
      expect(finalized.replacementInviteeId).toBe("ben");
    });
  });

  describe("Cancellation and removal", () => {
    test("remove_WhenAcceptedReplacementIsRemoved_PreservesReplacementHistory", () => {
      const replacement = new Participation(
        participationDetails({ replacesParticipationId: "original-participation" }),
      );
      const refundedHold = new FundHold(
        holdDetails({ state: "REFUNDED", settledAt }),
      );

      const removed = replacement.remove(refundedHold);

      expect(removed.status).toBe("REMOVED");
      expect(removed.replacesParticipationId).toBe("original-participation");
      expect(removed.hold?.state).toBe("REFUNDED");
      expect(replacement.status).toBe("COMMITTED");
    });

    test("cancel_WhenAcceptedReplacementIsCancelled_PreservesReplacementHistory", () => {
      const replacement = new Participation(
        participationDetails({ replacesParticipationId: "original-participation" }),
      );
      const refundedHold = new FundHold(
        holdDetails({ state: "REFUNDED", settledAt }),
      );

      const cancelled = replacement.cancel(refundedHold);

      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.replacesParticipationId).toBe("original-participation");
      expect(cancelled.hold?.state).toBe("REFUNDED");
      expect(replacement.status).toBe("COMMITTED");
    });

    test("constructor_WhenCancelledParticipationHasHeldFunds_ThrowsDomainError", () => {
      const details = participationDetails({ status: "CANCELLED" });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenRemovedParticipationHasHold_ThrowsDomainError", () => {
      const details = participationDetails({ status: "REMOVED" });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("cancel_WhenWithdrawalHasPersonalInvitation_ClearsReservationMetadata", () => {
      const withdrawn = new Participation(
        participationDetails({
          status: "WITHDRAWN",
          withdrawnAt: createdAt,
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "ben",
          hold: new FundHold(holdDetails({ state: "AWAITING_REPLACEMENT" })),
        }),
      );
      const refundedHold = new FundHold(
        holdDetails({ state: "REFUNDED", settledAt }),
      );

      const cancelled = withdrawn.cancel(refundedHold);

      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.replacementMode).toBeUndefined();
      expect(cancelled.replacementInviteeId).toBeUndefined();
      expect(withdrawn.replacementInviteeId).toBe("ben");
    });
  });

  describe("Attendance verification and settlement", () => {
    test("constructor_WhenAttendanceHasNoVerification_ThrowsDomainError", () => {
      const details = participationDetails({ attendance: "ATTENDED" });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("constructor_WhenUnverifiedAttendanceHasMetadata_ThrowsDomainError", () => {
      const details = participationDetails({
        verifiedAt: settledAt,
        verificationMethod: "BOOKER",
      });

      expect(() => new Participation(details)).toThrow(DomainError);
    });

    test("settleHold_WhenAttendanceIsUnverified_RejectsRelease", () => {
      const committed = new Participation(participationDetails());

      expect(() =>
        committed.settleHold("RELEASE", "payout", settledAt),
      ).toThrow(DomainError);
    });

    test("settleHold_WhenAttendanceIsVerified_ReturnsReleasedCopy", () => {
      const attended = new Participation(
        participationDetails({
          attendance: "ATTENDED",
          verificationMethod: "BOOKER",
          verifiedAt: settledAt,
        }),
      );

      const settled = attended.settleHold("RELEASE", "payout", settledAt);

      expect(settled.hold?.state).toBe("RELEASED");
      expect(attended.hold?.state).toBe("HELD");
    });

    test("settleHold_WhenParticipantAttended_RejectsForfeiture", () => {
      const attended = new Participation(
        participationDetails({
          attendance: "ATTENDED",
          verificationMethod: "BOOKER",
          verifiedAt: settledAt,
        }),
      );

      expect(() => attended.settleHold("FORFEIT", "payout", settledAt)).toThrow(
        DomainError,
      );
    });
  });

  describe("Replacement expiry and forfeiture", () => {
    test("expireReplacement_WhenReplacementIsStillAwaited_ReturnsForfeitureDueCopy", () => {
      const withdrawn = new Participation(
        participationDetails({
          status: "WITHDRAWN",
          withdrawnAt: createdAt,
          hold: new FundHold(holdDetails({ state: "AWAITING_REPLACEMENT" })),
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "ben",
        }),
      );

      const expired = withdrawn.expireReplacement(settledAt);

      expect(expired).not.toBe(withdrawn);
      expect(expired.hold?.state).toBe("FORFEITURE_DUE");
      expect(expired.replacementInviteeId).toBe("ben");
      expect(withdrawn.hold?.state).toBe("AWAITING_REPLACEMENT");
    });

    test("settleHold_WhenReplacementForfeitureIsDue_ReturnsForfeitedCopy", () => {
      const withdrawn = new Participation(
        participationDetails({
          status: "WITHDRAWN",
          withdrawnAt: createdAt,
          hold: new FundHold(holdDetails({ state: "FORFEITURE_DUE" })),
        }),
      );

      const finalized = withdrawn.settleHold("FORFEIT", "payout", settledAt);

      expect(finalized).not.toBe(withdrawn);
      expect(withdrawn.hold?.state).toBe("FORFEITURE_DUE");
      expect(finalized.hold?.state).toBe("FORFEITED");
      expect(finalized.hold?.payoutId).toBe("payout");
    });

    test("reliabilityOutcome_WhenReplacementForfeitureIsSettled_ReturnsZero", () => {
      const finalized = new Participation(
        participationDetails({
          status: "WITHDRAWN",
          withdrawnAt: createdAt,
          hold: new FundHold(
            holdDetails({ state: "FORFEITED", payoutId: "payout", settledAt }),
          ),
        }),
      );

      const reliabilityValue = finalized.reliabilityOutcome(settledAt)?.value;

      expect(reliabilityValue).toBe(0);
    });
  });

  describe("Forfeited places", () => {
    test("constructor_WhenForfeitedPlaceStillAwaitsReplacement_RejectsForfeit", () => {
      const details = participationDetails({
        status: "WITHDRAWN",
        withdrawnAt: settledAt,
        hold: new FundHold(holdDetails({ state: "AWAITING_REPLACEMENT" })),
        replacementMode: "FORFEIT",
      });

      expect(() => new Participation(details)).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
    });

    test("constructor_WhenForfeitedShareIsDue_KeepsForfeitMode", () => {
      const details = participationDetails({
        status: "WITHDRAWN",
        withdrawnAt: settledAt,
        hold: new FundHold(holdDetails({ state: "FORFEITURE_DUE" })),
        replacementMode: "FORFEIT",
      });

      const participation = new Participation(details);

      expect(participation.replacementMode).toBe("FORFEIT");
      expect(participation.hold?.state).toBe("FORFEITURE_DUE");
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
