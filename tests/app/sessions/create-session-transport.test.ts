import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSession, searchVenues } from "@/app/sessions/create/transport";
import { createClient } from "@/lib/supabase/client";
import { emptySessionDraft, submissionPayload } from "@/app/sessions/create/model";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
const getSession = vi.fn();
const fetcher = vi.fn<typeof fetch>();
const userId = "wizard-user";
const payload = submissionPayload({ ...emptySessionDraft, venueName: "Court", region: "West", cost: "60", price: "12.01", startDate: "2045-06-17", startTime: "07:00", endDate: "2045-06-17", endTime: "08:00" }, "stable-key");
beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { access_token: "fixture-bearer", user: { id: userId } } }, error: null });
  vi.mocked(createClient).mockReturnValue({ auth: { getSession } } as unknown as ReturnType<typeof createClient>);
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());
test("sends the exact cent-valued payload through the bearer API", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ sessionId: "session", roomToken: "room", bookingShareCents: 1201 }, { status: 201 }));
  expect(await createSession(payload, userId)).toEqual({ status: "created" });
  expect(fetcher).toHaveBeenCalledWith("/api/sessions", expect.objectContaining({ method: "POST", body: JSON.stringify(payload), headers: { Authorization: "Bearer fixture-bearer", "Content-Type": "application/json" } }));
});
test.each([[409, "PAYOUT_ACCOUNT_NOT_READY", false], [422, "INVALID_INPUT", false], [401, "UNAUTHENTICATED", false], [503, "SESSION_API_UNAVAILABLE", false], [500, "INTERNAL_ERROR", true]])("classifies %s %s for safe retry", async (status, code, ambiguous) => {
  fetcher.mockResolvedValueOnce(Response.json({ error: { code, message: "private details" } }, { status }));
  const result = await createSession(payload, userId);
  expect(result).toMatchObject({ status: "error", code, ambiguous });
  expect(result).not.toHaveProperty("message", "private details");
});
test("treats network and malformed success responses as ambiguous", async () => {
  fetcher.mockRejectedValueOnce(new Error("private network details"));
  expect(await createSession(payload, userId)).toMatchObject({ status: "error", ambiguous: true });
  fetcher.mockResolvedValueOnce(Response.json({ broken: true }, { status: 201 }));
  expect(await createSession(payload, userId)).toMatchObject({ status: "error", ambiguous: true });
});
test("an expired local sign-in cannot send a creation request", async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  expect(await createSession(payload, userId)).toMatchObject({ code: "UNAUTHENTICATED", ambiguous: false });
  expect(fetcher).not.toHaveBeenCalled();
});
test("a different signed-in user cannot submit the original user's booking", async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: "other-bearer", user: { id: "other-user" } } }, error: null });
  expect(await createSession(payload, userId)).toMatchObject({ status: "error", code: "UNAUTHENTICATED", ambiguous: false });
  expect(fetcher).not.toHaveBeenCalled();
});
test("an account switch during the asynchronous session lookup cannot send a creation request", async () => {
  let resolveSession!: (value: unknown) => void;
  getSession.mockReturnValueOnce(new Promise((resolve) => { resolveSession = resolve; }));
  const outcome = createSession(payload, userId);
  expect(fetcher).not.toHaveBeenCalled();

  resolveSession({ data: { session: { access_token: "switched-bearer", user: { id: "switched-user" } } }, error: null });
  expect(await outcome).toMatchObject({ status: "error", code: "UNAUTHENTICATED", ambiguous: false });
  expect(fetcher).not.toHaveBeenCalled();
});
test("a newly mounted wizard can submit for its matching current user", async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: "current-bearer", user: { id: "current-user" } } }, error: null });
  fetcher.mockResolvedValueOnce(Response.json({ sessionId: "session", roomToken: "room", bookingShareCents: 1201 }, { status: 201 }));
  expect(await createSession(payload, "current-user")).toEqual({ status: "created" });
  expect(fetcher).toHaveBeenCalledWith("/api/sessions", expect.objectContaining({
    headers: { Authorization: "Bearer current-bearer", "Content-Type": "application/json" },
  }));
});
test("encodes lookup queries, authenticates, and propagates cancellation", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ items: [], nextPage: 2 }));
  const controller = new AbortController();
  expect(await searchVenues("Bukit & Court", 1, controller.signal)).toEqual({ items: [], nextPage: 2 });
  expect(fetcher).toHaveBeenCalledWith("/api/venues?q=Bukit+%26+Court&page=1", expect.objectContaining({ signal: controller.signal, headers: { Authorization: "Bearer fixture-bearer" } }));
});
