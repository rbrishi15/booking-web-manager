import { beforeEach, describe, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { invalidRequest } from "@/app/http/request-failure";

const mocks = vi.hoisted(() => ({ getDependencies: vi.fn(), authenticate: vi.fn(), forBooker: vi.fn() }));
vi.mock("@/app/sessions/management-server-dependencies", () => ({ getSessionManagementDependencies: mocks.getDependencies }));
import { PATCH } from "@/app/api/sessions/[sessionId]/visibility/route";

const bookerId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(bookerId);
  mocks.forBooker.mockResolvedValue({ sessionId, visibility: "PRIVATE" });
  mocks.getDependencies.mockResolvedValue({ authenticate: mocks.authenticate, toggleVisibility: { forBooker: mocks.forBooker } });
});

describe("UC2-03a PATCH session visibility", () => {
  test("uses bearer identity and an explicit target, ignoring forged identities", async () => {
    const response = await invoke({ visibility: "PRIVATE", bookerId: "forged" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ sessionId, visibility: "PRIVATE" });
    expect(mocks.forBooker).toHaveBeenCalledExactlyOnceWith(bookerId, sessionId, "PRIVATE");
  });

  test("rejects absent identity before parsing the malformed body", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const response = await PATCH(request("{"), { params: Promise.resolve({ sessionId }) });
    expect(response.status).toBe(401);
    expect(mocks.forBooker).not.toHaveBeenCalled();
  });

  test.each([null, {}, { visibility: "public" }, { visibility: true }, { visibility: ["PUBLIC"] }])("rejects malformed input %j", async (body) => {
    expect((await invoke(body)).status).toBe(400);
    expect(mocks.forBooker).not.toHaveBeenCalled();
  });

  test("rejects malformed IDs and JSON", async () => {
    expect((await invoke({ visibility: "PUBLIC" }, "not-a-uuid")).status).toBe(400);
    expect((await PATCH(request("{"), { params: Promise.resolve({ sessionId }) })).status).toBe(400);
    expect(mocks.forBooker).not.toHaveBeenCalled();
  });

  test.each([
    ["INACTIVE_ACCOUNT", 403], ["UNAUTHORIZED", 403], ["NOT_FOUND", 404],
    ["CAPACITY_EXCEEDED", 409], ["SESSION_STARTED", 409], ["SESSION_CLOSED", 409],
  ] as const)("maps %s to %s", async (code, status) => {
    mocks.forBooker.mockRejectedValue(new DomainError(code, "Refused"));
    const response = await invoke({ visibility: "PUBLIC" });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code, message: "Refused" } });
  });

  test("maps configured unavailable capabilities to 503", async () => {
    mocks.authenticate.mockRejectedValue(new SessionManagementUnavailableError());
    const response = await invoke({ visibility: "PRIVATE" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "SESSION_MANAGEMENT_UNAVAILABLE" } });
  });

  test.each([new Error("private database URL"), new DomainError("INVALID_STATE", "private corrupt state")])("redacts infrastructure and unexpected domain failures", async (error) => {
    mocks.forBooker.mockRejectedValue(error);
    const response = await invoke({ visibility: "PUBLIC" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  test("redacts setup failures even if they resemble business or request failures", async () => {
    mocks.getDependencies.mockRejectedValueOnce(new DomainError("NOT_FOUND", "secret setup")).mockRejectedValueOnce(invalidRequest("secret setup"));
    expect((await invoke({ visibility: "PUBLIC" })).status).toBe(500);
    expect((await invoke({ visibility: "PUBLIC" })).status).toBe(500);
  });

  test("classifies body-read failures by origin instead of leaking their business code", async () => {
    const incoming = request("{}");
    vi.spyOn(incoming, "json").mockRejectedValue(new DomainError("NOT_FOUND", "private reader failure"));
    const response = await PATCH(incoming, { params: Promise.resolve({ sessionId }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  test("does not return success while transaction completion is still pending", async () => {
    let commit!: () => void;
    mocks.forBooker.mockImplementation(() => new Promise((resolve) => { commit = () => resolve({ sessionId, visibility: "PUBLIC" }); }));
    let completed = false;
    const pending = invoke({ visibility: "PUBLIC" }).then((response) => { completed = true; return response; });
    await vi.waitFor(() => expect(mocks.forBooker).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    commit();
    expect((await pending).status).toBe(200);
  });
});

function request(body: string) {
  return new Request(`http://localhost/api/sessions/${sessionId}/visibility`, { method: "PATCH", headers: { Authorization: "Bearer trusted", "Content-Type": "application/json" }, body });
}
function invoke(body: unknown, id = sessionId) {
  return PATCH(request(JSON.stringify(body)), { params: Promise.resolve({ sessionId: id }) });
}
