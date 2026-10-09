import { beforeEach, describe, expect, test, vi } from "vitest";
import SessionsPage, { dynamic } from "@/app/sessions/(manage)/page";
import { getSessionManagementDependencies } from "@/app/sessions/management-server-dependencies";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { DomainError } from "@/domain";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import type { ListHostedSessions } from "@/use-cases/sessions/ListHostedSessions";

vi.mock("@/app/sessions/management-server-dependencies", () => ({ getSessionManagementDependencies: vi.fn() }));
vi.mock("@/app/sessions/_components/hosted-sessions-controller", () => ({ HostedSessionsController: () => null }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/account-status", () => ({ getAccountStatus: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const forBooker = vi.fn<ListHostedSessions["forBooker"]>();
const attendanceDueForBooker = vi.fn<ListHostedSessions["attendanceDueForBooker"]>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: "booker", email: "booker@example.com", emailVerified: true, pendingEmail: null, accountStatus: "ACTIVE", displayName: "Booker", profileName: "Booker",
    preferredSports: [], preferredRegions: [], reliabilityScore: 100,
  });
  vi.mocked(getAccountStatus).mockResolvedValue({ kind: "active" });
  forBooker.mockResolvedValue([]);
  attendanceDueForBooker.mockResolvedValue([]);
  vi.mocked(getSessionManagementDependencies).mockResolvedValue({
    authenticate: vi.fn(), toggleVisibility: { forBooker: vi.fn() }, listHostedSessions: { forBooker, attendanceDueForBooker },
  });
});

describe("hosted Sessions page", () => {
  test("requires cookie identity before obtaining hosted sessions", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(SessionsPage()).rejects.toThrow("redirect:/login?next=%2Fsessions");
    expect(getSessionManagementDependencies).not.toHaveBeenCalled();
    expect(dynamic).toBe("force-dynamic");
  });

  test("serializes only management display fields without limiting the owner's list", async () => {
    const sessions = Array.from({ length: 21 }, (_, index) => ({
      sessionId: `session-${index}`, venueName: "West sports hall", sport: "Tennis", region: "West",
      startAt: new Date("2042-08-02T10:00:00Z"), endAt: new Date("2042-08-02T12:00:00Z"),
      visibility: "PRIVATE" as const, availableSlots: index === 0 ? 0 : 3,
      actions: index === 0 ? [{ name: "preview-cancellation" as const }] : [{ name: "set-visibility" as const, visibility: "PUBLIC" as const }, { name: "preview-cancellation" as const }],
      roomToken: "must-not-leak", participations: ["must-not-leak"],
    }));
    forBooker.mockResolvedValue(sessions);
    const page = await SessionsPage();
    expect(forBooker).toHaveBeenCalledExactlyOnceWith("booker");
    expect(page.props.userId).toBe("booker");
    expect(page.props.outcome.sessions).toHaveLength(21);
    expect(page.props.outcome.sessions[0]).toEqual({
      sessionId: "session-0", venueName: "West sports hall", sport: "Tennis", region: "West",
      startAt: "2042-08-02T10:00:00.000Z", endAt: "2042-08-02T12:00:00.000Z",
      visibility: "PRIVATE", availableSlots: 0,
      actions: [{ name: "preview-cancellation", href: "/api/sessions/session-0/cancellation-preview", method: "GET", inputs: {} }],
    });
    expect(page.props.actions).toEqual([{ name: "create-session", href: "/sessions/create", method: "GET", inputs: {} }]);
  });

  test("UC2-06 serializes ended sessions that still need the booker's attendance check", async () => {
    attendanceDueForBooker.mockResolvedValue([{
      sessionId: "ended", venueName: "Bishan Sports Hall", sport: "Badminton",
      startAt: new Date("2042-08-01T10:00:00Z"), endAt: new Date("2042-08-01T12:00:00Z"), unverifiedCount: 3,
    }]);
    const page = await SessionsPage();
    expect(attendanceDueForBooker).toHaveBeenCalledExactlyOnceWith("booker");
    expect(page.props.outcome.awaitingAttendance).toEqual([{
      sessionId: "ended", venueName: "Bishan Sports Hall", sport: "Badminton",
      startAt: "2042-08-01T10:00:00.000Z", endAt: "2042-08-01T12:00:00.000Z", unverifiedCount: 3,
    }]);
  });

  test("UC2-06 still shows hosted sessions when the attendance-due list fails", async () => {
    forBooker.mockResolvedValue([]);
    attendanceDueForBooker.mockRejectedValue(new Error("Temporary database outage"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await SessionsPage()).props.outcome).toEqual({ status: "ready", sessions: [], awaitingAttendance: [] });
  });

  test("UC2-06 still redirects an account rejected while reading the attendance-due list", async () => {
    attendanceDueForBooker.mockRejectedValue(new DomainError("INACTIVE_ACCOUNT", "inactive"));
    await expect(SessionsPage()).rejects.toThrow("redirect:/login");
  });

  test("unverified users can view hosted sessions and receive the email recovery action", async () => {
    const user = await getCurrentUser();
    vi.mocked(getCurrentUser).mockResolvedValue({ ...user!, emailVerified: false });
    const page = await SessionsPage();
    expect(page.props.outcome).toEqual({ status: "ready", sessions: [], awaitingAttendance: [] });
    expect(page.props.actions).toEqual([{ name: "verify-email", href: "/profile/email", method: "GET", inputs: {} }]);
    expect(forBooker).toHaveBeenCalledExactlyOnceWith("booker");
  });

  test.each(["inactive", "missing-profile"] as const)("redirects a %s account before management reads", async (kind) => {
    vi.mocked(getAccountStatus).mockResolvedValue({ kind });
    await expect(SessionsPage()).rejects.toThrow("redirect:/login");
    expect(getSessionManagementDependencies).not.toHaveBeenCalled();
  });

  test("fails closed when app account access cannot be verified", async () => {
    vi.mocked(getAccountStatus).mockResolvedValue({ kind: "lookup-failed", code: undefined, message: "private provider detail" });
    expect((await SessionsPage()).props.outcome).toEqual({ status: "error", kind: "unexpected" });
    expect(getSessionManagementDependencies).not.toHaveBeenCalled();
  });

  test("shows an opaque retry screen when cookie client initialization throws", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("private client settings"));
    expect((await SessionsPage()).props.outcome).toEqual({ status: "error", kind: "unexpected" });
    expect(getAccountStatus).not.toHaveBeenCalled();
    expect(getSessionManagementDependencies).not.toHaveBeenCalled();
  });

  test("shows an opaque retry screen when account lookup throws", async () => {
    vi.mocked(getAccountStatus).mockRejectedValue(new Error("private provider failure"));
    expect((await SessionsPage()).props.outcome).toEqual({ status: "error", kind: "unexpected" });
    expect(getSessionManagementDependencies).not.toHaveBeenCalled();
  });

  test.each(["INACTIVE_ACCOUNT", "NOT_FOUND"] as const)("redirects when fresh use-case state rejects the account with %s", async (code) => {
    forBooker.mockRejectedValue(new DomainError(code, "Account denied"));
    await expect(SessionsPage()).rejects.toThrow("redirect:/login");
  });

  test.each([
    { error: new SessionManagementUnavailableError(), kind: "unavailable" },
    { error: new Error("private infrastructure detail"), kind: "unexpected" },
  ])("maps $kind failures to an opaque screen instead of an empty list", async ({ error, kind }) => {
    forBooker.mockRejectedValue(error);
    expect((await SessionsPage()).props.outcome).toEqual({ status: "error", kind });
  });
});
