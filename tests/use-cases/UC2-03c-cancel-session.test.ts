import { describe, expect, test, vi } from "vitest";
import { Session, type User } from "@/domain";
import { CancelSession } from "@/use-cases/sessions/CancelSession";
import { PreviewSessionCancellation } from "@/use-cases/sessions/PreviewSessionCancellation";
import type { SessionCancellationRepositories, SessionCancellationResult, SessionCancellationTransaction } from "@/use-cases/sessions/session-cancellation-transaction";
import type { SessionManagementTransaction } from "@/use-cases/sessions/session-management-transaction";
import { SessionCancellationVersioner } from "@/lib/sessions/cancellation-versioner";
import { createTestUser } from "../domain/accounts/user-fixtures";
import { createTestSession, hoursBeforeSessionStart, readyBooker, sessionDetails, sessionStartsAt } from "../domain/sessions/session/session-fixtures";

describe("UC2-03c Cancel Session", () => {
  test("previews actual refunds without changing persisted state or moving funds", async () => {
    const scenario = cancellation(createTestSession({ committedUserIds: ["alice", "ben"], waitlistedUserIds: ["waiting"] }));
    const preview = await scenario.preview.forBooker("booker", "s");
    expect(preview).toMatchObject({ sessionId: "s", affectedParticipantCount: 3, refundRecipientCount: 2, totalRefundCents: 1000 });
    expect(preview.previewVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(scenario.stored().status).toBe("OPEN");
    expect(scenario.save).not.toHaveBeenCalled();
    expect(scenario.append).not.toHaveBeenCalled();
  });
  test("soft-cancels and refunds all committed participants atomically, including full sessions", async () => {
    const scenario = cancellation(createTestSession({ committedUserIds: ["alice", "ben"] }));
    expect(await scenario.submit()).toEqual({ sessionId: "s", status: "CANCELLED", refundRecipientCount: 2, totalRefundCents: 1000 });
    expect(scenario.stored().status).toBe("CANCELLED");
    expect(scenario.append.mock.calls[0]![0].map((i) => [i.kind, i.amount.toCents()])).toEqual([["REFUND", 500], ["REFUND", 500]]);
    expect(scenario.stored().participantList.participations.map((p) => [p.status, p.hold?.state])).toEqual([["CANCELLED", "REFUNDED"], ["CANCELLED", "REFUNDED"]]);
  });
  test("cancels an empty session without payout setup or ledger entries", async () => {
    const scenario = cancellation();
    expect(await scenario.submit()).toMatchObject({ refundRecipientCount: 0, totalRefundCents: 0 });
    expect(scenario.append).toHaveBeenCalledWith([]);
  });
  test("refunds awaiting-replacement holds and clears invitations while retaining withdrawal history", async () => {
    const session = createTestSession({ committedUserIds: ["alice", "ben"] });
    const withdrawalTime = hoursBeforeSessionStart(10);
    createTestUser({ userId: "alice" }).asParticipant().withdraw(session, {
      participationId: "p-alice", replacementMode: "DIRECT_INVITE", replacementInviteeId: "cara", now: withdrawalTime,
    });
    const scenario = cancellation(session);
    expect(await scenario.submit()).toMatchObject({ totalRefundCents: 1000 });
    const cancelled = scenario.stored().participantList.requireParticipation("p-alice");
    expect(cancelled.withdrawnAt).toEqual(withdrawalTime);
    expect(cancelled.replacementInviteeId).toBeUndefined();
    expect(cancelled.hold?.state).toBe("REFUNDED");
  });
  test("preserves removed and refunded history without double refunds", async () => {
    const session = createTestSession({ committedUserIds: ["alice", "ben"] });
    readyBooker().removeParticipant(session, "p-alice", hoursBeforeSessionStart(48));
    const removed = session.participantList.requireParticipation("p-alice");
    const scenario = cancellation(session);
    expect(await scenario.submit()).toMatchObject({ refundRecipientCount: 1, totalRefundCents: 500 });
    expect(scenario.stored().participantList.requireParticipation("p-alice")).toBe(removed);
  });
  test("same submission replays after cancellation and after start without another write", async () => {
    const scenario = cancellation(createTestSession({ committedUserIds: ["alice"] }));
    const version = (await scenario.preview.forBooker("booker", "s")).previewVersion;
    const first = await scenario.cancel.forBooker("booker", "s", version);
    scenario.clock.now.mockReturnValue(sessionStartsAt);
    expect(await scenario.cancel.forBooker("booker", "s", version)).toEqual(first);
    expect(scenario.save).toHaveBeenCalledOnce();
    expect(scenario.append).toHaveBeenCalledOnce();
  });
  test("checks inactive access before replay after an earlier success", async () => {
    const scenario = cancellation();
    const version = (await scenario.preview.forBooker("booker", "s")).previewVersion;
    await scenario.cancel.forBooker("booker", "s", version);
    scenario.getUser.mockResolvedValue(createTestUser({ userId: "booker", accountStatus: "INACTIVE" }));
    await expect(scenario.cancel.forBooker("booker", "s", version)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(scenario.once).toHaveBeenCalledOnce();
  });
  test("rejects changed previews without saving or issuing refunds", async () => {
    const scenario = cancellation();
    await expect(scenario.cancel.forBooker("booker", "s", "stale")).rejects.toMatchObject({ code: "STALE_CANCELLATION_PREVIEW" });
    expect(scenario.save).not.toHaveBeenCalled();
    expect(scenario.append).not.toHaveBeenCalled();
    expect(scenario.stored().status).toBe("OPEN");
  });
  test("visibility changes do not invalidate confirmation", async () => {
    const scenario = cancellation();
    const version = (await scenario.preview.forBooker("booker", "s")).previewVersion;
    readyBooker().changeVisibility(scenario.stored(), "PRIVATE", hoursBeforeSessionStart(48));
    expect(await scenario.cancel.forBooker("booker", "s", version)).toMatchObject({ status: "CANCELLED" });
  });
  test.each(["preview", "cancel"] as const)("%s rejects foreign owners", async (entry) => {
    const scenario = cancellation();
    scenario.getUser.mockResolvedValue(createTestUser({ userId: "other" }));
    await expect(entry === "preview" ? scenario.preview.forBooker("other", "s") : scenario.cancel.forBooker("other", "s", "version")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  test.each(["user", "session"] as const)("rejects missing %s records", async (record) => {
    const scenario = cancellation();
    if (record === "user") scenario.getUser.mockResolvedValue(null);
    else scenario.getSession.mockResolvedValue(null);
    await expect(scenario.cancel.forBooker("booker", "s", "version")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  test.each(["CANCELLED", "SETTLED"] as const)("rejects %s sessions with a fresh submission", async (status) => {
    const scenario = cancellation(new Session(sessionDetails({ status })));
    await expect(scenario.cancel.forBooker("booker", "s", "version")).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });
  test("captures time after loading and rejects the exact start instant", async () => {
    const scenario = cancellation();
    scenario.getSession.mockImplementation(async () => { scenario.clock.now.mockReturnValue(sessionStartsAt); return copy(scenario.stored()); });
    await expect(scenario.cancel.forBooker("booker", "s", "version")).rejects.toMatchObject({ code: "SESSION_STARTED" });
    expect(scenario.save).not.toHaveBeenCalled();
  });
  test.each(["append", "save", "commit"] as const)("rolls back and preserves %s failure identity", async (stage) => {
    const scenario = cancellation(createTestSession({ committedUserIds: ["alice"] }));
    const failure = new Error("Infrastructure failed");
    if (stage === "commit") scenario.failCommit(failure);
    else scenario[stage].mockRejectedValue(failure);
    await expect(scenario.submit()).rejects.toBe(failure);
    expect(scenario.stored().status).toBe("OPEN");
    expect(scenario.cached()).toBeUndefined();
  });
});

function copy(session: Session): Session {
  return new Session(sessionDetails({ status: session.status, visibility: session.visibility,
    participations: session.participantList.participations, nextQueueSequence: session.participantList.nextQueueSequence }));
}
function cancellation(initial = createTestSession()) {
  let persisted = initial;
  let response: SessionCancellationResult | undefined;
  let commitFailure: Error | undefined;
  const clock = { now: vi.fn(() => hoursBeforeSessionStart(5)) };
  const versioner = new SessionCancellationVersioner();
  const getUser = vi.fn<(id: string) => Promise<User | null>>().mockResolvedValue(createTestUser({ userId: "booker" }));
  const getSession = vi.fn(async (id: string): Promise<Session | null> => id === "s" ? copy(persisted) : null);
  const save = vi.fn<SessionCancellationRepositories["sessions"]["saveCancellation"]>().mockResolvedValue(undefined);
  const append = vi.fn<SessionCancellationRepositories["ledger"]["append"]>().mockResolvedValue(undefined);
  const once = vi.fn<SessionCancellationRepositories["submission"]["once"]>();
  const transaction: SessionCancellationTransaction = { run: async (work) => {
    let candidate: Session | undefined;
    let candidateResult: SessionCancellationResult | undefined;
    once.mockImplementation(async (_actor, _session, _version, perform) => {
      if (response) return response;
      candidateResult = await perform(); return candidateResult;
    });
    const result = await work({ users: { get: getUser }, sessions: { get: getSession,
      saveCancellation: async (session) => { await save(session); candidate = session; } },
      ledger: { append }, submission: { once } });
    if (commitFailure) throw commitFailure;
    if (candidate) persisted = candidate;
    if (candidateResult) response = candidateResult;
    return result;
  } };
  const previewTransaction: SessionManagementTransaction = { run: (work) => work({
    users: { get: getUser }, sessions: { get: getSession, listUpcoming: async () => [], saveVisibility: async () => { throw new Error("Preview must not save"); } },
  }) };
  const preview = new PreviewSessionCancellation({ transaction: previewTransaction, clock, versioner });
  const cancel = new CancelSession({ transaction, clock, versioner });
  return { preview, cancel, clock, getUser, getSession, save, append, once,
    stored: () => persisted, cached: () => response, failCommit: (error: Error) => { commitFailure = error; },
    submit: async () => cancel.forBooker("booker", "s", (await preview.forBooker("booker", "s")).previewVersion),
  };
}
