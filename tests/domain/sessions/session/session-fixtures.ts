import {
  Booking,
  FundHold,
  Money,
  Participation,
  Session,
  type BookerSessionCreation,
  type SessionDetails,
} from "@/domain";
import { readyBookerUser } from "../../accounts/user-fixtures";

export { createTestUser } from "../../accounts/user-fixtures";

const millisecondsPerHour = 3_600_000;
export const sessionStartsAt = new Date("2026-10-10T10:00:00Z");
export const sessionEndsAt = new Date(
  sessionStartsAt.getTime() + 2 * millisecondsPerHour,
);
export const hoursBeforeSessionStart = (hours: number) =>
  new Date(sessionStartsAt.getTime() - hours * millisecondsPerHour);
export const hoursBeforeSessionEnd = (hours: number) =>
  new Date(sessionEndsAt.getTime() - hours * millisecondsPerHour);
export const hoursAfterSessionEnd = (hours: number) =>
  new Date(sessionEndsAt.getTime() + hours * millisecondsPerHour);
export const destination = {
  payoutAccountId: "pa",
  userId: "booker",
  providerAccountReference: "provider",
  bankAccountReference: "bank",
};

export function creationDetails(totalSlots = 2): BookerSessionCreation {
  return {
    sessionId: "s",
    booking: new Booking({
      venueName: "Court",
      region: "North",
      sport: "Badminton",
      startAt: sessionStartsAt,
      endAt: sessionEndsAt,
      totalCost: Money.fromCents(1000),
    }),
    totalSlots,
    minimumHeadcount: 2,
    holdingAccountId: "platform",
    roomToken: "room",
    visibility: "PUBLIC",
    now: hoursBeforeSessionStart(48),
  };
}

export function readyBooker(userId = "booker") {
  return readyBookerUser(userId).asBooker();
}

interface TestSessionOptions {
  readonly totalSlots?: number;
  readonly committedUserIds?: readonly string[];
  readonly waitlistedUserIds?: readonly string[];
}

/** Constructs the declared starting roster; admission workflows stay in the test. */
export function createTestSession({
  totalSlots = 2,
  committedUserIds = [],
  waitlistedUserIds = [],
}: TestSessionOptions = {}): Session {
  const details = sessionDetails({ totalSlots });
  const terms = {
    holdingAccountId: details.holdingAccountId,
    bookingShare: details.booking.totalCost.divideFloor(totalSlots),
  };
  return new Session({
    ...details,
    participations: [
      ...committedUserIds.map((userId) =>
        committedParticipation(terms, userId),
      ),
      ...waitlistedUserIds.map((userId, index) =>
        Participation.createWaitlisted({
          participationId: `p-${userId}`,
          userId,
          waitlistedAt: hoursBeforeSessionStart(48),
          queueSequence: index + 1,
        }),
      ),
    ],
    nextQueueSequence: waitlistedUserIds.length + 1,
  });
}

export function committedParticipation(
  session: Pick<Session, "holdingAccountId" | "bookingShare">,
  userId: string,
  now = hoursBeforeSessionStart(48),
) {
  return Participation.createCommitted({
    participationId: `p-${userId}`,
    userId,
    committedAt: now,
    hold: FundHold.create({
      holdId: `h-${userId}`,
      participationId: `p-${userId}`,
      holdingAccountId: session.holdingAccountId,
      walletId: `w-${userId}`,
      amount: session.bookingShare,
      createdAt: now,
    }),
  });
}

export function verifiedParticipation(
  userId: string,
  attendance: "ATTENDED" | "ABSENT",
  verifiedAt = sessionEndsAt,
): Participation {
  return new Participation({
    participationId: `p-${userId}`,
    userId,
    status: "COMMITTED",
    attendance,
    committedAt: hoursBeforeSessionStart(48),
    verifiedAt,
    verificationMethod: "BOOKER",
    hold: new FundHold({
      holdId: `h-${userId}`,
      participationId: `p-${userId}`,
      holdingAccountId: "platform",
      walletId: `w-${userId}`,
      amount: Money.fromCents(500),
      state: "HELD",
      createdAt: hoursBeforeSessionStart(48),
    }),
  });
}

/** A fixed release-only payout state; tests declare other outcomes explicitly. */
export function pendingPayoutDetails(
  userIds: readonly string[] = ["alice"],
): SessionDetails {
  return sessionDetails({
    status: "PAYOUT_PENDING",
    participations: userIds.map((userId) =>
      verifiedParticipation(userId, "ATTENDED"),
    ),
    pendingSettlement: {
      payoutId: "out",
      sessionId: "s",
      idempotencyKey: "key",
      requestedAt: new Date(sessionEndsAt),
      destination: { ...destination },
      lines: userIds.map((userId) => ({
        holdId: `h-${userId}`,
        participationId: `p-${userId}`,
        holdingAccountId: "platform",
        walletId: `w-${userId}`,
        amount: Money.fromCents(500),
        kind: "RELEASE",
      })),
    },
    payoutAttemptIds: ["out"],
    payoutIdempotencyKeys: ["key"],
  });
}

export function sessionDetails(
  overrides: Partial<SessionDetails> = {},
): SessionDetails {
  return {
    sessionId: "s",
    bookerId: "booker",
    booking: creationDetails().booking,
    totalSlots: 2,
    minimumHeadcount: 2,
    holdingAccountId: "platform",
    roomToken: "room",
    visibility: "PUBLIC",
    status: "OPEN",
    participations: [],
    nextQueueSequence: 1,
    payoutAttemptIds: [],
    payoutIdempotencyKeys: [],
    ...overrides,
  };
}

// Capture observable command effects as values, including nested private-field objects.
export function sessionState(s: Session) {
  const batch = s.pendingSettlement;
  return {
    status: s.status,
    visibility: s.visibility,
    invitedGroupId: s.invitedGroupId,
    nextQueueSequence: s.participantList.nextQueueSequence,
    payoutAttemptIds: s.payoutAttemptIds,
    payoutIdempotencyKeys: s.payoutIdempotencyKeys,
    pendingSettlement: batch && {
      ...batch,
      lines: batch.lines.map((line) => ({
        ...line,
        amount: line.amount.toCents(),
      })),
    },
    participations: s.participantList.participations.map((p) => ({
      participationId: p.participationId,
      userId: p.userId,
      status: p.status,
      attendance: p.attendance,
      queueSequence: p.queueSequence,
      waitlistedAt: p.waitlistedAt,
      committedAt: p.committedAt,
      withdrawnAt: p.withdrawnAt,
      replacementMode: p.replacementMode,
      replacementInviteeId: p.replacementInviteeId,
      replacesParticipationId: p.replacesParticipationId,
      verifiedAt: p.verifiedAt,
      verificationMethod: p.verificationMethod,
      hold: p.hold && {
        holdId: p.hold.holdId,
        participationId: p.hold.participationId,
        holdingAccountId: p.hold.holdingAccountId,
        walletId: p.hold.walletId,
        amount: p.hold.amount.toCents(),
        state: p.hold.state,
        payoutId: p.hold.payoutId,
        createdAt: p.hold.createdAt,
        settledAt: p.hold.settledAt,
      },
    })),
  };
}
