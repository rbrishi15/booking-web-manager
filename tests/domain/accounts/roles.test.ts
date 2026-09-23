import { Booking, DomainError, Money, User } from "@/domain";
import { describe, expect, test } from "vitest";
import { loadedUser } from "./user-fixtures";

const start = new Date("2026-10-10T10:00:00Z");
const end = new Date("2026-10-10T12:00:00Z");
const before = new Date("2026-10-08T10:00:00Z");

function user(userId: string): User {
  return loadedUser(userId);
}

function sessionOwnedBy(owner: User) {
  owner.beginPayoutSetup({
    payoutAccountId: "payout-account",
    providerAccountReference: "provider-account",
  });
  owner.completePayoutSetup("bank-account");

  return owner.asBooker().createSession({
    sessionId: "session",
    booking: new Booking({
      venueName: "Court",
      region: "North",
      sport: "Badminton",
      startAt: start,
      endAt: end,
      totalCost: Money.fromCents(1_000),
    }),
    totalSlots: 2,
    minimumHeadcount: 2,
    roomToken: "room",
    holdingAccountId: "platform",
    visibility: "PUBLIC",
    now: before,
  });
}

describe("User roles", () => {
  test("booker role creates and manages sessions for its user", () => {
    // Arrange
    const owner = user("owner");
    const session = sessionOwnedBy(owner);

    // Act
    const result = owner.asBooker().cancel(session, before);

    // Assert
    expect(session.bookerId).toBe(owner.userId);
    expect(session.status).toBe("CANCELLED");
    expect(result.instructions).toEqual([]);
  });

  test("participant role supplies identity while the caller supplies action details", () => {
    // Arrange
    const owner = user("owner");
    const participant = user("participant");
    const session = sessionOwnedBy(owner);

    // Act
    const admission = participant.asParticipant().join(session, {
      participationId: "participation",
      holdId: "hold",
      now: before,
    });
    const withdrawal = participant.asParticipant().withdraw(session, {
      participationId: admission.participationId,
      now: new Date(start.getTime() - 31 * 3_600_000),
    });

    // Assert
    expect(admission.kind).toBe("COMMITTED");
    expect(withdrawal.kind).toBe("REFUNDED");
    expect(session.participations[0]?.userId).toBe(participant.userId);
    expect(session.participations[0]?.status).toBe("WITHDRAWN");
  });

  test("participant admission uses its user and funds the hold from the loaded wallet", () => {
    // Arrange
    const participantUser = user("participant");
    const session = sessionOwnedBy(user("owner"));

    // Act
    const admission = participantUser.asParticipant().join(session, {
      participationId: "participation",
      holdId: "hold",
      now: before,
    });

    // Assert
    expect(admission.kind).toBe("COMMITTED");
    expect(session.participations[0]?.userId).toBe(participantUser.userId);
    expect(admission.instructions).toEqual([
      expect.objectContaining({
        kind: "LOCK",
        walletId: "w-participant",
        participationId: "participation",
        holdId: "hold",
      }),
    ]);
    expect(admission.instructions[0]?.amount.toCents()).toBe(500);
  });

  test.each(["before", "after"] as const)(
    "rejects an inactive user when the role was created %s deactivation",
    (roleCreated) => {
      // Arrange
      const participantUser = loadedUser("participant", {
        walletBalance: {
          walletId: "w-participant",
          availableBalance: Money.fromCents(0),
        },
      });
      const session = sessionOwnedBy(user("owner"));
      const existingRole =
        roleCreated === "before" ? participantUser.asParticipant() : undefined;
      participantUser.deactivate({
        availableBalance: Money.fromCents(0),
        heldBalance: Money.fromCents(0),
        activeCommitments: 0,
        unsettledOwnedSessions: 0,
        pendingPayouts: 0,
        activeOwnedGroups: 0,
      });
      const participant = existingRole ?? participantUser.asParticipant();

      // Act
      const join = () =>
        participant.join(session, {
          participationId: "participation",
          holdId: "hold",
          now: before,
        });

      // Assert
      expect(join).toThrow(
        expect.objectContaining<Partial<DomainError>>({
          code: "INACTIVE_ACCOUNT",
        }),
      );
      expect(session.participations).toEqual([]);
    },
  );
});
