import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { joinSession, UNCONFIRMED_JOIN_MESSAGE } from "@/app/commit/join-session-transport";
import { createClient } from "@/lib/supabase/client";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const request = { sessionId: SESSION_ID, idempotencyKey: "join-key-1" };
const getSession = vi.fn();
const fetcher = vi.fn<typeof fetch>();

describe("UC2-04 join session transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: "player-token" } }, error: null });
    vi.mocked(createClient).mockReturnValue({ auth: { getSession } } as unknown as ReturnType<typeof createClient>);
    vi.stubGlobal("fetch", fetcher);
  });

  afterEach(() => vi.unstubAllGlobals());

  test("sends only the session, the retry key and the bearer token", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ kind: "COMMITTED", sessionId: SESSION_ID, participationId: "p", heldCents: 1250 }, { status: 201 }));

    // Act
    const outcome = await joinSession(request);

    // Assert: no amount or user ID is sent; the server derives both.
    expect(outcome).toEqual({ status: "committed", heldCents: 1250 });
    expect(fetcher).toHaveBeenCalledWith("/api/sessions/commit", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer player-token", "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID, idempotencyKey: "join-key-1" }),
    }));
  });

  test("includes the room token for a private session", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ kind: "COMMITTED", sessionId: SESSION_ID, participationId: "p", heldCents: 900 }, { status: 201 }));

    // Act
    await joinSession({ ...request, roomToken: "room-abc" });

    // Assert
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ sessionId: SESSION_ID, idempotencyKey: "join-key-1", roomToken: "room-abc" }));
  });

  test("reports a full session as waitlisted", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ kind: "WAITLISTED", sessionId: SESSION_ID, participationId: "p", heldCents: 0 }, { status: 201 }));

    // Act & Assert
    expect(await joinSession(request)).toEqual({ status: "waitlisted" });
  });

  test("asks the player to log in without calling the API when signed out", async () => {
    // Arrange
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null });

    // Act
    const outcome = await joinSession(request);

    // Assert
    expect(outcome).toMatchObject({ status: "error", code: "UNAUTHENTICATED", unconfirmed: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([
    [409, "INSUFFICIENT_FUNDS", "Top up your wallet"],
    [403, "EMAIL_VERIFICATION_REQUIRED", "Confirm your email"],
    [409, "ALREADY_PARTICIPATING", "already joined"],
    [403, "INVALID_ACCESS", "private"],
  ])("shows a player-facing message for %s %s", async (status, code, text) => {
    // Arrange: the server's own message must not reach the page.
    fetcher.mockResolvedValueOnce(Response.json({ error: { code, message: "internal wording" } }, { status }));

    // Act
    const outcome = await joinSession(request);

    // Assert
    expect(outcome).toMatchObject({ status: "error", code, unconfirmed: false });
    expect(outcome.status === "error" && outcome.message).toContain(text);
    expect(outcome).not.toHaveProperty("message", "internal wording");
  });

  test.each([
    ["a server error", () => fetcher.mockResolvedValueOnce(Response.json({ error: { code: "INTERNAL_ERROR", message: "x" } }, { status: 500 }))],
    ["a 503 even with a known code", () => fetcher.mockResolvedValueOnce(Response.json({ error: { code: "SESSION_MANAGEMENT_UNAVAILABLE", message: "x" } }, { status: 503 }))],
    ["a 5xx without a JSON body", () => fetcher.mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }))],
    ["a network failure", () => fetcher.mockRejectedValueOnce(new Error("offline"))],
    ["a malformed success body", () => fetcher.mockResolvedValueOnce(Response.json({ kind: "SOMETHING_ELSE" }, { status: 201 }))],
  ])("treats %s as unconfirmed so the same request is retried", async (_name, arrange) => {
    // Arrange
    arrange();

    // Act & Assert
    expect(await joinSession(request)).toEqual({ status: "error", code: expect.any(String), message: UNCONFIRMED_JOIN_MESSAGE, unconfirmed: true });
  });
});
