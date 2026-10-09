import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HOSTED_SESSIONS_URL, HostedSessionsLoadError, loadHostedSessions } from "@/app/sessions/hosted-sessions-transport";
import { createClient } from "@/lib/supabase/client";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
const getSession = vi.fn();
const fetcher = vi.fn<typeof fetch>();

const body = {
  sessions: [{
    sessionId: "session-1", venueName: "West sports hall", sport: "Tennis", region: "West",
    startAt: "2042-08-02T10:00:00.000Z", endAt: "2042-08-02T12:00:00.000Z", visibility: "PRIVATE", availableSlots: 3,
    actions: [{ name: "set-visibility", href: "/api/sessions/session-1/visibility", method: "PATCH", inputs: { visibility: "PUBLIC" } }],
  }],
  awaitingAttendance: [{
    sessionId: "ended", venueName: "Bishan Sports Hall", sport: "Badminton",
    startAt: "2042-08-01T10:00:00.000Z", endAt: "2042-08-01T12:00:00.000Z", unverifiedCount: 3,
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { access_token: "fixture-bearer" } }, error: null });
  vi.mocked(createClient).mockReturnValue({ auth: { getSession } } as unknown as ReturnType<typeof createClient>);
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());

async function failure(): Promise<HostedSessionsLoadError> {
  const error = await loadHostedSessions().then(() => null, (thrown: unknown) => thrown);
  if (!(error instanceof HostedSessionsLoadError)) throw new Error("Expected a HostedSessionsLoadError");
  return error;
}

test("reads the hosted sessions with the bearer token and no caching", async () => {
  fetcher.mockResolvedValueOnce(Response.json(body));
  expect(await loadHostedSessions()).toEqual(body);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(HOSTED_SESSIONS_URL, expect.objectContaining({ cache: "no-store" }));
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer fixture-bearer");
});

test("sends a signed-out browser to login without calling the API", async () => {
  getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
  expect(await failure()).toMatchObject({ code: "UNAUTHENTICATED", signIn: true });
  expect(fetcher).not.toHaveBeenCalled();
});

test("reports a failed sign-in check as retryable", async () => {
  getSession.mockRejectedValueOnce(new Error("storage unavailable"));
  expect(await failure()).toMatchObject({ code: "AUTH_UNAVAILABLE", kind: "unexpected", signIn: false });
});

test.each([
  [401, "UNAUTHENTICATED", true],
  [403, "INACTIVE_ACCOUNT", true],
  [404, "NOT_FOUND", true],
  [500, "INTERNAL_ERROR", false],
] as const)("maps a %s %s reply", async (status, code, signIn) => {
  fetcher.mockResolvedValueOnce(Response.json({ error: { code, message: "Refused" } }, { status }));
  expect(await failure()).toMatchObject({ code, kind: "unexpected", signIn });
});

test("maps missing server settings to the unavailable screen", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ error: { code: "SESSION_MANAGEMENT_UNAVAILABLE", message: "Unavailable" } }, { status: 503 }));
  expect(await failure()).toMatchObject({ code: "SESSION_MANAGEMENT_UNAVAILABLE", kind: "unavailable", signIn: false });
});

test.each([
  ["a network failure", () => fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch")), "NETWORK_ERROR"],
  ["an unreadable body", () => fetcher.mockResolvedValueOnce(new Response("<html>", { status: 200 })), "NETWORK_ERROR"],
  ["an unexpected shape", () => fetcher.mockResolvedValueOnce(Response.json({ sessions: [{ sessionId: "x" }], awaitingAttendance: [] })), "UNEXPECTED_RESPONSE"],
  ["an invalid date", () => fetcher.mockResolvedValueOnce(Response.json({ ...body, awaitingAttendance: [{ ...body.awaitingAttendance[0], startAt: "soon" }] })), "UNEXPECTED_RESPONSE"],
])("treats %s as a retryable error", async (_name, arrange, code) => {
  arrange();
  expect(await failure()).toMatchObject({ code, kind: "unexpected", signIn: false });
});
