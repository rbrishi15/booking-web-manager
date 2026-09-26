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

export const hour = 3_600_000;
export const start = new Date("2026-10-10T10:00:00Z");
export const end = new Date(start.getTime() + 2 * hour);
export const before = new Date(start.getTime() - 48 * hour);
export const at = (hoursBefore: number) =>
  new Date(start.getTime() - hoursBefore * hour);
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
      startAt: start,
      endAt: end,
      totalCost: Money.fromCents(1000),
    }),
    totalSlots,
    minimumHeadcount: 2,
    holdingAccountId: "platform",
    roomToken: "room",
    visibility: "PUBLIC",
    now: before,
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
          waitlistedAt: before,
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
  now = before,
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
    nextQueueSequence: s.nextQueueSequence,
    payoutAttemptIds: s.payoutAttemptIds,
    payoutIdempotencyKeys: s.payoutIdempotencyKeys,
    pendingSettlement: batch && {
      ...batch,
      lines: batch.lines.map((line) => ({
        ...line,
        amount: line.amount.toCents(),
      })),
    },
    participations: s.participations.map((p) => ({
      participationId: p.participationId,
      userId: p.userId,
      status: p.status,
      attendance: p.attendance,
      queueSequence: p.queueSequence,
      waitlistedAt: p.waitlistedAt,
      committedAt: p.committedAt,
      withdrawnAt: p.withdrawnAt,
      replacementMode: p.replacementMode,
      replacementToken: p.replacementToken,
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
