import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ACCEPT_REPLACEMENT_ERROR_MESSAGES, ACCEPT_REPLACEMENT_URL, acceptReplacement, INVITATIONS_LOAD_MESSAGE, loadReplacementInvitations,
  REPLACEMENT_INVITATIONS_URL, UNCONFIRMED_ACCEPT_MESSAGE,
} from "@/app/commit/replacement-transport";
import { createClient } from "@/lib/supabase/client";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

const getSession = vi.fn();
const fetcher = vi.fn<typeof fetch>();
const sessionId = "11111111-1111-4111-8111-111111111111";
const participationId = "22222222-2222-4222-8222-222222222222";
const request = { sessionId, idempotencyKey: "accept-key" };

describe("UC2-05 accept-replacement transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: "player-token" } }, error: null });
    vi.mocked(createClient).mockReturnValue({ auth: { getSession } } as unknown as ReturnType<typeof createClient>);
    vi.stubGlobal("fetch", fetcher);
  });
  afterEach(() => vi.unstubAllGlobals());

  test("sends only the session and key, and maps the reply to the amount held", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ sessionId, participationId, heldCents: 900, refundedParticipationId: participationId }, { status: 201 }));

    // Act
    const result = await acceptReplacement(request);

    // Assert
    expect(result).toEqual({ status: "accepted", heldCents: 900 });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(ACCEPT_REPLACEMENT_URL);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", headers: { Authorization: "Bearer player-token", "Content-Type": "application/json" } });
    expect(JSON.parse(init!.body as string)).toEqual(request);
  });

  test.each([
    ["a network failure", () => fetcher.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
    ["a server failure", () => fetcher.mockResolvedValueOnce(Response.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, { status: 500 }))],
    ["an unreadable success", () => fetcher.mockResolvedValueOnce(new Response("<html>", { status: 201 }))],
    ["a success with a fractional amount", () => fetcher.mockResolvedValueOnce(Response.json({ sessionId, participationId, heldCents: 9.5 }, { status: 201 }))],
    ["a gateway timeout (408)", () => fetcher.mockResolvedValueOnce(new Response("Request Timeout", { status: 408 }))],
    ["a rate limit (429)", () => fetcher.mockResolvedValueOnce(Response.json({ error: { code: "RATE_LIMITED", message: "Slow down" } }, { status: 429 }))],
  ])("treats %s as an unconfirmed acceptance, to be retried with the same key", async (_name, arrange) => {
    // Arrange
    arrange();

    // Act & Assert
    expect(await acceptReplacement(request)).toEqual({ status: "error", code: expect.any(String), message: UNCONFIRMED_ACCEPT_MESSAGE, unconfirmed: true });
  });

  test.each([
    [409, { error: { code: "INSUFFICIENT_FUNDS", message: "Insufficient funds" } }, "INSUFFICIENT_FUNDS"],
    [403, { error: { code: "INVALID_ACCESS", message: "No pending invitation" } }, "INVALID_ACCESS"],
  ])("treats a %s as a definite rejection with a player-facing message", async (status, body, code) => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json(body, { status }));

    // Act & Assert
    expect(await acceptReplacement(request)).toEqual({ status: "error", code, message: ACCEPT_REPLACEMENT_ERROR_MESSAGES[code], unconfirmed: false });
  });

  test("uses a general message for an unknown rejection", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(new Response("<html>Bad request</html>", { status: 400 }));

    // Act & Assert
    expect(await acceptReplacement(request)).toEqual({
      status: "error", code: "UNEXPECTED_ERROR", message: "We couldn't accept this invitation. Please try again.", unconfirmed: false,
    });
  });

  test("sends nothing for a signed-out player", async () => {
    // Arrange
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    // Act & Assert
    expect(await acceptReplacement(request)).toMatchObject({ code: "UNAUTHENTICATED", unconfirmed: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  describe("invitations", () => {
    const invitation = {
      sessionId, venueName: "Court 3", sport: "Futsal", region: "West",
      startAt: "2026-11-01T10:00:00.000Z", endAt: "2026-11-01T12:00:00.000Z", bookingShareCents: 900,
    };

    test("loads the list as the signed-in player and maps each invitation", async () => {
      // Arrange
      fetcher.mockResolvedValueOnce(Response.json({ invitations: [{ ...invitation, extra: "dropped" }] }));

      // Act
      const invitations = await loadReplacementInvitations();

      // Assert
      expect(invitations).toEqual([invitation]);
      const [url, init] = fetcher.mock.calls[0]!;
      expect(url).toBe(REPLACEMENT_INVITATIONS_URL);
      expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: "Bearer player-token" } });
    });

    test.each([
      ["a fractional share", { invitations: [{ ...invitation, bookingShareCents: 9.5 }] }],
      ["an unreadable start time", { invitations: [{ ...invitation, startAt: "soon" }] }],
      ["no list", {}],
    ])("throws on a reply with %s instead of showing a wrong list", async (_name, body) => {
      // Arrange
      fetcher.mockResolvedValueOnce(Response.json(body));

      // Act & Assert
      await expect(loadReplacementInvitations()).rejects.toThrow(INVITATIONS_LOAD_MESSAGE);
    });

    test("throws a player-facing message when signed out, without calling the API", async () => {
      // Arrange
      getSession.mockResolvedValue({ data: { session: null }, error: null });

      // Act & Assert
      await expect(loadReplacementInvitations()).rejects.toThrow(ACCEPT_REPLACEMENT_ERROR_MESSAGES.UNAUTHENTICATED);
      expect(fetcher).not.toHaveBeenCalled();
    });

    test("throws when the server fails, so an invitation is never treated as resolved", async () => {
      // Arrange
      fetcher.mockResolvedValueOnce(Response.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, { status: 500 }));

      // Act & Assert
      await expect(loadReplacementInvitations()).rejects.toThrow(INVITATIONS_LOAD_MESSAGE);
    });
  });
});
