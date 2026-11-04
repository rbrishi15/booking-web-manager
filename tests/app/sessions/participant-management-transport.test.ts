import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as apiTransport from "@/app/sessions/participant-management-transport";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession: mocks.getSession } }) }));
const fetcher = vi.fn<typeof fetch>();
const sessionId = "20000000-0000-4000-8000-000000000001";
const participationId = "30000000-0000-4000-8000-000000000001";
const idempotencyKey = "40000000-0000-4000-8000-000000000001";
const previewVersion = "a".repeat(64);

beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", fetcher);
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "owner-token" } }, error: null });
});
afterEach(() => vi.unstubAllGlobals());


test("loads invitation options through authenticated uncached HTTP with query cancellation", async () => {
  fetcher.mockResolvedValue(Response.json({ groups: [], invitations: [] }));
  const controller = new AbortController();
  const result = await apiTransport.loadParticipantInvitationOptions(sessionId, controller.signal);
  expect(result).toEqual({ groups: [], invitations: [] });
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe(`/api/sessions/${sessionId}/invitations`);
  expect(options).toMatchObject({ credentials: "same-origin", cache: "no-store", headers: { Authorization: "Bearer owner-token" } });
  controller.abort();
  expect(options?.signal?.aborted).toBe(true);
});

test.each([
  { source: "direct" as const, handles: ["alice_01"] },
  { source: "group" as const, groupId: participationId, userIds: [idempotencyKey] },
])("sends the chosen invitation source once over POST: %j", async (selection) => {
  fetcher.mockResolvedValue(Response.json({ invited: 1, alreadyInvited: 0, alreadyParticipating: 0 }));
  expect(await apiTransport.sendParticipantInvitations(sessionId, selection)).toEqual({ invited: 1, alreadyInvited: 0, alreadyParticipating: 0 });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/sessions/${sessionId}/invitations`, expect.objectContaining({ method: "POST", body: JSON.stringify(selection) }));
});

test("lookup maps the existing exact-user HTTP projection to self detection", async () => {
  fetcher.mockResolvedValue(Response.json({ user: { userId: idempotencyKey, handle: "alice_01", displayName: "Alice" } }));
  const result = await apiTransport.findParticipantPlayer(" @Alice_01 ", idempotencyKey);
  expect(result).toEqual({ status: "found", player: { handle: "alice_01", displayName: "Alice", reliabilityScore: null, isSelf: true } });
  expect(fetcher.mock.calls[0]![0]).toBe("/api/users/alice_01");
});

test("lookup reports an unknown exact user ID", async () => {
  fetcher.mockResolvedValue(Response.json({ error: { code: "NOT_FOUND", message: "Nobody" } }, { status: 404 }));
  expect(await apiTransport.findParticipantPlayer("alice_01", idempotencyKey)).toEqual({ status: "not-found", handle: "alice_01" });
});

test("validates private response shapes rather than presenting malformed success", async () => {
  fetcher.mockResolvedValue(Response.json({ groups: [], invitations: [{ inviteeId: "bad" }] }));
  await expect(apiTransport.loadParticipantInvitationOptions(sessionId)).rejects.toMatchObject({ code: "UNKNOWN_RESULT" });
});

test("retains the exact removal payload for caller-controlled retries", async () => {
  fetcher.mockRejectedValueOnce(new Error("network secret"));
  fetcher.mockResolvedValueOnce(Response.json({ sessionId, participationId, status: "REMOVED", refundCents: 1200 }));
  const api = apiTransport;
  const submission = { idempotencyKey, previewVersion };
  await expect(api.removeParticipantViaApi(sessionId, participationId, submission)).rejects.toMatchObject({ code: "UNKNOWN_RESULT" });
  expect(await api.removeParticipantViaApi(sessionId, participationId, submission)).toEqual({ sessionId, participationId, status: "REMOVED", refundCents: 1200 });
  expect(fetcher.mock.calls.map(([, options]) => options?.body)).toEqual([JSON.stringify(submission), JSON.stringify(submission)]);
});

test("rejects a response for another removal target as an unresolved result", async () => {
  fetcher.mockResolvedValue(Response.json({ sessionId, participationId: idempotencyKey, status: "REMOVED", refundCents: 1200 }));
  await expect(apiTransport.removeParticipantViaApi(sessionId, participationId, { idempotencyKey, previewVersion })).rejects.toMatchObject({ code: "UNKNOWN_RESULT" });
});

test("does not send requests after sign-out or leak non-JSON gateway details", async () => {
  mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
  const api = apiTransport;
  await expect(api.loadParticipantInvitationOptions(sessionId)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce(new Response("private provider response", { status: 503 }));
  await expect(api.loadParticipantInvitationOptions(sessionId)).rejects.toMatchObject({ status: 503, message: "We couldn't complete this request. Please try again." });
});
