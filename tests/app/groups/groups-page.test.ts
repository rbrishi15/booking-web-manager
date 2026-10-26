import { beforeEach, expect, test, vi } from "vitest";
import { GroupMembership, RegularGroup } from "@/domain";
import GroupsPage from "@/app/groups/page";

const mocks = vi.hoisted(() => ({ user: vi.fn(), listMine: vi.fn(), names: vi.fn() }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/use-case-config/groups", () => ({ createManageGroup: () => ({ listMine: mocks.listMine }) }));
vi.mock("@/lib/supabase/profile-names", () => ({ displayNames: mocks.names }));
vi.mock("@/app/groups/_components/group-controls", () => ({ CreateGroupForm: () => null }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

function group(groupId: string, archived = false) {
  return new RegularGroup({
    groupId, ownerId: "viewer", name: "Weekend Tennis Club", invitationToken: "secret-invitation-token",
    invitationActive: !archived, status: archived ? "ARCHIVED" : "ACTIVE",
    memberships: ["viewer", "player-two", "player-three", "player-four", "player-five"].map((userId) => new GroupMembership({ userId, joinedAt: new Date(userId === "viewer" ? "2026-10-26T08:00:00Z" : "2026-10-25T16:30:00Z") })),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.listMine.mockResolvedValue([group("weekend")]);
  mocks.names.mockResolvedValue(new Map([["viewer", "Tian Pok Neoh"], ["player-two", "Sarah Tan"], ["player-three", "Deleted user"], ["player-four", "Unnamed player"]]));
});

test("redirects a signed-out visitor before reading private groups or member names", async () => {
  mocks.user.mockResolvedValue(null);
  await expect(GroupsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
  expect(mocks.listMine).not.toHaveBeenCalled();
  expect(mocks.names).not.toHaveBeenCalled();
});

test("passes display-only summaries to the client without invitation secrets or member IDs", async () => {
  const page = await GroupsPage({ searchParams: Promise.resolve({ left: "1" }) });
  expect(page.props.groups).toEqual([{
    groupId: "weekend", name: "Weekend Tennis Club", memberCount: 5,
    memberNames: ["Tian Pok Neoh", "Sarah Tan", "Deleted user", "Unnamed player"],
    joinedAt: "2026-10-26T08:00:00.000Z", isOwner: true, archived: false, invitationActive: true,
  }]);
  expect(page.props.left).toBe(true);
  expect(JSON.stringify(page.props)).not.toContain("secret-invitation-token");
  expect(JSON.stringify(page.props)).not.toContain("player-two");
  expect(mocks.listMine).toHaveBeenCalledExactlyOnceWith({ actorId: "viewer" });
});

test("batches only visible member names, deduplicated across groups", async () => {
  mocks.listMine.mockResolvedValue([group("weekend"), group("old", true)]);
  const page = await GroupsPage({ searchParams: Promise.resolve({}) });
  expect(mocks.names).toHaveBeenCalledExactlyOnceWith(["viewer", "player-two", "player-three", "player-four"]);
  expect(page.props.groups[1].archived).toBe(true);
  expect(page.props.groups[1].invitationActive).toBe(false);
});

test("keeps an empty membership list empty and skips the profile query", async () => {
  mocks.listMine.mockResolvedValue([]);
  const page = await GroupsPage({ searchParams: Promise.resolve({ left: ["1", "0"] }) });
  expect(page.props.groups).toEqual([]);
  expect(page.props.left).toBe(false);
  expect(mocks.names).not.toHaveBeenCalled();
});

test("uses the signed-in member's join date and role, with a safe name fallback", async () => {
  mocks.user.mockResolvedValue({ id: "player-two" });
  mocks.names.mockResolvedValue(new Map());
  const page = await GroupsPage({ searchParams: Promise.resolve({}) });
  expect(page.props.groups[0]).toMatchObject({ isOwner: false, joinedAt: "2026-10-25T16:30:00.000Z", memberNames: ["Unnamed player", "Unnamed player", "Unnamed player", "Unnamed player"] });
});
