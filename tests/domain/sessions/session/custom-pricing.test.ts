import { describe, expect, test } from "vitest";
import { Money } from "@/domain";
import { creationDetails, createTestUser, hoursBeforeSessionStart, readyBooker, sessionEndsAt } from "./session-fixtures";

describe("Session custom pricing", () => {
  test("join_WhenPriceExceedsEqualSplit_LocksChosenPrice", () => {
    // Arrange
    const session = readyBooker().createSession({ ...creationDetails(), bookingShare: Money.fromCents(750) });
    const participant = createTestUser({ userId: "alice", availableFundsCents: 750 }).asParticipant();
    // Act
    const result = participant.join(session, { participationId: "p", holdId: "h", now: hoursBeforeSessionStart(48) });
    // Assert
    expect(result.instructions[0]?.amount.toCents()).toBe(750);
    expect(session.participantList.requireParticipation("p").hold?.amount.toCents()).toBe(750);
    expect(session.bookingShare.toCents()).toBe(750);
  });
  test("withdraw_WhenCustomPriceIsRefundable_RefundsChosenPrice", () => {
    // Arrange
    const session = readyBooker().createSession({ ...creationDetails(), bookingShare: Money.fromCents(750) });
    const participant = createTestUser({ userId: "alice", availableFundsCents: 750 }).asParticipant();
    participant.join(session, { participationId: "p", holdId: "h", now: hoursBeforeSessionStart(48) });
    // Act
    const result = participant.withdraw(session, { participationId: "p", now: hoursBeforeSessionStart(31) });
    // Assert
    expect(result.instructions[0]?.amount.toCents()).toBe(750);
    expect(session.participantList.requireParticipation("p").hold?.state).toBe("REFUNDED");
  });
  test("cancel_WhenCustomPriceWasCollected_RefundsTheFullHold", () => {
    // Arrange
    const booker = readyBooker();
    const session = booker.createSession({ ...creationDetails(), bookingShare: Money.fromCents(750) });
    createTestUser({ userId: "alice", availableFundsCents: 750 }).asParticipant().join(session, { participationId: "p", holdId: "h", now: hoursBeforeSessionStart(48) });
    // Act
    const result = booker.cancel(session, hoursBeforeSessionStart(30));
    // Assert
    expect(result.instructions[0]?.amount.toCents()).toBe(750);
    expect(session.bookingShare.toCents()).toBe(750);
  });
  test("preparePayout_WhenCustomPriceAttendanceIsVerified_ReleasesTheChosenAmount", () => {
    // Arrange
    const booker = readyBooker();
    const session = booker.createSession({ ...creationDetails(), bookingShare: Money.fromCents(750) });
    createTestUser({ userId: "alice", availableFundsCents: 750 }).asParticipant().join(session, { participationId: "p", holdId: "h", now: hoursBeforeSessionStart(48) });
    booker.verifyAttendance(session, { now: sessionEndsAt, marks: [{ participationId: "p", attendance: "ATTENDED" }] });
    // Act
    const batch = booker.preparePayout(session, { payoutId: "out", idempotencyKey: "key", now: sessionEndsAt });
    const result = session.completeSettlement("out", sessionEndsAt);
    // Assert
    expect(batch?.lines[0]?.amount.toCents()).toBe(750);
    expect(result.instructions[0]?.amount.toCents()).toBe(750);
    expect(session.participantList.requireParticipation("p").hold?.state).toBe("RELEASED");
  });
});
