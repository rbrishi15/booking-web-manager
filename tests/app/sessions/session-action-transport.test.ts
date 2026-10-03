import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { executeSessionVisibility, loadCancellationPreview, executeSessionCancellation } from "@/app/sessions/session-action-transport";
import { cancelSessionAction, previewSessionCancellationAction, toHostedSessionActions, withCancellationAction } from "@/app/sessions/session-actions";
import { createClient } from "@/lib/supabase/client";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
const getSession = vi.fn();
const fetcher = vi.fn<typeof fetch>();
const sessionId = "20000000-0000-4000-8000-000000000001";
const previewVersion = "a".repeat(64);
const submission = { idempotencyKey: "stable-request", previewVersion };

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { access_token: "fixture-bearer" } }, error: null });
  vi.mocked(createClient).mockReturnValue({ auth: { getSession } } as unknown as ReturnType<typeof createClient>);
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());

test("visibility follows the advertised target, method and fixed state transition", async () => {
  const action = toHostedSessionActions(sessionId, [{ name: "set-visibility", visibility: "PRIVATE" }])[0]!;
  if (action.name !== "set-visibility") throw new Error("Missing fixture action");
  fetcher.mockResolvedValueOnce(Response.json({ sessionId, visibility: "PRIVATE" }));
  expect(await executeSessionVisibility({ ...action, href: `${action.href}?advertised=1` })).toEqual({ status: "saved", sessionId, visibility: "PRIVATE" });
  expect(fetcher).toHaveBeenCalledWith(`${action.href}?advertised=1`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ visibility: "PRIVATE" }) }));
});

test("preview follows its advertised read action and retains the returned confirmation action", async () => {
  const preview = withCancellationAction({ sessionId, affectedParticipantCount: 2, refundRecipientCount: 1, totalRefundCents: 500, previewVersion });
  fetcher.mockResolvedValueOnce(Response.json(preview));
  const action = { ...previewSessionCancellationAction(sessionId), href: `/api/sessions/${sessionId}/cancellation-preview?advertised=1` };
  expect(await loadCancellationPreview(sessionId, action)).toEqual({ status: "ready", preview });
  expect(fetcher).toHaveBeenCalledWith(action.href, expect.objectContaining({ method: "GET", cache: "no-store" }));
});

test("confirmation submits the preview-bound input and user-generated idempotency key", async () => {
  const action = cancelSessionAction(sessionId, previewVersion);
  fetcher.mockResolvedValueOnce(Response.json({ sessionId, status: "CANCELLED", totalRefundCents: 500, refundRecipientCount: 1 }));
  expect(await executeSessionCancellation(sessionId, submission, { ...action, href: `${action.href}?advertised=1` })).toMatchObject({ status: "cancelled" });
  expect(fetcher).toHaveBeenCalledWith(`${action.href}?advertised=1`, expect.objectContaining({ method: "POST", body: JSON.stringify(submission) }));
});

test("recovery can retry the stored request after its session action disappears", async () => {
  fetcher.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValueOnce(Response.json({ sessionId, status: "CANCELLED", totalRefundCents: 500, refundRecipientCount: 1 }));
  expect(await executeSessionCancellation(sessionId, submission)).toMatchObject({ status: "error", retrySameRequest: true });
  expect(await executeSessionCancellation(sessionId, submission)).toMatchObject({ status: "cancelled" });
  expect(fetcher.mock.calls.map((call) => call[1]?.body)).toEqual([JSON.stringify(submission), JSON.stringify(submission)]);
});

test("an expired identity after an ambiguous result keeps the original cancellation replayable", async () => {
  fetcher.mockRejectedValueOnce(new Error("Response lost"));
  expect(await executeSessionCancellation(sessionId, submission)).toMatchObject({ status: "error", retrySameRequest: true });

  getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
  expect(await executeSessionCancellation(sessionId, submission)).toMatchObject({ code: "UNAUTHENTICATED", retrySameRequest: true });
  expect(fetcher).toHaveBeenCalledTimes(1);

  fetcher.mockResolvedValueOnce(Response.json({ sessionId, status: "CANCELLED", totalRefundCents: 500, refundRecipientCount: 1 }));
  expect(await executeSessionCancellation(sessionId, submission)).toMatchObject({ status: "cancelled" });
  expect(fetcher.mock.calls.map((call) => call[1]?.body)).toEqual([JSON.stringify(submission), JSON.stringify(submission)]);
});

test.each([[401, "UNAUTHENTICATED"], [403, "INACTIVE_ACCOUNT"], [403, "UNAUTHORIZED"]])("access rejection %s %s cannot resolve a saved cancellation result", async (status, code) => {
  fetcher.mockResolvedValueOnce(Response.json({ error: { code, message: "Access is unavailable." } }, { status }));

  expect(await executeSessionCancellation(sessionId, submission)).toMatchObject({ status: "error", code, retrySameRequest: true });
});

test.each([["STALE_CANCELLATION_PREVIEW", false], ["IDEMPOTENCY_IN_FLIGHT", true]])("%s preserves the correct recovery choice", async (code, retrySameRequest) => {
  fetcher.mockResolvedValueOnce(Response.json({ error: { code, message: "Review the session again." } }, { status: 409 }));
  expect(await executeSessionCancellation(sessionId, submission)).toMatchObject({ status: "error", code, refresh: true, retrySameRequest });
});

test("an expired sign-in sends no management request", async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  expect(await executeSessionCancellation(sessionId, submission)).toMatchObject({ status: "error", code: "UNAUTHENTICATED" });
  expect(fetcher).not.toHaveBeenCalled();
});
