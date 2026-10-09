import { beforeEach, describe, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { openApiDocument } from "@/app/openapi";
import { hostedSessionsResponseSchema } from "@/app/sessions/hosted-sessions-response";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";

const mocks = vi.hoisted(() => ({ getDependencies: vi.fn(), authenticate: vi.fn(), forBooker: vi.fn(), attendanceDueForBooker: vi.fn() }));
vi.mock("@/app/sessions/management-server-dependencies", () => ({ getSessionManagementDependencies: mocks.getDependencies }));
import { GET } from "@/app/api/sessions/hosted/route";

const bookerId = "10000000-0000-4000-8000-000000000001";
const hosted = (index: number) => ({
  sessionId: `session-${index}`, venueName: "West sports hall", sport: "Tennis", region: "West",
  startAt: new Date("2042-08-02T10:00:00Z"), endAt: new Date("2042-08-02T12:00:00Z"),
  visibility: "PRIVATE" as const, availableSlots: index === 0 ? 0 : 3,
  actions: index === 0 ? [{ name: "preview-cancellation" as const }] : [{ name: "set-visibility" as const, visibility: "PUBLIC" as const }, { name: "preview-cancellation" as const }],
  roomToken: "must-not-leak", participations: ["must-not-leak"],
});
const attendanceDue = {
  sessionId: "ended", venueName: "Bishan Sports Hall", sport: "Badminton",
  startAt: new Date("2042-08-01T10:00:00Z"), endAt: new Date("2042-08-01T12:00:00Z"), unverifiedCount: 3,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(bookerId);
  mocks.forBooker.mockResolvedValue([]);
  mocks.attendanceDueForBooker.mockResolvedValue([]);
  mocks.getDependencies.mockResolvedValue({
    authenticate: mocks.authenticate,
    toggleVisibility: { forBooker: vi.fn() },
    listHostedSessions: { forBooker: mocks.forBooker, attendanceDueForBooker: mocks.attendanceDueForBooker },
  });
});

const invoke = () => GET(new Request("http://localhost/api/sessions/hosted", { headers: { Authorization: "Bearer fixture" } }));

describe("UC2-03 / UC2-06 GET hosted sessions", () => {
  test("rejects a missing identity before reading sessions", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const response = await invoke();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(mocks.forBooker).not.toHaveBeenCalled();
  });

  test("serializes only display fields and actions, without limiting the booker's list", async () => {
    mocks.forBooker.mockResolvedValue(Array.from({ length: 21 }, (_, index) => hosted(index)));
    mocks.attendanceDueForBooker.mockResolvedValue([attendanceDue]);
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(mocks.forBooker).toHaveBeenCalledExactlyOnceWith(bookerId);
    expect(mocks.attendanceDueForBooker).toHaveBeenCalledExactlyOnceWith(bookerId);
    expect(body.sessions).toHaveLength(21);
    expect(body.sessions[0]).toEqual({
      sessionId: "session-0", venueName: "West sports hall", sport: "Tennis", region: "West",
      startAt: "2042-08-02T10:00:00.000Z", endAt: "2042-08-02T12:00:00.000Z",
      visibility: "PRIVATE", availableSlots: 0,
      actions: [{ name: "preview-cancellation", href: "/api/sessions/session-0/cancellation-preview", method: "GET", inputs: {} }],
    });
    expect(body.awaitingAttendance).toEqual([{
      sessionId: "ended", venueName: "Bishan Sports Hall", sport: "Badminton",
      startAt: "2042-08-01T10:00:00.000Z", endAt: "2042-08-01T12:00:00.000Z", unverifiedCount: 3,
    }]);
    // The browser validates the reply with the same schema the OpenAPI document publishes.
    expect(hostedSessionsResponseSchema.safeParse(body).success).toBe(true);
  });

  test("still returns the hosted sessions when only the attendance-due list fails", async () => {
    mocks.forBooker.mockResolvedValue([hosted(1)]);
    mocks.attendanceDueForBooker.mockRejectedValue(new Error("Temporary database outage"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessions: [{ sessionId: "session-1" }], awaitingAttendance: [] });
    expect(logged).toHaveBeenCalledWith("UC2-06 attendance-due list failed:", "Error");
  });

  test.each([["INACTIVE_ACCOUNT", 403], ["NOT_FOUND", 404]] as const)("reports %s from the attendance-due list instead of hiding it", async (code, status) => {
    mocks.attendanceDueForBooker.mockRejectedValue(new DomainError(code, "Account denied"));
    const response = await invoke();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message: "Account denied" } });
  });

  test.each([["INACTIVE_ACCOUNT", 403], ["NOT_FOUND", 404]] as const)("maps %s from the hosted list to %s", async (code, status) => {
    mocks.forBooker.mockRejectedValue(new DomainError(code, "Account denied"));
    expect((await invoke()).status).toBe(status);
  });

  test("maps configured unavailable capabilities to 503", async () => {
    mocks.authenticate.mockRejectedValue(new SessionManagementUnavailableError());
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "SESSION_MANAGEMENT_UNAVAILABLE" } });
  });

  test("keeps dependency setup failures opaque", async () => {
    mocks.getDependencies.mockRejectedValue(new DomainError("NOT_FOUND", "secret setup"));
    expect((await invoke()).status).toBe(500);
  });

  test("redacts unexpected failures", async () => {
    mocks.forBooker.mockRejectedValue(new Error("private infrastructure detail"));
    const response = await invoke();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  test("is published in the OpenAPI document with every response status", () => {
    const operation = openApiDocument.paths["/api/sessions/hosted"]?.get;
    expect(operation?.operationId).toBe("listHostedSessions");
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "401", "403", "404", "500", "503"]);
  });
});
