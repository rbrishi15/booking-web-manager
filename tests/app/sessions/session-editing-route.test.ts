import { beforeEach, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";

const mocks = vi.hoisted(() => ({ getDependencies: vi.fn(), authenticate: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/app/sessions/editing-server-dependencies", () => ({ getSessionEditingDependencies: mocks.getDependencies }));
import { GET, PATCH } from "@/app/api/sessions/[sessionId]/edit/route";

const bookerId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const payload = { version: "a".repeat(64), totalSlots: 4, visibility: "PRIVATE", booking: {
  venueName: "Court", region: "West", sport: "Tennis", startAt: "2040-01-02T10:00:00.000Z",
  endAt: "2040-01-02T12:00:00.000Z", totalCostCents: 2000, pricePerSlotCents: 500,
} };
const context = { params: Promise.resolve({ sessionId }) };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(bookerId);
  mocks.load.mockResolvedValue({ ...payload, sessionId, canEdit: true, bookingLocked: false, minimumSlots: 1 });
  mocks.save.mockImplementation(async () => mocks.load());
  mocks.getDependencies.mockResolvedValue({ authenticate: mocks.authenticate,
    editSession: { detailsForBooker: mocks.load, forBooker: mocks.save } });
});

function request(body: unknown = payload) { return new Request(`http://localhost/api/sessions/${sessionId}/edit`, {
  method: "PATCH", headers: { Authorization: "Bearer trusted", "Content-Type": "application/json" }, body: JSON.stringify(body),
}); }

test("loads owner-only editing facts without caching", async () => {
  const response = await GET(new Request(`http://localhost/api/sessions/${sessionId}/edit`), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ sessionId, bookingLocked: false });
  expect(mocks.load).toHaveBeenCalledWith(bookerId, sessionId);
});

test("saves with authenticated identity, stripping forged account fields", async () => {
  const response = await PATCH(request({ ...payload, bookerId: "forged" }), context);
  expect(response.status).toBe(200);
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(bookerId, sessionId, payload);
});

test.each([null, {}, { ...payload, version: "bad" }, { ...payload, totalSlots: 0 },
  { ...payload, booking: { ...payload.booking, venueName: " " } },
  { ...payload, booking: { ...payload.booking, startAt: "not a date" } },
  { ...payload, booking: { ...payload.booking, pricePerSlotCents: 0 } },
])("rejects malformed editing request %j", async (body) => {
  expect((await PATCH(request(body), context)).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});

test("requires authentication before reading or saving", async () => {
  mocks.authenticate.mockResolvedValue(null);
  expect((await GET(request(), context)).status).toBe(401);
  expect((await PATCH(request(), context)).status).toBe(401);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
});

test.each([["UNAUTHORIZED", 403], ["INACTIVE_ACCOUNT", 403], ["NOT_FOUND", 404],
  ["SESSION_STARTED", 409], ["SESSION_CLOSED", 409], ["SESSION_DETAILS_LOCKED", 409],
  ["STALE_SESSION", 409], ["CAPACITY_EXCEEDED", 409], ["INVALID_INPUT", 400]] as const)("maps %s to %i", async (code, status) => {
  mocks.save.mockRejectedValue(new DomainError(code, "Cannot save"));
  const response = await PATCH(request(), context);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code, message: "Cannot save" } });
});

test("redacts unexpected database failures", async () => {
  mocks.save.mockRejectedValue(new Error("private connection string"));
  const response = await PATCH(request(), context);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
});
