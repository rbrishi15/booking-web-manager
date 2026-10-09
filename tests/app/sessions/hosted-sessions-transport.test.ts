import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HOSTED_SESSIONS_URL, HostedSessionsLoadError, loadHostedSessions } from "@/app/sessions/hosted-sessions-transport";

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
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());

async function failure(): Promise<HostedSessionsLoadError> {
  const error = await loadHostedSessions().then(() => null, (thrown: unknown) => thrown);
  if (!(error instanceof HostedSessionsLoadError)) throw new Error("Expected a HostedSessionsLoadError");
  return error;
}

test("reads the hosted sessions with the login cookies and no caching", async () => {
  fetcher.mockResolvedValueOnce(Response.json(body));
  expect(await loadHostedSessions()).toEqual(body);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(HOSTED_SESSIONS_URL, expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
  // The API reads the login from the cookies; the page never handles the token.
  expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("headers");
});

test("stops the request when React Query cancels it", async () => {
  const controller = new AbortController();
  fetcher.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  }));
  const pending = loadHostedSessions(controller.signal).then(() => null, (thrown: unknown) => thrown);
  controller.abort();
  expect(await pending).toMatchObject({ code: "NETWORK_ERROR" });
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

test.each([
  [401, "UNAUTHENTICATED", "unexpected", true],
  [503, "SESSION_MANAGEMENT_UNAVAILABLE", "unavailable", false],
  [502, "UNEXPECTED_ERROR", "unexpected", false],
] as const)("keeps the meaning of a %s reply whose body is not JSON", async (status, code, kind, signIn) => {
  fetcher.mockResolvedValueOnce(new Response("<html>Gateway error</html>", { status }));
  expect(await failure()).toMatchObject({ code, kind, signIn });
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
