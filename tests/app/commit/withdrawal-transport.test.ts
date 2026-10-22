import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  JOINED_SESSIONS_LOAD_MESSAGE, JOINED_SESSIONS_URL, leaveWaitlist, loadJoinedSessions, previewWithdrawal, UNCONFIRMED_LEAVE_MESSAGE,
  UNCONFIRMED_WITHDRAWAL_MESSAGE, WITHDRAWAL_ERROR_MESSAGES, withdrawalPreviewUrl, withdrawFromSession,
} from "@/app/commit/withdrawal-transport";
import { createClient } from "@/lib/supabase/client";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

const getSession = vi.fn();
const fetcher = vi.fn<typeof fetch>();
const sessionId = "11111111-1111-4111-8111-111111111111";
const participationId = "22222222-2222-4222-8222-222222222222";
const withdrawRequest = { sessionId, idempotencyKey: "withdraw-key", replacement: { mode: "OPEN_SLOT" } as const };

describe("UC2-05 withdrawal transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: "player-token" } }, error: null });
    vi.mocked(createClient).mockReturnValue({ auth: { getSession } } as unknown as ReturnType<typeof createClient>);
    vi.stubGlobal("fetch", fetcher);
  });
  afterEach(() => vi.unstubAllGlobals());

  test("maps the preview reply to the screen's preview and drops fields it does not show", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ sessionId, participationId, kind: "AWAITING_REPLACEMENT", refundCents: 0, heldCents: 1250 }));

    // Act
    const result = await previewWithdrawal(sessionId);

    // Assert
    expect(result).toEqual({ status: "ready", preview: { kind: "AWAITING_REPLACEMENT", refundCents: 0, heldCents: 1250 } });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(withdrawalPreviewUrl(sessionId));
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: "Bearer player-token" } });
  });

  test.each([
    ["a fractional amount", { sessionId, participationId, kind: "REFUNDED", refundCents: 12.5, heldCents: 1250 }],
    ["an unknown kind", { sessionId, participationId, kind: "FREE", refundCents: 0, heldCents: 0 }],
  ])("rejects a preview with %s instead of showing a wrong refund", async (_name, body) => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json(body));

    // Act & Assert
    expect(await previewWithdrawal(sessionId)).toEqual({ status: "error", message: "We couldn't check your refund. Please try again." });
  });

  test("reports a place that has already changed with a player-facing message", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: "INVALID_STATE", message: "Only a committed participant can withdraw" } }, { status: 409 }));

    // Act & Assert
    expect(await previewWithdrawal(sessionId)).toMatchObject({ status: "error", message: expect.stringContaining("already changed") });
  });

  test("sends the withdrawal with its key and choice, and maps the reply", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ kind: "REFUNDED", sessionId, participationId, refundedCents: 1250, promotion: { status: "NOT_NEEDED" } }));

    // Act
    const result = await withdrawFromSession(withdrawRequest);

    // Assert
    expect(result).toEqual({ status: "withdrawn", kind: "REFUNDED", refundedCents: 1250 });
    const [, init] = fetcher.mock.calls[0]!;
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer player-token", "Content-Type": "application/json" } });
    expect(JSON.parse(init!.body as string)).toEqual(withdrawRequest);
  });

  test.each([
    ["a network failure", () => fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
    ["a server failure", () => fetcher.mockResolvedValueOnce(Response.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, { status: 500 }))],
    ["an unreadable success", () => fetcher.mockResolvedValueOnce(new Response("<html>", { status: 200 }))],
    ["a success in an unexpected shape", () => fetcher.mockResolvedValueOnce(Response.json({ kind: "REFUNDED" }))],
    ["a gateway timeout (408)", () => fetcher.mockResolvedValueOnce(new Response("Request Timeout", { status: 408 }))],
    ["a rate limit (429)", () => fetcher.mockResolvedValueOnce(Response.json({ error: { code: "RATE_LIMITED", message: "Slow down" } }, { status: 429 }))],
  ])("treats %s as an unconfirmed withdrawal, to be retried with the same request", async (_name, arrange) => {
    // Arrange
    arrange();

    // Act & Assert
    expect(await withdrawFromSession(withdrawRequest)).toEqual({ status: "error", code: expect.any(String), message: UNCONFIRMED_WITHDRAWAL_MESSAGE, unconfirmed: true });
  });

  test.each([
    [409, { error: { code: "SESSION_STARTED", message: "Started" } }, "SESSION_STARTED"],
    [400, "<html>Bad request</html>", "UNEXPECTED_ERROR"],
  ])("treats a %s as a definite rejection", async (status, body, code) => {
    // Arrange
    fetcher.mockResolvedValueOnce(typeof body === "string" ? new Response(body, { status }) : Response.json(body, { status }));

    // Act & Assert
    expect(await withdrawFromSession(withdrawRequest)).toMatchObject({ status: "error", code, unconfirmed: false });
  });

  test("leaves the waitlist with its key and maps the reply", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ sessionId, participationId, promotion: { status: "DEFERRED" } }));

    // Act & Assert
    expect(await leaveWaitlist({ sessionId, idempotencyKey: "leave-key" })).toEqual({ status: "left" });
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ sessionId, idempotencyKey: "leave-key" });
  });

  test("treats a lost waitlist departure as unconfirmed", async () => {
    // Arrange
    fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    // Act & Assert
    expect(await leaveWaitlist({ sessionId, idempotencyKey: "leave-key" })).toMatchObject({ message: UNCONFIRMED_LEAVE_MESSAGE, unconfirmed: true });
  });

  test("sends nothing for a signed-out player", async () => {
    // Arrange
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    // Act & Assert
    expect(await withdrawFromSession(withdrawRequest)).toMatchObject({ code: "UNAUTHENTICATED", unconfirmed: false });
    expect(await leaveWaitlist({ sessionId, idempotencyKey: "leave-key" })).toMatchObject({ code: "UNAUTHENTICATED", unconfirmed: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  describe("joined sessions", () => {
    const joined = {
      sessionId, venueName: "Court 3", sport: "Badminton", region: "East",
      startAt: "2026-11-01T10:00:00.000Z", endAt: "2026-11-01T12:00:00.000Z", status: "WAITLISTED", bookingShareCents: 1250,
    };

    test("loads the list as the signed-in player and maps each place", async () => {
      // Arrange
      fetcher.mockResolvedValueOnce(Response.json({ sessions: [{ ...joined, extra: "dropped" }] }));

      // Act
      const sessions = await loadJoinedSessions();

      // Assert
      expect(sessions).toEqual([joined]);
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe(JOINED_SESSIONS_URL);
      expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: "Bearer player-token" } });
    });

    test.each([
      ["a fractional share", { sessions: [{ ...joined, bookingShareCents: 12.5 }] }],
      ["an unknown status", { sessions: [{ ...joined, status: "WITHDRAWN" }] }],
      ["no list", {}],
    ])("throws on a reply with %s instead of showing a wrong list", async (_name, body) => {
      // Arrange
      fetcher.mockResolvedValueOnce(Response.json(body));

      // Act & Assert
      await expect(loadJoinedSessions()).rejects.toThrow(JOINED_SESSIONS_LOAD_MESSAGE);
    });

    test("throws a player-facing message for a rejection", async () => {
      // Arrange
      fetcher.mockResolvedValueOnce(Response.json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required" } }, { status: 401 }));

      // Act & Assert
      await expect(loadJoinedSessions()).rejects.toThrow(WITHDRAWAL_ERROR_MESSAGES.UNAUTHENTICATED);
    });

    test("throws when the request fails, so a place is never treated as gone", async () => {
      // Arrange
      fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      // Act & Assert
      await expect(loadJoinedSessions()).rejects.toThrow(JOINED_SESSIONS_LOAD_MESSAGE);
    });
  });
});
