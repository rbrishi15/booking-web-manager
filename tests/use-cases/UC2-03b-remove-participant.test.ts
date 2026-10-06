import { describe, expect, test, vi } from "vitest";
import { FundHold, Money, Participation, Session, type User } from "@/domain";
import { ListSessionParticipants } from "@/use-cases/sessions/ListSessionParticipants";
import { PreviewParticipantRemoval } from "@/use-cases/sessions/PreviewParticipantRemoval";
import { RemoveParticipant } from "@/use-cases/sessions/RemoveParticipant";
import type { SessionParticipantRemovalResult, SessionRemovalReadTransaction, SessionRemovalRepositories, SessionRemovalTransaction } from "@/use-cases/sessions/session-removal-transaction";
import { ParticipantRemovalVersioner } from "@/lib/sessions/removal-versioner";
import { createTestUser } from "../domain/accounts/user-fixtures";
import { createTestSession, hoursBeforeSessionStart, readyBooker, sessionDetails, sessionStartsAt } from "../domain/sessions/session/session-fixtures";

describe("UC2-03b Remove Participant", () => {
  test("previews the historical hold without saving changes or moving funds", async () => {
    const scenario = removal(withHistoricalHold(733));
    expect(await scenario.preview.forBooker("booker", "s", "p-alice")).toEqual({
      sessionId: "s", participationId: "p-alice", refundCents: 733, previewVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(scenario.stored().participantList.requireParticipation("p-alice").status).toBe("COMMITTED");
    expect(scenario.save).not.toHaveBeenCalled();
    expect(scenario.append).not.toHaveBeenCalled();
  });

  test.each([48, 30, 5, 1 / 3600])("refunds the full historical hold %s hours before start", async (hours) => {
    const scenario = removal(withHistoricalHold(733));
    scenario.clock.now.mockReturnValue(hoursBeforeSessionStart(hours));
    expect(await scenario.submit()).toEqual({ sessionId: "s", participationId: "p-alice", status: "REMOVED", refundCents: 733 });
    expect(scenario.append.mock.calls[0]![0].map((instruction) => [instruction.kind, instruction.amount.toCents()])).toEqual([["REFUND", 733]]);
    expect(scenario.stored().participantList.requireParticipation("p-alice")).toMatchObject({ status: "REMOVED", hold: { state: "REFUNDED" } });
    expect(scenario.stored().status).toBe("OPEN");
    expect(scenario.stored().getAvailableSlots(scenario.clock.now())).toBe(2);
  });

  test("frees capacity without promoting, preserves FIFO priority and prevents rejoining", async () => {
    const scenario = removal(createTestSession({ committedUserIds: ["alice", "ben"], waitlistedUserIds: ["first", "second"] }));
    const original = scenario.stored().participantList.participations.slice(1);
    await scenario.submit();
    const stored = scenario.stored();
    expect(stored.getAvailableSlots(scenario.clock.now())).toBe(1);
    expect(stored.participantList.participations.slice(1)).toEqual(original);
    expect(stored.participantList.nextWaitlisted()?.userId).toBe("first");
    expect(stored.participantList.nextQueueSequence).toBe(3);
    const entrant = createTestUser({ userId: "newcomer" }).asParticipant();
    entrant.join(stored, { participationId: "p-new", holdId: "h-new", now: scenario.clock.now() });
    expect(stored.participantList.requireParticipation("p-new").status).toBe("WAITLISTED");
    expect(() => createTestUser({ userId: "alice" }).asParticipant().join(stored, {
      participationId: "new-alice", holdId: "new-alice-hold", now: scenario.clock.now(),
    })).toThrow(expect.objectContaining({ code: "REJOIN_NOT_ALLOWED" }));
  });

  test("removing an accepted replacement preserves the consumed invitation and earlier refund", async () => {
    const initial = createTestSession({ committedUserIds: ["alice", "ben"] });
    createTestUser({ userId: "alice" }).asParticipant().withdraw(initial, {
      participationId: "p-alice", replacementMode: "DIRECT_INVITE", replacementInviteeId: "cara", now: hoursBeforeSessionStart(5),
    });
    createTestUser({ userId: "cara" }).asParticipant().acceptReplacement(initial, {
      participationId: "p-cara", holdId: "h-cara", now: hoursBeforeSessionStart(4),
    });
    const withdrawn = initial.participantList.requireParticipation("p-alice");
    const scenario = removal(initial);
    await scenario.submit("p-cara");
    expect(scenario.stored().participantList.requireParticipation("p-alice")).toBe(withdrawn);
    expect(withdrawn.hold?.state).toBe("REFUNDED");
    expect(scenario.stored().participantList.requireParticipation("p-cara").replacesParticipationId).toBe("p-alice");
    expect(scenario.stored().getAvailableSlots(scenario.clock.now())).toBe(1);
    expect(() => createTestUser({ userId: "cara" }).asParticipant().acceptReplacement(scenario.stored(), {
      participationId: "new-cara", holdId: "new-cara-hold", now: scenario.clock.now(),
    })).toThrow();
  });

  test("preserves unrelated reserved places and cancellation never refunds a removed hold again", async () => {
    const initial = createTestSession({ committedUserIds: ["alice", "ben"] });
    createTestUser({ userId: "ben" }).asParticipant().withdraw(initial, {
      participationId: "p-ben", replacementMode: "DIRECT_INVITE", replacementInviteeId: "cara", now: hoursBeforeSessionStart(5),
    });
    const reserved = initial.participantList.requireParticipation("p-ben");
    const scenario = removal(initial);
    await scenario.submit();
    expect(scenario.stored().getAvailableSlots(scenario.clock.now())).toBe(1);
    expect(scenario.stored().participantList.requireParticipation("p-ben")).toBe(reserved);
    const removed = scenario.stored().participantList.requireParticipation("p-alice");
    const result = readyBooker().cancel(scenario.stored(), scenario.clock.now());
    expect(result.instructions.map((instruction) => instruction.participationId)).toEqual(["p-ben"]);
    expect(scenario.stored().participantList.requireParticipation("p-alice")).toBe(removed);
  });

  test("replays a successful request after start without loading or refunding again", async () => {
    const scenario = removal();
    const version = (await scenario.preview.forBooker("booker", "s", "p-alice")).previewVersion;
    const result = await scenario.remove.forBooker("booker", "s", "p-alice", version);
    scenario.getSession.mockClear();
    scenario.clock.now.mockReturnValue(sessionStartsAt);
    expect(await scenario.remove.forBooker("booker", "s", "p-alice", version)).toEqual(result);
    expect(scenario.getSession).not.toHaveBeenCalled();
    expect(scenario.append).toHaveBeenCalledOnce();
    expect(scenario.save).toHaveBeenCalledOnce();
  });

  test("rechecks active-account access before consulting a prior success", async () => {
    const scenario = removal();
    await scenario.submit();
    scenario.getUser.mockResolvedValue(createTestUser({ userId: "booker", accountStatus: "INACTIVE" }));
    await expect(scenario.remove.forBooker("booker", "s", "p-alice", "old")).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(scenario.once).toHaveBeenCalledOnce();
  });

  test("rejects a changed target preview without persisting or refunding", async () => {
    const scenario = removal();
    await expect(scenario.remove.forBooker("booker", "s", "p-alice", "old")).rejects.toMatchObject({ code: "STALE_REMOVAL_PREVIEW" });
    expect(scenario.save).not.toHaveBeenCalled();
    expect(scenario.append).not.toHaveBeenCalled();
    expect(scenario.stored().participantList.requireParticipation("p-alice").status).toBe("COMMITTED");
  });

  test("unrelated admission and visibility changes do not invalidate a target preview", async () => {
    const scenario = removal();
    const version = (await scenario.preview.forBooker("booker", "s", "p-alice")).previewVersion;
    createTestUser({ userId: "ben" }).asParticipant().join(scenario.stored(), {
      participationId: "p-ben", holdId: "h-ben", now: scenario.clock.now(),
    });
    const withVisibility = copy(scenario.stored(), { visibility: "PRIVATE" });
    scenario.replace(withVisibility);
    expect(await scenario.remove.forBooker("booker", "s", "p-alice", version)).toMatchObject({ status: "REMOVED" });
    expect(scenario.stored().participantList.requireParticipation("p-ben").status).toBe("COMMITTED");
  });

  test.each(["list", "preview", "remove"] as const)("%s rejects inactive accounts and foreign owners", async (entry) => {
    const scenario = removal();
    scenario.getUser.mockResolvedValue(createTestUser({ userId: "other" }));
    await expect(scenario.invoke(entry)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    scenario.getUser.mockResolvedValue(createTestUser({ userId: "booker", accountStatus: "INACTIVE" }));
    await expect(scenario.invoke(entry)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(scenario.names).not.toHaveBeenCalled();
    expect(scenario.save).not.toHaveBeenCalled();
  });

  test.each(["user", "session", "participation"] as const)("rejects missing %s records", async (record) => {
    const scenario = removal();
    if (record === "user") scenario.getUser.mockResolvedValue(null);
    else if (record === "session") scenario.getSession.mockResolvedValue(null);
    await expect(scenario.remove.forBooker("booker", "s", record === "participation" ? "missing" : "p-alice", "version"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(scenario.save).not.toHaveBeenCalled();
    expect(scenario.append).not.toHaveBeenCalled();
  });

  test.each(["WAITLISTED", "LEFT_WAITLIST", "WITHDRAWN", "REMOVED"] as const)("rejects a %s target without writes", async (status) => {
    const initial = createTestSession({ committedUserIds: ["alice"], waitlistedUserIds: ["waiting"] });
    const target = status === "WAITLISTED" || status === "LEFT_WAITLIST" ? "p-waiting" : "p-alice";
    if (status === "LEFT_WAITLIST") createTestUser({ userId: "waiting" }).asParticipant().leaveWaitlist(initial, { participationId: target, now: hoursBeforeSessionStart(5) });
    if (status === "WITHDRAWN") createTestUser({ userId: "alice" }).asParticipant().withdraw(initial, { participationId: target, replacementMode: "OPEN_SLOT", now: hoursBeforeSessionStart(5) });
    if (status === "REMOVED") readyBooker().removeParticipant(initial, target, hoursBeforeSessionStart(5));
    const scenario = removal(initial);
    await expect(scenario.remove.forBooker("booker", "s", target, "version")).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(scenario.save).not.toHaveBeenCalled();
    expect(scenario.append).not.toHaveBeenCalled();
  });

  test("rejects cancellation and exact-start races after the session lock", async () => {
    const scenario = removal();
    const version = (await scenario.preview.forBooker("booker", "s", "p-alice")).previewVersion;
    scenario.getSession.mockImplementation(async () => { scenario.clock.now.mockReturnValue(sessionStartsAt); return copy(scenario.stored()); });
    await expect(scenario.remove.forBooker("booker", "s", "p-alice", version)).rejects.toMatchObject({ code: "SESSION_STARTED" });
    scenario.clock.now.mockReturnValue(hoursBeforeSessionStart(5));
    readyBooker().cancel(scenario.stored(), scenario.clock.now());
    await expect(scenario.remove.forBooker("booker", "s", "p-alice", version)).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    expect(scenario.save).not.toHaveBeenCalled();
    expect(scenario.append).not.toHaveBeenCalled();
  });

  test.each(["append", "save", "commit"] as const)("rolls back and preserves %s failure identity", async (stage) => {
    const scenario = removal();
    const failure = new Error("Infrastructure failed");
    if (stage === "commit") scenario.failCommit(failure);
    else scenario[stage].mockRejectedValue(failure);
    await expect(scenario.submit()).rejects.toBe(failure);
    expect(scenario.stored().participantList.requireParticipation("p-alice").status).toBe("COMMITTED");
    expect(scenario.cached()).toBeUndefined();
  });
});

describe("Session participant list", () => {
  test("shows names, statuses and historical rows in participant-list order without private identities", async () => {
    const initial = createTestSession({ committedUserIds: ["alice", "ben"], waitlistedUserIds: ["waiting"] });
    readyBooker().removeParticipant(initial, "p-ben", hoursBeforeSessionStart(48));
    const scenario = removal(initial);
    expect(await scenario.list.forBooker("booker", "s")).toEqual({
      sessionId: "s", venueName: "Court", sport: "Badminton", startAt: initial.booking.startAt, endAt: initial.booking.endAt,
      status: "OPEN", availableSlots: 1, participants: [
        { participationId: "p-alice", displayName: "Alice", status: "COMMITTED", canRemove: true },
        { participationId: "p-ben", displayName: "Deleted user", status: "REMOVED", canRemove: false },
        { participationId: "p-waiting", displayName: "Unnamed player", status: "WAITLISTED", canRemove: false },
      ],
    });
  });
  test("keeps history visible after start and cancellation while disabling removal", async () => {
    const scenario = removal();
    scenario.clock.now.mockReturnValue(sessionStartsAt);
    expect((await scenario.list.forBooker("booker", "s")).participants[0]?.canRemove).toBe(false);
    readyBooker().cancel(scenario.stored(), hoursBeforeSessionStart(5));
    expect((await scenario.list.forBooker("booker", "s")).participants[0]).toMatchObject({ status: "CANCELLED", canRemove: false });
  });
});

function withHistoricalHold(cents: number): Session {
  return new Session(sessionDetails({ participations: [Participation.createCommitted({
    participationId: "p-alice", userId: "alice", committedAt: hoursBeforeSessionStart(48),
    hold: FundHold.create({ holdId: "h-alice", participationId: "p-alice", holdingAccountId: "platform", walletId: "w-alice",
      amount: Money.fromCents(cents), createdAt: hoursBeforeSessionStart(48) }),
  })] }));
}
function copy(session: Session, override: { visibility?: "PRIVATE" | "PUBLIC" } = {}): Session {
  return new Session(sessionDetails({ status: session.status, visibility: session.visibility,
    totalSlots: session.totalSlots, participations: session.participantList.participations,
    nextQueueSequence: session.participantList.nextQueueSequence, ...override }));
}
function removal(initial = createTestSession({ committedUserIds: ["alice"] })) {
  let persisted = initial;
  let response: SessionParticipantRemovalResult | undefined;
  let commitFailure: Error | undefined;
  const clock = { now: vi.fn(() => hoursBeforeSessionStart(3)) };
  const versioner = new ParticipantRemovalVersioner();
  const getUser = vi.fn<(id: string) => Promise<User | null>>().mockResolvedValue(createTestUser({ userId: "booker" }));
  const getSession = vi.fn(async (id: string): Promise<Session | null> => id === "s" ? copy(persisted) : null);
  const names = vi.fn(async () => new Map([["alice", "Alice"], ["ben", "Deleted user"]]));
  const save = vi.fn<SessionRemovalRepositories["sessions"]["saveRemoval"]>().mockResolvedValue(undefined);
  const append = vi.fn<SessionRemovalRepositories["ledger"]["append"]>().mockResolvedValue(undefined);
  const once = vi.fn<SessionRemovalRepositories["submission"]["once"]>();
  const transaction: SessionRemovalTransaction = { run: async (work) => {
    let candidate: Session | undefined;
    let candidateResult: SessionParticipantRemovalResult | undefined;
    once.mockImplementation(async (_actor, _session, _participation, _version, perform) => {
      if (response) return response;
      candidateResult = await perform(); return candidateResult;
    });
    const result = await work({ users: { get: getUser }, sessions: { get: getSession,
      saveRemoval: async (session, id) => { await save(session, id); candidate = session; } },
      ledger: { append }, submission: { once } });
    if (commitFailure) throw commitFailure;
    if (candidate) persisted = candidate;
    if (candidateResult) response = candidateResult;
    return result;
  } };
  const readTransaction: SessionRemovalReadTransaction = { run: (work) => work({
    users: { get: getUser }, sessions: { get: getSession }, participants: { displayNames: names },
  }) };
  const list = new ListSessionParticipants({ transaction: readTransaction, clock });
  const preview = new PreviewParticipantRemoval({ transaction: readTransaction, clock, versioner });
  const remove = new RemoveParticipant({ transaction, clock, versioner });
  return { list, preview, remove, clock, getUser, getSession, names, save, append, once,
    stored: () => persisted, replace: (session: Session) => { persisted = session; },
    cached: () => response, failCommit: (error: Error) => { commitFailure = error; },
    submit: async (participationId = "p-alice") => remove.forBooker("booker", "s", participationId,
      (await preview.forBooker("booker", "s", participationId)).previewVersion),
    invoke: (entry: "list" | "preview" | "remove") => entry === "list" ? list.forBooker("booker", "s")
      : entry === "preview" ? preview.forBooker("booker", "s", "p-alice") : remove.forBooker("booker", "s", "p-alice", "version"),
  };
}
