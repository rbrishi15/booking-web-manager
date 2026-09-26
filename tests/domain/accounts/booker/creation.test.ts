import { Money, PayoutAccount } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  createTestUser,
  creationDetails,
  end,
  readyBooker,
} from "../../sessions/session/session-fixtures";
import { readyBookerUser } from "../user-fixtures";

describe("Booker", () => {
  test("createSession_WhenRoleWasCreatedBeforeDeactivation_ThrowsInactiveAccount", () => {
    // Arrange
    const owner = createTestUser({
      userId: "booker",
      availableFundsCents: 0,
      payoutAccount: readyBookerUser().payoutAccount,
    });
    const booker = owner.asBooker();
    owner.deactivate({
      availableBalance: Money.fromCents(0),
      heldBalance: Money.fromCents(0),
      activeCommitments: 0,
      unsettledOwnedSessions: 0,
      pendingPayouts: 0,
      activeOwnedGroups: 0,
    });

    // Act & Assert
    expect(() => booker.createSession(creationDetails())).toThrow(
      expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
    );
  });

  test("createSession_WhenOptionalSettingsAreOmitted_UsesPrivateVisibilityAndEmptyLifecycle", () => {
    // Arrange
    const booker = readyBooker();
    const details = creationDetails();

    // Act
    const bookingSession = booker.createSession({
      ...details,
      visibility: undefined,
    });

    // Assert
    expect(bookingSession.bookerId).toBe(booker.userId);
    expect(bookingSession.visibility).toBe("PRIVATE");
    expect(bookingSession.status).toBe("OPEN");
    expect(bookingSession.participations).toEqual([]);
    expect(bookingSession.nextQueueSequence).toBe(1);
    expect(bookingSession.payoutAttemptIds).toEqual([]);
    expect(bookingSession.payoutIdempotencyKeys).toEqual([]);
    expect(bookingSession.pendingSettlement).toBeUndefined();
  });

  test("createSession_WhenBookerIsInactive_ThrowsInactiveAccount", () => {
    // Arrange
    const details = creationDetails();

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "booker", accountStatus: "INACTIVE" })
        .asBooker()
        .createSession(details),
    ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
  });

  test("createSession_WhenPayoutAccountIsIncomplete_ThrowsPayoutAccountNotReady", () => {
    // Arrange
    const details = creationDetails();

    // Act & Assert
    expect(() =>
      createTestUser({
        userId: "booker",
        payoutAccount: PayoutAccount.create({
          payoutAccountId: "pa",
          userId: "booker",
          providerAccountReference: "provider",
        }),
      })
        .asBooker()
        .createSession(details),
    ).toThrow(expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }));
  });

  test("createSession_WhenShareWouldBeZero_ThrowsInvalidInput", () => {
    // Arrange
    const details = creationDetails();

    // Act & Assert
    expect(() =>
      readyBooker().createSession({ ...details, totalSlots: 1001 }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("createSession_WhenMinimumHeadcountIsOne_ThrowsInvalidInput", () => {
    // Arrange
    const details = creationDetails();

    // Act & Assert
    expect(() =>
      readyBooker().createSession({ ...details, minimumHeadcount: 1 }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  test("createSession_WhenBookingHasEnded_ThrowsSessionStarted", () => {
    // Arrange
    const details = { ...creationDetails(), now: end };

    // Act & Assert
    expect(() => readyBooker().createSession(details)).toThrow(
      expect.objectContaining({ code: "SESSION_STARTED" }),
    );
  });
});
