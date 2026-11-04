import { describe, expect, test } from "vitest";
import { Money, Session } from "@/domain";
import { EditSession } from "@/use-cases/sessions/EditSession";
import type { SessionEditingTransaction } from "@/use-cases/sessions/session-editing-transaction";
import { createTestUser } from "../domain/accounts/user-fixtures";
import { createTestSession, hoursBeforeSessionStart, sessionStartsAt, sessionDetails } from "../domain/sessions/session/session-fixtures";

function scenario(session = createTestSession()) {
  let stored = session;
  let active = true;
  let now = hoursBeforeSessionStart(48);
  let writes = 0;
  const transaction: SessionEditingTransaction = { run: async (work) => work({
    users: { get: async (id) => createTestUser({ userId: id, accountStatus: active ? "ACTIVE" : "INACTIVE" }) },
    sessions: { get: async () => stored, saveDetails: async (next) => { stored = next; writes++; } },
  }) };
  const editor = new EditSession({ transaction, clock: { now: () => now } });
  return { editor, get stored() { return stored; }, get writes() { return writes; },
    deactivate: () => { active = false; }, start: () => { now = sessionStartsAt; },
    replace: (next: Session) => { stored = next; },
    request: async () => { const { version, booking, totalSlots, visibility } = await editor.detailsForBooker("booker", "s"); return { version, booking, totalSlots, visibility }; },
  };
}

describe("session editing", () => {
  test("saves new booking details without mutating the original aggregate", async () => {
    const s = scenario();
    const original = s.stored;
    const request = await s.request();
    const saved = await s.editor.forBooker("booker", "s", { ...request, totalSlots: 4, visibility: "PRIVATE",
      booking: { venueName: "New court", region: "East", sport: "Tennis", startAt: "2026-10-11T01:00:00.000Z", endAt: "2026-10-11T03:00:00.000Z", totalCostCents: 2400, pricePerSlotCents: 600 } });
    expect(saved).toMatchObject({ totalSlots: 4, visibility: "PRIVATE", booking: { venueName: "New court", pricePerSlotCents: 600 }, bookingLocked: false });
    expect(s.stored.booking.startAt.toISOString()).toBe("2026-10-11T01:00:00.000Z");
    expect(original.booking.venueName).toBe("Court");
    expect(s.writes).toBe(1);
  });

  test.each(["read", "save"])("rejects a foreign owner on %s", async (operation) => {
    const s = scenario();
    const request = await s.request();
    await expect(operation === "read" ? s.editor.detailsForBooker("other", "s") : s.editor.forBooker("other", "s", request)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(s.writes).toBe(0);
  });

  test("rejects an account deactivated after loading", async () => {
    const s = scenario(); const request = await s.request(); s.deactivate();
    await expect(s.editor.forBooker("booker", "s", request)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
  });

  test("rejects saving at the start boundary", async () => {
    const s = scenario(); const request = await s.request(); s.start();
    await expect(s.editor.forBooker("booker", "s", request)).rejects.toMatchObject({ code: "SESSION_STARTED" });
    expect(s.writes).toBe(0);
  });

  test.each(["CANCELLED", "SETTLED"] as const)("marks %s read-only and rejects writes", async (status) => {
    const s = scenario(new Session(sessionDetails({ status })));
    expect(await s.editor.detailsForBooker("booker", "s")).toMatchObject({ canEdit: false });
    await expect(s.editor.forBooker("booker", "s", await s.request())).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });

  test.each(["venueName", "sport", "region", "startAt", "endAt", "totalCostCents", "pricePerSlotCents"] as const)("locks %s after another player joins", async (field) => {
    const s = scenario(createTestSession({ committedUserIds: ["alice"] }));
    const request = await s.request();
    const values = { venueName: "Changed", sport: "Tennis", region: "East", startAt: "2026-10-10T11:00:00.000Z", endAt: "2026-10-10T13:00:00.000Z", totalCostCents: 2000, pricePerSlotCents: 700 };
    await expect(s.editor.forBooker("booker", "s", { ...request, booking: { ...request.booking, [field]: values[field] } })).rejects.toMatchObject({ code: "SESSION_DETAILS_LOCKED" });
    expect(s.writes).toBe(0);
  });

  test("locks terms even after a joined player withdraws", async () => {
    const session = createTestSession({ committedUserIds: ["alice"] });
    createTestUser({ userId: "alice" }).asParticipant().withdraw(session, { participationId: "p-alice", replacementMode: "OPEN_SLOT", now: hoursBeforeSessionStart(40) });
    const s = scenario(session);
    expect((await s.editor.detailsForBooker("booker", "s")).bookingLocked).toBe(true);
  });

  test("increases full capacity without changing prices, holds or waitlist order", async () => {
    const session = createTestSession({ committedUserIds: ["alice", "bob"], waitlistedUserIds: ["carol"] });
    const participants = session.participantList.participations;
    const s = scenario(session);
    const saved = await s.editor.forBooker("booker", "s", { ...await s.request(), totalSlots: 5 });
    expect(saved).toMatchObject({ totalSlots: 5, minimumSlots: 3, bookingLocked: true, booking: { pricePerSlotCents: 500 } });
    expect(s.stored.getAvailableSlots(hoursBeforeSessionStart(48))).toBe(2);
    expect(s.stored.participantList.participations).toEqual(participants);
  });

  test("capacity cannot displace a personal replacement reservation", async () => {
    const session = createTestSession({ committedUserIds: ["alice", "bob"] });
    createTestUser({ userId: "alice" }).asParticipant().withdraw(session, { participationId: "p-alice", replacementMode: "DIRECT_INVITE", replacementInviteeId: "carol", now: hoursBeforeSessionStart(10) });
    const s = scenario(session);
    await expect(s.editor.forBooker("booker", "s", { ...await s.request(), totalSlots: 2 })).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
    expect(s.stored.totalSlots).toBe(3);
  });

  test("cannot change visibility while the resulting capacity is full", async () => {
    const s = scenario(createTestSession({ committedUserIds: ["alice", "bob"] }));
    await expect(s.editor.forBooker("booker", "s", { ...await s.request(), visibility: "PRIVATE" })).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
    expect(s.writes).toBe(0);
  });

  test("rejects stale details after another editor saves", async () => {
    const s = scenario(); const old = await s.request();
    await s.editor.forBooker("booker", "s", { ...old, totalSlots: 4 });
    await expect(s.editor.forBooker("booker", "s", { ...old, totalSlots: 5 })).rejects.toMatchObject({ code: "STALE_SESSION" });
    expect(s.stored.totalSlots).toBe(4);
  });

  test("rejects stale details when a player joins while the dialog is open", async () => {
    const s = scenario(); const old = await s.request();
    s.replace(createTestSession({ committedUserIds: ["alice"] }));
    await expect(s.editor.forBooker("booker", "s", old)).rejects.toMatchObject({ code: "STALE_SESSION" });
    expect(s.writes).toBe(0);
  });

  test.each([0, 31, 1.5])("rejects invalid capacity %s without saving", async (totalSlots) => {
    const s = scenario();
    await expect(s.editor.forBooker("booker", "s", { ...await s.request(), totalSlots })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(s.writes).toBe(0);
  });

  test("validates changed prices using creation bounds", async () => {
    const s = scenario(); const request = await s.request();
    await expect(s.editor.forBooker("booker", "s", { ...request, booking: { ...request.booking, pricePerSlotCents: 1000 } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(s.stored.bookingShare).toEqual(Money.fromCents(500));
  });

  test("rejects an end before start as a safe input failure", async () => {
    const s = scenario(); const request = await s.request();
    await expect(s.editor.forBooker("booker", "s", { ...request, booking: { ...request.booking, endAt: request.booking.startAt } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
