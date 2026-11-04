import { describe, expect, test, vi } from "vitest";
import { Session, type User } from "@/domain";
import {
  ManageSessionInvitations, type SessionInvitationRepositories, type SessionInvitationTransaction,
} from "@/use-cases/sessions/ManageSessionInvitations";
import { createTestUser } from "../domain/accounts/user-fixtures";
import { createTestSession, hoursBeforeSessionStart, sessionDetails, sessionStartsAt } from "../domain/sessions/session/session-fixtures";

function setup(session: Session = createTestSession()) {
  const getUser = vi.fn<(userId: string) => Promise<User | null>>().mockResolvedValue(createTestUser({ userId: "booker" }));
  const getSession = vi.fn().mockResolvedValue(session);
  const byHandles = vi.fn<SessionInvitationRepositories["recipients"]["byHandles"]>().mockResolvedValue([
    { userId: "alice", handle: "alice_01", displayName: "Alice" },
    { userId: "bob", handle: "bob_02", displayName: "Bob" },
  ]);
  const fromGroup = vi.fn<SessionInvitationRepositories["recipients"]["fromGroup"]>().mockResolvedValue([
    { userId: "alice", handle: "alice_01", displayName: "Alice" },
  ]);
  const add = vi.fn<SessionInvitationRepositories["invitations"]["add"]>()
    .mockImplementation(async (_sessionId, _hostId, players) => players.map((player) => player.userId));
  const list = vi.fn<SessionInvitationRepositories["invitations"]["list"]>().mockResolvedValue([]);
  const listGroups = vi.fn().mockResolvedValue([]);
  const append = vi.fn<SessionInvitationRepositories["notifications"]["append"]>().mockResolvedValue(undefined);
  const repositories: SessionInvitationRepositories = {
    users: { get: getUser },
    sessions: { get: getSession },
    recipients: { byHandles, fromGroup, listGroups },
    invitations: { add, list },
    notifications: { append },
  };
  const transaction: SessionInvitationTransaction = { run: (work) => work(repositories) };
  const run = vi.spyOn(transaction, "run");
  const clock = { now: vi.fn(() => hoursBeforeSessionStart(48)) };
  return {
    session, getUser, getSession, byHandles, fromGroup, add, list, listGroups, append, repositories, clock, run,
    useCase: new ManageSessionInvitations({ transaction, clock }),
  };
}

describe("UC2-03d: booker sends session invitations", () => {
  test("loads importable groups and invitation history only for the active session owner", async () => {
    const s = setup();
    const group = { groupId: "group", name: "Tennis Buddies", memberCount: 2, members: [{ userId: "alice", handle: "alice_01", displayName: "Alice" }] };
    s.listGroups.mockResolvedValue([group]);
    expect(await s.useCase.optionsForBooker("booker", "s")).toEqual({ groups: [group], invitations: [] });
    s.getUser.mockResolvedValue(createTestUser({ userId: "other" }));
    await expect(s.useCase.optionsForBooker("other", "s")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(s.listGroups).toHaveBeenCalledExactlyOnceWith("booker");
  });

  test("sends real recipient-specific inbox notifications in the transaction without changing roster or funds", async () => {
    const s = setup();
    const before = s.session.participantList.participations.length;
    expect(await s.useCase.inviteByHandles("booker", "s", ["@Alice_01", "bob_02"]))
      .toEqual({ invited: 2, alreadyInvited: 0, alreadyParticipating: 0 });
    expect(s.byHandles).toHaveBeenCalledWith(["alice_01", "bob_02"]);
    expect(s.add).toHaveBeenCalledWith("s", "booker", [
      { userId: "alice", handle: "alice_01", displayName: "Alice" },
      { userId: "bob", handle: "bob_02", displayName: "Bob" },
    ], undefined);
    expect(s.append).toHaveBeenCalledOnce();
    expect(s.append.mock.calls[0]?.[0]).toMatchObject([
      { kind: "SESSION_INVITATION", recipientId: "alice", sessionId: "s", invitationToken: "room" },
      { kind: "SESSION_INVITATION", recipientId: "bob", sessionId: "s", invitationToken: "room" },
    ]);
    expect(s.session.participantList.participations.length).toBe(before);
    expect(s.run).toHaveBeenCalledOnce();
  });

  test("respects existing participations and unique pending invitations", async () => {
    const s = setup(createTestSession({ committedUserIds: ["alice"] }));
    s.add.mockResolvedValue([]);
    expect(await s.useCase.inviteByHandles("booker", "s", ["alice_01", "bob_02"]))
      .toEqual({ invited: 0, alreadyInvited: 1, alreadyParticipating: 1 });
    expect(s.add.mock.calls[0]?.[2]).toEqual([{ userId: "bob", handle: "bob_02", displayName: "Bob" }]);
    expect(s.append).toHaveBeenCalledWith([]);
  });

  test("bulk invites only members verified against an active group inside transaction", async () => {
    const s = setup();
    expect(await s.useCase.inviteFromGroup("booker", "s", "group", ["alice"]))
      .toEqual({ invited: 1, alreadyInvited: 0, alreadyParticipating: 0 });
    expect(s.fromGroup).toHaveBeenCalledWith("booker", "group", ["alice"]);
    expect(s.add).toHaveBeenCalledWith("s", "booker", [
      { userId: "alice", handle: "alice_01", displayName: "Alice" },
    ], "group");
  });

  test("rejects stale group members and does not emit notifications", async () => {
    const s = setup();
    s.fromGroup.mockResolvedValue([]);
    await expect(s.useCase.inviteFromGroup("booker", "s", "group", ["alice"]))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(s.add).not.toHaveBeenCalled();
    expect(s.append).not.toHaveBeenCalled();
  });

  test("rejects an inactive host before reading the session or its private data", async () => {
    const s = setup();
    s.getUser.mockResolvedValue(createTestUser({ userId: "booker", accountStatus: "INACTIVE" }));
    await expect(s.useCase.inviteByHandles("booker", "s", ["alice_01"]))
      .rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(s.getSession).not.toHaveBeenCalled();
    expect(s.byHandles).not.toHaveBeenCalled();
  });

  test("rejects a host from a different session and leaves invitations untouched", async () => {
    const s = setup();
    s.getUser.mockResolvedValue(createTestUser({ userId: "other" }));
    await expect(s.useCase.inviteByHandles("other", "s", ["alice_01"]))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(s.add).not.toHaveBeenCalled();
  });

  test.each(["CANCELLED", "SETTLED"] as const)("rejects %s sessions", async (status) => {
    const s = setup(new Session(sessionDetails({ status })));
    await expect(s.useCase.inviteByHandles("booker", "s", ["alice_01"]))
      .rejects.toMatchObject({ code: "SESSION_CLOSED" });
    expect(s.add).not.toHaveBeenCalled();
  });

  test("rechecks start time after session hydration", async () => {
    const s = setup();
    s.getSession.mockImplementationOnce(async () => {
      s.clock.now.mockReturnValue(sessionStartsAt);
      return s.session;
    });
    await expect(s.useCase.inviteFromGroup("booker", "s", "group", ["alice"]))
      .rejects.toMatchObject({ code: "SESSION_STARTED" });
    expect(s.fromGroup).not.toHaveBeenCalled();
  });

  test.each(["direct", "group"] as const)("rejects %s invitations if recipient lookup crosses the start cutoff", async (source) => {
    const s = setup();
    const players = [{ userId: "alice", handle: "alice_01", displayName: "Alice" }];
    const delayedLookup = async () => { s.clock.now.mockReturnValue(sessionStartsAt); return players; };
    s.byHandles.mockImplementation(delayedLookup);
    s.fromGroup.mockImplementation(delayedLookup);
    const send = source === "direct" ? s.useCase.inviteByHandles("booker", "s", ["alice_01"])
      : s.useCase.inviteFromGroup("booker", "s", "group", ["alice"]);
    await expect(send).rejects.toMatchObject({ code: "SESSION_STARTED" });
    expect(s.add).not.toHaveBeenCalled();
    expect(s.append).not.toHaveBeenCalled();
  });

  test.each(["direct", "group"] as const)("fails %s sends when the final notification write crosses the start cutoff", async (source) => {
    const s = setup();
    s.byHandles.mockResolvedValue([{ userId: "alice", handle: "alice_01", displayName: "Alice" }]);
    s.append.mockImplementation(async () => { s.clock.now.mockReturnValue(sessionStartsAt); });
    const send = source === "direct" ? s.useCase.inviteByHandles("booker", "s", ["alice_01"])
      : s.useCase.inviteFromGroup("booker", "s", "group", ["alice"]);
    await expect(send).rejects.toMatchObject({ code: "SESSION_STARTED" });
  });

  test("rejects unknown users, repeated handles and unsafe bulk sizes", async () => {
    const s = setup();
    s.byHandles.mockResolvedValue([]);
    await expect(s.useCase.inviteByHandles("booker", "s", ["alice_01"]))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(s.useCase.inviteByHandles("booker", "s", ["alice_01", "@ALICE_01"]))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.useCase.inviteByHandles("booker", "s", [])).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(s.useCase.inviteFromGroup("booker", "s", "group", ["alice", "alice"]))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(s.add).not.toHaveBeenCalled();
  });

  test("pending invite listing still requires current ownership", async () => {
    const s = setup();
    const invite = { inviteeId: "alice", displayName: "Alice", handle: "alice_01", status: "PENDING" as const, invitedAt: new Date() };
    s.list.mockResolvedValue([invite]);
    expect(await s.useCase.listForBooker("booker", "s")).toEqual([invite]);
    s.getUser.mockResolvedValue(createTestUser({ userId: "other" }));
    await expect(s.useCase.listForBooker("other", "s")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(s.list).toHaveBeenCalledTimes(1);
  });

  test("reports failure if commit cannot be confirmed instead of faking successful sends", async () => {
    const s = setup();
    s.byHandles.mockResolvedValue([{ userId: "alice", handle: "alice_01", displayName: "Alice" }]);
    const failure = new Error("Commit failed");
    s.run.mockImplementation(async (work) => {
      await work(s.repositories);
      throw failure;
    });
    await expect(s.useCase.inviteByHandles("booker", "s", ["alice_01"]))
      .rejects.toBe(failure);
  });
});
