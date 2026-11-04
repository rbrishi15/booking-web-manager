import { beforeEach, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { openApiDocument } from "@/app/openapi";
import * as invitationApi from "@/app/api/sessions/[sessionId]/invitations/route";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { createSessionInvitationManagementDependencies } from "@/use-case-config/session-invitations";

const mocks = vi.hoisted(() => ({ dependencies: vi.fn(), authenticate: vi.fn(), optionsForBooker: vi.fn(), inviteByHandles: vi.fn(), inviteFromGroup: vi.fn() }));
vi.mock("@/app/sessions/session-invitation-server-dependencies", () => ({ getSessionInvitationManagementDependencies: mocks.dependencies }));
vi.mock("@/app/sessions/server-environment", () => ({ readSessionServerSettings: () => undefined }));

const hostId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const groupId = "30000000-0000-4000-8000-000000000001";
const userId = "40000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ sessionId }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(hostId);
  mocks.optionsForBooker.mockResolvedValue({ groups: [], invitations: [{ inviteeId: userId, displayName: "Alice", handle: "alice_01", status: "PENDING", invitedAt: new Date("2030-01-01T00:00:00Z") }] });
  mocks.inviteByHandles.mockResolvedValue({ invited: 1, alreadyInvited: 0, alreadyParticipating: 0 });
  mocks.inviteFromGroup.mockResolvedValue({ invited: 0, alreadyInvited: 1, alreadyParticipating: 0 });
  mocks.dependencies.mockResolvedValue({ authenticate: mocks.authenticate, invitations: mocks });
});


function request(body?: unknown) {
  return new Request(`http://localhost/api/sessions/${sessionId}/invitations?hostId=forged`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("documents invitation management and authoritative participant capacity", () => {
  const path = openApiDocument.paths["/api/sessions/{sessionId}/invitations"];
  expect(path?.get?.operationId).toBe("getSessionInvitationOptions");
  expect(path?.post?.operationId).toBe("sendSessionInvitations");
  expect(path?.get?.security).toEqual([{ bearerAuth: [] }, { loginCookie: [] }]);
  expect(path?.post?.security).toEqual([{ bearerAuth: [] }]);
  for (const operation of [path?.get, path?.post]) {
    expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "400", "401", "403", "404", "409", "500", "503"]);
  }
  expect(openApiDocument.components?.schemas?.SessionParticipants).toMatchObject({
    required: expect.arrayContaining(["totalSlots"]), properties: { totalSlots: { type: "integer", minimum: 0 } },
  });
});

test("GET serializes invitation dates and only uses authenticated owner identity", async () => {
  const response = await invitationApi.GET(request(), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ groups: [], invitations: [{ inviteeId: userId, displayName: "Alice", handle: "alice_01", status: "PENDING", invitedAt: "2030-01-01T00:00:00.000Z" }] });
  expect(mocks.optionsForBooker).toHaveBeenCalledExactlyOnceWith(hostId, sessionId);
});

test.each([
  [{ source: "direct", handles: ["alice_01"] }, { invited: 1, alreadyInvited: 0, alreadyParticipating: 0 }],
  [{ source: "group", groupId, userIds: [userId] }, { invited: 0, alreadyInvited: 1, alreadyParticipating: 0 }],
])("POST sends the selected source and preserves duplicate outcomes: %j", async (body, result) => {
  const response = await invitationApi.POST(request(body), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(result);
  if (body.source === "direct") expect(mocks.inviteByHandles).toHaveBeenCalledExactlyOnceWith(hostId, sessionId, ["alice_01"]);
  else expect(mocks.inviteFromGroup).toHaveBeenCalledExactlyOnceWith(hostId, sessionId, groupId, [userId]);
});

test.each([
  {}, { source: "other", handles: ["alice_01"] }, { source: "direct", handles: [] },
  { source: "direct", handles: Array.from({ length: 51 }, (_, index) => `alice_${index}`) },
  { source: "direct", handles: ["bad space"] },
  { source: "direct", handles: ["alice_01"], hostId: "forged" },
  { source: "group", groupId: "invalid", userIds: [userId] },
  { source: "group", groupId, userIds: ["invalid"] },
])("rejects malformed invitation input without dispatch: %j", async (body) => {
  const response = await invitationApi.POST(request(body), context);
  expect(response.status).toBe(400);
  expect(mocks.inviteByHandles).not.toHaveBeenCalled();
  expect(mocks.inviteFromGroup).not.toHaveBeenCalled();
});

test.each(["GET", "POST"] as const)("%s authenticates before parsing private inputs", async (method) => {
  mocks.authenticate.mockResolvedValue(null);
  const response = await invitationApi[method](request(method === "POST" ? {} : undefined), { params: Promise.resolve({ sessionId: "invalid" }) });
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.optionsForBooker).not.toHaveBeenCalled();
  expect(mocks.inviteByHandles).not.toHaveBeenCalled();
});

test.each(["GET", "POST"] as const)("%s rejects malformed session IDs", async (method) => {
  const response = await invitationApi[method](request(method === "POST" ? { source: "direct", handles: ["alice_01"] } : undefined), { params: Promise.resolve({ sessionId: "invalid" }) });
  expect(response.status).toBe(400);
});

test.each([["UNAUTHORIZED", 403], ["INACTIVE_ACCOUNT", 403], ["NOT_FOUND", 404], ["INVALID_INPUT", 400], ["SESSION_CLOSED", 409], ["SESSION_STARTED", 409]] as const)("maps %s to %s without caching private errors", async (code, status) => {
  mocks.optionsForBooker.mockRejectedValue(new DomainError(code, "Denied"));
  mocks.inviteByHandles.mockRejectedValue(new DomainError(code, "Denied"));
  const api = invitationApi;
  for (const response of [await api.GET(request(), context), await api.POST(request({ source: "direct", handles: ["alice_01"] }), context)]) {
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code, message: "Denied" } });
  }
});

test("rejects malformed JSON and redacts infrastructure failures", async () => {
  const api = invitationApi;
  const invalid = new Request(request({}), { body: "{" });
  expect((await api.POST(invalid, context)).status).toBe(400);
  mocks.optionsForBooker.mockRejectedValue(new Error("private database detail"));
  const response = await api.GET(request(), context);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
});

test("reports unavailable server settings as a retryable API failure", async () => {
  mocks.dependencies.mockResolvedValue(createSessionInvitationManagementDependencies());
  const response = await invitationApi.GET(request(), context);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ error: { code: "SESSION_MANAGEMENT_UNAVAILABLE" } });
});

test("dependency assembly failures remain opaque even with a domain-shaped cause", async () => {
  mocks.dependencies.mockRejectedValue(new SessionManagementUnavailableError());
  const response = await invitationApi.GET(request(), context);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
});
