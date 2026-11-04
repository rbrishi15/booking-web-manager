import { beforeEach, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { openApiDocument } from "@/app/openapi";

const mocks = vi.hoisted(() => ({ getDependencies: vi.fn(), authenticate: vi.fn(), forBooker: vi.fn() }));
vi.mock("@/app/sessions/invitation-server-dependencies", () => ({ getSessionInvitationDependencies: mocks.getDependencies }));
import { GET } from "@/app/api/sessions/[sessionId]/invitation/route";

const bookerId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(bookerId);
  mocks.forBooker.mockResolvedValue({ sessionId, roomToken: " MiXeD +/?#% token " });
  mocks.getDependencies.mockResolvedValue({ authenticate: mocks.authenticate, invitation: { forBooker: mocks.forBooker } });
});

test("uses authenticated identity and returns only a relative encoded invitation path without trusting query identity or origin", async () => {
  const incoming = new Request(`https://untrusted.example/api/sessions/${sessionId}/invitation?bookerId=forged`, { headers: { authorization: "Bearer trusted" } });
  const response = await GET(incoming, { params: Promise.resolve({ sessionId }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json();
  expect(result).toEqual({ invitationPath: `/sessions/${sessionId}/join?token=%20MiXeD%20%2B%2F%3F%23%25%20token%20` });
  expect(new URL(result.invitationPath, "https://trusted.example").searchParams.get("token")).toBe(" MiXeD +/?#% token ");
  expect(mocks.forBooker).toHaveBeenCalledExactlyOnceWith(bookerId, sessionId);
});

test("authenticates before parsing and never invokes the use case for anonymous callers", async () => {
  mocks.authenticate.mockResolvedValue(null);
  expect((await invoke("bad-id")).status).toBe(401);
  expect(mocks.forBooker).not.toHaveBeenCalled();
});

test("rejects malformed session IDs before looking up an invitation", async () => {
  const response = await invoke("bad-id");
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.forBooker).not.toHaveBeenCalled();
});

test.each([
  ["INACTIVE_ACCOUNT", 403], ["UNAUTHORIZED", 403], ["NOT_FOUND", 404],
  ["SESSION_STARTED", 409], ["SESSION_CLOSED", 409],
] as const)("maps %s without caching a sensitive response", async (code, status) => {
  mocks.forBooker.mockRejectedValue(new DomainError(code, "Refused"));
  const response = await invoke();
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: { code, message: "Refused" } });
});

test("returns configured unavailability and redacts unexpected failures", async () => {
  mocks.forBooker.mockRejectedValueOnce(new SessionManagementUnavailableError()).mockRejectedValueOnce(new Error("private token/database detail"));
  expect((await invoke()).status).toBe(503);
  const response = await invoke();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
});

test("publishes only the owner invitation API with both authentication methods", () => {
  const operation = openApiDocument.paths["/api/sessions/{sessionId}/invitation"]?.get;
  expect(operation?.operationId).toBe("getSessionInvitation");
  expect(operation?.security).toEqual([{ bearerAuth: [] }, { loginCookie: [] }]);
  expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "400", "401", "403", "404", "409", "500", "503"]);
  expect(operation?.parameters).toEqual([expect.objectContaining({ name: "sessionId", in: "path", required: true, schema: { type: "string", format: "uuid" } })]);
  expect(openApiDocument.components?.schemas?.SessionInvitation).toMatchObject({ required: ["invitationPath"], properties: { invitationPath: { type: "string" } } });
  expect(Object.keys(openApiDocument.paths).filter((path) => /invitation|invited/.test(path))).toEqual(["/api/sessions/{sessionId}/invitation", "/api/sessions/{sessionId}/invitations"]);
});

function invoke(id = sessionId) {
  return GET(new Request(`http://localhost/api/sessions/${id}/invitation`), { params: Promise.resolve({ sessionId: id }) });
}
