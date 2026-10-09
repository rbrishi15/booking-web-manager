import { beforeEach, describe, expect, test, vi } from "vitest";
import SessionParticipantsPage, { dynamic } from "@/app/sessions/(manage)/[sessionId]/participants/page";
import { listSessionParticipants } from "@/app/sessions/removal-actions";
import { getCurrentUser } from "@/lib/supabase/current-user";

vi.mock("@/app/sessions/removal-actions", () => ({ listSessionParticipants: vi.fn() }));
vi.mock("@/app/sessions/_components/session-participants-controller", () => ({ SessionParticipantsController: () => null }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

const sessionId = "20000000-0000-4000-8000-000000000001";
const props = { params: Promise.resolve({ sessionId }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "host", email: "host@example.com", emailVerified: true, pendingEmail: null, accountStatus: "ACTIVE", displayName: "Host", profileName: "Host", preferredSports: [], preferredRegions: [], reliabilityScore: 100 });
});

describe("session participants page", () => {
  test("requires cookie identity before reading the participant list", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(SessionParticipantsPage(props)).rejects.toThrow(`redirect:/login?next=${encodeURIComponent(`/sessions/${sessionId}/participants`)}`);
    expect(listSessionParticipants).not.toHaveBeenCalled();
    expect(dynamic).toBe("force-dynamic");
  });

  test("passes the authenticated owner's safe display outcome to the user-scoped controller", async () => {
    const outcome = { status: "ready" as const, session: { sessionId, venueName: "Sports Hall", sport: "Badminton", startAt: "2045-04-02T10:00:00Z", endAt: "2045-04-02T12:00:00Z", status: "OPEN" as const, availableSlots: 4, canVerifyAttendance: false, participants: [] } };
    vi.mocked(listSessionParticipants).mockResolvedValue(outcome);
    const page = await SessionParticipantsPage(props);
    expect(listSessionParticipants).toHaveBeenCalledExactlyOnceWith(sessionId);
    expect(page.props).toEqual({ sessionId, userId: "host", outcome });
  });

  test("renders the safe denial outcome without participant identities", async () => {
    const outcome = { status: "error" as const, code: "UNAUTHORIZED", message: "Only the host can manage participants.", refresh: false, retrySameRequest: false };
    vi.mocked(listSessionParticipants).mockResolvedValue(outcome);
    const page = await SessionParticipantsPage(props);
    expect(page.props.outcome).toEqual(outcome);
    expect(page.props.outcome).not.toHaveProperty("session");
  });
});
