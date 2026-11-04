import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth }) }));
import { sessionEditingTransport } from "@/app/sessions/editing-transport";
import type { SessionEditingDetails } from "@/app/sessions/editing-contract";

const sessionId = "20000000-0000-4000-8000-000000000001";
const details: SessionEditingDetails = { sessionId, version: "a".repeat(64), totalSlots: 4, visibility: "PRIVATE", canEdit: true, bookingLocked: false, minimumSlots: 1,
  booking: { venueName: "Court", region: "West", sport: "Tennis", startAt: "2040-01-02T10:00:00.000Z", endAt: "2040-01-02T12:00:00.000Z", totalCostCents: 2000, pricePerSlotCents: 500 } };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { auth.getSession.mockResolvedValue({ data: { session: { access_token: "trusted" } }, error: null }); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

test("loads and saves the target with bearer authentication and explicit PATCH body", async () => {
  fetchMock.mockImplementation(async () => Response.json(details));
  expect(await sessionEditingTransport.load(sessionId)).toEqual(details);
  expect(await sessionEditingTransport.save(sessionId, details)).toEqual(details);
  expect(fetchMock.mock.calls[0]).toMatchObject([`/api/sessions/${sessionId}/edit`, { method: "GET", cache: "no-store", headers: { Authorization: "Bearer trusted" } }]);
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH", body: JSON.stringify(details) });
});

test("retains a conflict code so the editor can offer reload", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: { code: "STALE_SESSION", message: "Reload first" } }, { status: 409 }));
  await expect(sessionEditingTransport.save(sessionId, details)).rejects.toMatchObject({ code: "STALE_SESSION", reload: true, message: "Reload first" });
});

test("rejects a response for another session", async () => {
  fetchMock.mockResolvedValue(Response.json({ ...details, sessionId: "20000000-0000-4000-8000-000000000002" }));
  await expect(sessionEditingTransport.load(sessionId)).rejects.toMatchObject({ reload: true });
});

test("redacts infrastructure failure details", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: { code: "INTERNAL_ERROR", message: "secret database URL" } }, { status: 500 }));
  await expect(sessionEditingTransport.save(sessionId, details)).rejects.toThrow("We couldn't save the session. Please try again.");
});

test("requires a current token before saving", async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  await expect(sessionEditingTransport.save(sessionId, details)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("offers an authoritative reload when a save result is uncertain", async () => {
  fetchMock.mockRejectedValue(new TypeError("Network disconnected"));
  await expect(sessionEditingTransport.save(sessionId, details)).rejects.toMatchObject({ code: "UNKNOWN_RESULT", reload: true });
});

test("preserves accepted booking text exactly so locked legacy terms are not silently changed", async () => {
  fetchMock.mockResolvedValue(Response.json({ ...details, bookingLocked: true, booking: { ...details.booking, venueName: "Court " } }));
  expect((await sessionEditingTransport.load(sessionId)).booking.venueName).toBe("Court ");
});
