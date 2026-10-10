import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UNCONFIRMED_ATTENDANCE_MESSAGE, verifyAttendance } from "@/app/commit/verify-attendance-transport";
import { createClient } from "@/lib/supabase/client";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const marks = [
  { participationId: "22222222-2222-4222-8222-222222222222", attendance: "ATTENDED" as const },
  { participationId: "33333333-3333-4333-8333-333333333333", attendance: "ABSENT" as const },
];
const request = { sessionId: SESSION_ID, idempotencyKey: "attendance-key-1", marks };
const getSession = vi.fn();
const fetcher = vi.fn<typeof fetch>();

describe("UC2-06 verify attendance transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: "booker-token" } }, error: null });
    vi.mocked(createClient).mockReturnValue({ auth: { getSession } } as unknown as ReturnType<typeof createClient>);
    vi.stubGlobal("fetch", fetcher);
  });

  afterEach(() => vi.unstubAllGlobals());

  test("sends the session, the retry key and the marks with the bearer token", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ sessionId: SESSION_ID, status: "OPEN" }));

    // Act
    const outcome = await verifyAttendance(request);

    // Assert
    expect(outcome).toEqual({ status: "saved", allVerified: false });
    expect(fetcher).toHaveBeenCalledWith("/api/sessions/attendance", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer booker-token", "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID, idempotencyKey: "attendance-key-1", marks }),
    }));
  });

  test("reports every player checked once the session moves on to payout", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ sessionId: SESSION_ID, status: "AWAITING_PAYOUT" }));

    // Act & Assert
    expect(await verifyAttendance(request)).toEqual({ status: "saved", allVerified: true });
  });

  test("asks the booker to log in without calling the API when signed out", async () => {
    // Arrange
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null });

    // Act
    const outcome = await verifyAttendance(request);

    // Assert
    expect(outcome).toMatchObject({ status: "error", code: "UNAUTHENTICATED", unconfirmed: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([
    [409, "ATTENDANCE_CONFLICT", "already marked"],
    [409, "SESSION_NOT_ENDED", "once the session has ended"],
    [403, "UNAUTHORIZED", "Only the session's booker"],
    [404, "NOT_FOUND", "no longer exists"],
  ])("shows a booker-facing message for %s %s", async (status, code, text) => {
    // Arrange: the server's own wording must not reach the page.
    fetcher.mockResolvedValueOnce(Response.json({ error: { code, message: "internal wording" } }, { status }));

    // Act
    const outcome = await verifyAttendance(request);

    // Assert
    expect(outcome).toMatchObject({ status: "error", code, unconfirmed: false });
    expect(outcome.status === "error" && outcome.message).toContain(text);
  });

  test("treats a 4xx with an unreadable body as a definite rejection, not an unconfirmed save", async () => {
    // Arrange: a proxy's HTML error page instead of the API's JSON.
    fetcher.mockResolvedValueOnce(new Response("<html>Forbidden</html>", { status: 403 }));

    // Act & Assert
    expect(await verifyAttendance(request)).toMatchObject({ status: "error", code: "UNEXPECTED_ERROR", unconfirmed: false });
  });

  test.each([
    ["a 502 without a JSON body", () => fetcher.mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }))],
    ["a server error", () => fetcher.mockResolvedValueOnce(Response.json({ error: { code: "INTERNAL_ERROR", message: "x" } }, { status: 500 }))],
    ["a 503", () => fetcher.mockResolvedValueOnce(Response.json({ error: { code: "SESSION_MANAGEMENT_UNAVAILABLE", message: "x" } }, { status: 503 }))],
    ["a network failure", () => fetcher.mockRejectedValueOnce(new Error("offline"))],
    ["a malformed success body", () => fetcher.mockResolvedValueOnce(Response.json({ unexpected: true }))],
  ])("treats %s as unconfirmed so the same request is retried", async (_name, arrange) => {
    // Arrange
    arrange();

    // Act & Assert
    expect(await verifyAttendance(request)).toEqual({ status: "error", code: expect.any(String), message: UNCONFIRMED_ATTENDANCE_MESSAGE, unconfirmed: true });
  });
});
