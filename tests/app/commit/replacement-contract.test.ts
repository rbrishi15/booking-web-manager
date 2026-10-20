import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createClient } from "@/lib/supabase/client";
import { commitmentDependencies } from "./commitment-test-dependencies";

const mocks = vi.hoisted(() => ({ commitment: vi.fn(), playerSessions: vi.fn() }));
vi.mock("@/app/commit/commitment-server-dependencies", () => ({ getCommitmentDependencies: mocks.commitment }));
vi.mock("@/app/commit/player-sessions-server-dependencies", () => ({ getPlayerSessionsDependencies: mocks.playerSessions }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { POST as acceptRoute } from "@/app/api/sessions/replacements/accept/route";
import { GET as invitationsRoute } from "@/app/api/sessions/replacements/route";
import {
  ACCEPT_REPLACEMENT_URL, acceptReplacement, loadReplacementInvitations, REPLACEMENT_INVITATIONS_URL,
} from "@/app/commit/replacement-transport";

const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "11111111-1111-4111-8111-111111111111";
const participationId = "22222222-2222-4222-8222-222222222222";

/** Sends the screen's request to the real route handler instead of the network. */
function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(new URL(String(input), "http://localhost"), init);
  const path = new URL(request.url).pathname;
  if (path === ACCEPT_REPLACEMENT_URL) return acceptRoute(request);
  if (path === REPLACEMENT_INVITATIONS_URL) return invitationsRoute(request);
  throw new Error(`No route for ${path}`);
}

describe("UC2-05 accept-replacement transport against the real route", () => {
  const forInvitee = vi.fn();
  const listInvitations = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockReturnValue({
      auth: { getSession: async () => ({ data: { session: { access_token: "player-token" } }, error: null }) },
    } as unknown as ReturnType<typeof createClient>);
    vi.stubGlobal("fetch", vi.fn(routeFetch));
    const authenticate = async (request: Request) => request.headers.get("authorization") === "Bearer player-token" ? userId : null;
    mocks.commitment.mockResolvedValue(commitmentDependencies({ authenticate, acceptReplacement: { forInvitee } }));
    mocks.playerSessions.mockResolvedValue({
      authenticate, listJoinedSessions: { forParticipant: vi.fn() }, listReplacementInvitations: { forInvitee: listInvitations },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  test("reads the invitations the route returns as the screen's list", async () => {
    // Arrange
    listInvitations.mockResolvedValue([
      { sessionId, venueName: "Court 3", sport: "Futsal", region: "West", startAt: new Date("2026-11-01T10:00:00Z"),
        endAt: new Date("2026-11-01T12:00:00Z"), bookingShareCents: 900 },
    ]);

    // Act
    const invitations = await loadReplacementInvitations();

    // Assert
    expect(invitations).toEqual([
      { sessionId, venueName: "Court 3", sport: "Futsal", region: "West", startAt: "2026-11-01T10:00:00.000Z",
        endAt: "2026-11-01T12:00:00.000Z", bookingShareCents: 900 },
    ]);
    expect(listInvitations).toHaveBeenCalledExactlyOnceWith(userId);
  });

  test("sends an acceptance the route accepts and reads the amount held", async () => {
    // Arrange
    forInvitee.mockResolvedValue({ sessionId, participationId, heldCents: 900, refundedParticipationId: participationId });

    // Act
    const result = await acceptReplacement({ sessionId, idempotencyKey: "accept-key" });

    // Assert
    expect(result).toEqual({ status: "accepted", heldCents: 900 });
    expect(forInvitee).toHaveBeenCalledExactlyOnceWith({ userId, sessionId, idempotencyKey: "accept-key" });
  });

  test("reads the route's rejections as definite", async () => {
    // Arrange
    const { DomainError } = await import("@/domain");
    forInvitee.mockRejectedValue(new DomainError("INSUFFICIENT_FUNDS", "Not enough available funds"));

    // Act & Assert
    expect(await acceptReplacement({ sessionId, idempotencyKey: "accept-key" }))
      .toMatchObject({ status: "error", code: "INSUFFICIENT_FUNDS", unconfirmed: false });
  });

  test("reads a missing invitation as definite", async () => {
    // Arrange
    const { DomainError } = await import("@/domain");
    forInvitee.mockRejectedValue(new DomainError("INVALID_ACCESS", "This user has no pending replacement invitation for this session"));

    // Act & Assert
    expect(await acceptReplacement({ sessionId, idempotencyKey: "accept-key" }))
      .toMatchObject({ status: "error", code: "INVALID_ACCESS", message: expect.stringContaining("no longer available"), unconfirmed: false });
  });
});
