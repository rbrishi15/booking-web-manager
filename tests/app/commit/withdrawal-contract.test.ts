import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createClient } from "@/lib/supabase/client";
import { commitmentDependencies } from "./commitment-test-dependencies";

const mocks = vi.hoisted(() => ({ commitment: vi.fn(), preview: vi.fn() }));
vi.mock("@/app/commit/commitment-server-dependencies", () => ({ getCommitmentDependencies: mocks.commitment }));
vi.mock("@/app/commit/withdrawal-preview-server-dependencies", () => ({ getWithdrawalPreviewDependencies: mocks.preview }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { GET as previewRoute } from "@/app/api/sessions/[sessionId]/withdrawal-preview/route";
import { POST as withdrawRoute } from "@/app/api/sessions/withdraw/route";
import { POST as leaveRoute } from "@/app/api/sessions/waitlist/leave/route";
import { leaveWaitlist, previewWithdrawal, withdrawFromSession } from "@/app/commit/withdrawal-transport";

const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "11111111-1111-4111-8111-111111111111";
const participationId = "22222222-2222-4222-8222-222222222222";
const inviteeId = "33333333-3333-4333-8333-333333333333";

/** Sends the screen's requests to the real route handlers instead of the network. */
function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(new URL(String(input), "http://localhost"), init);
  const path = new URL(request.url).pathname;
  if (path === "/api/sessions/withdraw") return withdrawRoute(request);
  if (path === "/api/sessions/waitlist/leave") return leaveRoute(request);
  const match = /^\/api\/sessions\/([^/]+)\/withdrawal-preview$/.exec(path);
  if (match) return previewRoute(request, { params: Promise.resolve({ sessionId: decodeURIComponent(match[1]!) }) });
  throw new Error(`No route for ${path}`);
}

describe("UC2-05 withdrawal transport against the real routes", () => {
  const forParticipant = { preview: vi.fn(), withdraw: vi.fn(), leave: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockReturnValue({
      auth: { getSession: async () => ({ data: { session: { access_token: "player-token" } }, error: null }) },
    } as unknown as ReturnType<typeof createClient>);
    vi.stubGlobal("fetch", vi.fn(routeFetch));
    const authenticate = async (request: Request) => request.headers.get("authorization") === "Bearer player-token" ? userId : null;
    mocks.preview.mockResolvedValue({ authenticate, previewWithdrawal: { forParticipant: forParticipant.preview } });
    mocks.commitment.mockResolvedValue(commitmentDependencies({
      authenticate, withdrawFromSession: { forParticipant: forParticipant.withdraw }, leaveWaitlist: { forParticipant: forParticipant.leave },
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  test("reads the preview the route returns", async () => {
    forParticipant.preview.mockResolvedValue({ sessionId, participationId, kind: "REFUNDED", refundCents: 1250, heldCents: 1250 });

    expect(await previewWithdrawal(sessionId)).toEqual({ status: "ready", preview: { kind: "REFUNDED", refundCents: 1250, heldCents: 1250 } });
    expect(forParticipant.preview).toHaveBeenCalledExactlyOnceWith(userId, sessionId);
  });

  test("sends a withdrawal the route accepts and reads its result", async () => {
    forParticipant.withdraw.mockResolvedValue({ kind: "AWAITING_REPLACEMENT", sessionId, participationId, refundedCents: 0, promotion: { status: "NOT_NEEDED" } });
    const request = { sessionId, idempotencyKey: "withdraw-key", replacement: { mode: "DIRECT_INVITE" as const, inviteeId } };

    expect(await withdrawFromSession(request)).toEqual({ status: "withdrawn", kind: "AWAITING_REPLACEMENT", refundedCents: 0 });
    expect(forParticipant.withdraw).toHaveBeenCalledExactlyOnceWith({ userId, ...request });
  });

  test("sends a waitlist departure the route accepts", async () => {
    forParticipant.leave.mockResolvedValue({ sessionId, participationId, promotion: { status: "DEFERRED" } });

    expect(await leaveWaitlist({ sessionId, idempotencyKey: "leave-key" })).toEqual({ status: "left" });
    expect(forParticipant.leave).toHaveBeenCalledExactlyOnceWith({ userId, sessionId, idempotencyKey: "leave-key" });
  });

  test("reads the route's rejections as definite", async () => {
    const { DomainError } = await import("@/domain");
    forParticipant.withdraw.mockRejectedValue(new DomainError("SESSION_STARTED", "The session has started"));
    forParticipant.preview.mockRejectedValue(new DomainError("INVALID_STATE", "Only a committed participant can withdraw"));

    expect(await withdrawFromSession({ sessionId, idempotencyKey: "k", replacement: { mode: "OPEN_SLOT" } }))
      .toMatchObject({ status: "error", code: "SESSION_STARTED", unconfirmed: false });
    expect(await previewWithdrawal(sessionId)).toMatchObject({ status: "error", message: expect.stringContaining("already changed") });
  });
});
