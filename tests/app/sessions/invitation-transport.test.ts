import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadSessionInvitation } from "@/app/sessions/invitation-transport";

const fetcher = vi.fn<typeof fetch>();
const sessionId = "20000000-0000-4000-8000-000000000001";
const path = `/sessions/${sessionId}/join?token=exact%20token%2Bvalue`;

beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => vi.unstubAllGlobals());

test("reads the exact owner's link with cookies and no caching", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ invitationPath: path }));
  expect(await loadSessionInvitation(sessionId)).toEqual({ status: "ready", invitationPath: path });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/sessions/${sessionId}/invitation`,
    expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
});

test("cancels an invitation-link read with its React Query signal", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ invitationPath: path }));
  const controller = new AbortController();
  await loadSessionInvitation(sessionId, controller.signal);
  controller.abort();
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

test.each([
  "https://elsewhere.example/invitation", "//elsewhere.example/invitation", "/sessions/another/join?token=secret",
  `/sessions/${sessionId}/join`, `/sessions/${sessionId}/join?token=one&token=two`, `${path}#fragment`,
])("rejects a malformed or foreign invitation response: %s", async (invitationPath) => {
  fetcher.mockResolvedValueOnce(Response.json({ invitationPath }));
  expect(await loadSessionInvitation(sessionId)).toEqual({ status: "error", signIn: false,
    message: "We couldn't load the invitation link. Please try again." });
});

test("retains login recovery for a non-JSON unauthorized response", async () => {
  fetcher.mockResolvedValueOnce(new Response("gateway", { status: 401 }));
  expect(await loadSessionInvitation(sessionId)).toMatchObject({ status: "error", signIn: true });
});

test.each([[403, "UNAUTHORIZED"], [409, "SESSION_STARTED"], [409, "SESSION_CLOSED"], [404, "NOT_FOUND"], [503, "SESSION_MANAGEMENT_UNAVAILABLE"]])(
  "maps %i %s without showing private server messages", async (status, code) => {
    fetcher.mockResolvedValueOnce(Response.json({ error: { code, message: "private token and database detail" } }, { status }));
    const result = await loadSessionInvitation(sessionId);
    expect(result).toMatchObject({ status: "error", signIn: false });
    expect(JSON.stringify(result)).not.toContain("private token");
  },
);

test("network failure is retryable and does not disclose its exception", async () => {
  fetcher.mockRejectedValueOnce(new Error("secret-token"));
  expect(await loadSessionInvitation(sessionId)).toEqual({ status: "error", signIn: false,
    message: "We couldn't load the invitation link. Please try again." });
});
