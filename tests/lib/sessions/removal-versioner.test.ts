import { expect, test } from "vitest";
import { Booking, FundHold, Money, Participation, Session } from "@/domain";
import { ParticipantRemovalVersioner } from "@/lib/sessions/removal-versioner";
import { createTestSession, hoursBeforeSessionStart, sessionDetails } from "../../domain/sessions/session/session-fixtures";

test("binds confirmation to the target's actual historical hold and identity", () => {
  const versioner = new ParticipantRemovalVersioner();
  const initial = createTestSession({ committedUserIds: ["alice"] });
  const version = versioner.of(initial, "p-alice");
  for (const change of [{ amount: Money.fromCents(733) }, { walletId: "other-wallet" }, { holdId: "other-hold" }]) {
    const target = Participation.createCommitted({
      participationId: "p-alice", userId: "alice", committedAt: hoursBeforeSessionStart(48),
      hold: FundHold.create({ holdId: "h-alice", participationId: "p-alice", walletId: "w-alice", holdingAccountId: "platform",
        amount: Money.fromCents(500), createdAt: hoursBeforeSessionStart(48), ...change }),
    });
    expect(versioner.of(new Session(sessionDetails({ participations: [target] })), "p-alice")).not.toBe(version);
  }
});

test("binds confirmation to owning host and session start", () => {
  const versioner = new ParticipantRemovalVersioner();
  const initial = createTestSession({ committedUserIds: ["alice"] });
  const version = versioner.of(initial, "p-alice");
  const participations = initial.participantList.participations;
  const laterBooking = new Booking({ venueName: initial.booking.venueName, sport: initial.booking.sport,
    region: initial.booking.region, startAt: new Date(initial.booking.startAt.getTime() + 1000),
    endAt: initial.booking.endAt, totalCost: initial.booking.totalCost });
  expect(versioner.of(new Session(sessionDetails({ participations, bookerId: "other" })), "p-alice")).not.toBe(version);
  expect(versioner.of(new Session(sessionDetails({ participations, booking: laterBooking })), "p-alice")).not.toBe(version);
});
