import { beforeEach, describe, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { LedgerError } from "@/lib/money/errors";
import { ParticipantRemovalConflict } from "@/use-cases/sessions/participant-removal-preview";
import { SessionRemovalUnavailableError } from "@/app/sessions/removal-unavailable";

const mocks = vi.hoisted(() => ({
  dependencies: vi.fn(), authenticate: vi.fn(), list: vi.fn(), preview: vi.fn(), remove: vi.fn(),
  factory: vi.fn(), client: vi.fn(), user: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/app/sessions/removal-server-dependencies", () => ({ getSessionRemovalDependencies: mocks.dependencies }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { GET as LIST } from "@/app/api/sessions/[sessionId]/participants/route";
import { GET } from "@/app/api/sessions/[sessionId]/participants/[participationId]/removal-preview/route";
import { POST } from "@/app/api/sessions/[sessionId]/participants/[participationId]/remove/route";
import { listSessionParticipants, previewParticipantRemoval, removeParticipant } from "@/app/sessions/removal-actions";

const bookerId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const participationId = "40000000-0000-4000-8000-000000000001";
const params = { sessionId, participationId };
const submission = { idempotencyKey: "30000000-0000-4000-8000-000000000001", previewVersion: "a".repeat(64) };
const preview = { ...params, refundCents: 501, previewVersion: submission.previewVersion };
const committed = { ...params, status: "REMOVED", refundCents: 501 };
const session = { sessionId, venueName: "Sports Hall", sport: "BADMINTON", startAt: new Date("2026-10-07T12:00:00Z"),
  endAt: new Date("2026-10-07T14:00:00Z"), status: "OPEN", availableSlots: 0,
  participants: [{ participationId, displayName: "A Player", status: "COMMITTED", canRemove: true }] };
const serializedSession = { ...session, startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString() };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(bookerId);
  mocks.user.mockResolvedValue({ data: { user: { id: bookerId } }, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user } });
  mocks.list.mockResolvedValue(session);
  mocks.preview.mockResolvedValue(preview);
  mocks.remove.mockResolvedValue(committed);
  mocks.factory.mockReturnValue({ forBooker: mocks.remove });
  mocks.dependencies.mockResolvedValue({ authenticate: mocks.authenticate, listParticipants: { forBooker: mocks.list },
    previewRemoval: { forBooker: mocks.preview }, createRemoval: mocks.factory });
});

function request(body: string) {
  return new Request(`http://localhost/api/sessions/${sessionId}/participants/${participationId}/remove`, { method: "POST",
    headers: { Authorization: "Bearer trusted", "Content-Type": "application/json" }, body });
}
function getRequest() { return new Request("http://localhost", { headers: { Authorization: "Bearer trusted" } }); }
function post(body: unknown = submission, ids = params) {
  return POST(request(JSON.stringify(body)), { params: Promise.resolve(ids) });
}

describe("UC2-03b entry points", () => {
  test("API and action lists authenticate and serialize dates while preserving roster order and history", async () => {
    const response = await LIST(getRequest(), { params: Promise.resolve({ sessionId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(serializedSession);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await listSessionParticipants(sessionId)).toEqual({ status: "ready", session: serializedSession });
    expect(mocks.list).toHaveBeenNthCalledWith(1, bookerId, sessionId);
    expect(mocks.list).toHaveBeenNthCalledWith(2, bookerId, sessionId);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  test("API and action previews use authenticated identity and the same target", async () => {
    const response = await GET(getRequest(), { params: Promise.resolve(params) });
    expect(await response.json()).toEqual(preview);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await previewParticipantRemoval(sessionId, participationId)).toEqual({ status: "ready", preview });
    expect(mocks.preview).toHaveBeenNthCalledWith(1, bookerId, sessionId, participationId);
    expect(mocks.preview).toHaveBeenNthCalledWith(2, bookerId, sessionId, participationId);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  test("API and action removal share submission factory and ignore forged identity, target and refund", async () => {
    const response = await post({ ...submission, bookerId: "forged", participationId: "forged", refundCents: 999 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(committed);
    expect(await removeParticipant(sessionId, participationId, submission)).toEqual({ status: "removed", result: committed });
    expect(mocks.factory).toHaveBeenCalledWith({ idempotencyKey: submission.idempotencyKey });
    expect(mocks.remove).toHaveBeenNthCalledWith(1, bookerId, sessionId, participationId, submission.previewVersion);
    expect(mocks.remove).toHaveBeenNthCalledWith(2, bookerId, sessionId, participationId, submission.previewVersion);
    expect(mocks.revalidate.mock.calls).toEqual([["/sessions"], [`/sessions/${sessionId}/participants`]]);
  });

  test.each([null, {}, { ...submission, idempotencyKey: "" }, { ...submission, previewVersion: "invalid" }])("rejects malformed submission %j", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  test("rejects malformed IDs and JSON before invoking use cases", async () => {
    expect((await post(submission, { ...params, sessionId: "bad" })).status).toBe(400);
    expect((await post(submission, { ...params, participationId: "bad" })).status).toBe(400);
    expect((await POST(request("{"), { params: Promise.resolve(params) })).status).toBe(400);
    expect((await LIST(getRequest(), { params: Promise.resolve({ sessionId: "bad" }) })).status).toBe(400);
    expect((await GET(getRequest(), { params: Promise.resolve({ ...params, participationId: "bad" }) })).status).toBe(400);
    expect(await listSessionParticipants("bad")).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await previewParticipantRemoval(sessionId, "bad")).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await removeParticipant("bad", participationId, submission)).toMatchObject({ code: "INVALID_REQUEST" });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  test("authenticates before parsing and rejects expired cookie identity", async () => {
    mocks.authenticate.mockResolvedValue(null);
    expect((await POST(request("{"), { params: Promise.resolve(params) })).status).toBe(401);
    expect((await LIST(getRequest(), { params: Promise.resolve({ sessionId: "bad" }) })).status).toBe(401);
    expect((await GET(getRequest(), { params: Promise.resolve({ ...params, participationId: "bad" }) })).status).toBe(401);
    mocks.user.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect(await removeParticipant(sessionId, participationId, submission)).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(mocks.factory).not.toHaveBeenCalled();
  });

  test.each([
    [new DomainError("INACTIVE_ACCOUNT", "Inactive"), 403, "INACTIVE_ACCOUNT"],
    [new DomainError("UNAUTHORIZED", "Foreign"), 403, "UNAUTHORIZED"],
    [new DomainError("NOT_FOUND", "Missing"), 404, "NOT_FOUND"],
    [new DomainError("SESSION_STARTED", "Started"), 409, "SESSION_STARTED"],
    [new DomainError("SESSION_CLOSED", "Closed"), 409, "SESSION_CLOSED"],
    [new DomainError("INVALID_STATE", "Noncommitted"), 409, "INVALID_STATE"],
    [new ParticipantRemovalConflict(), 409, "STALE_REMOVAL_PREVIEW"],
    [new LedgerError("IDEMPOTENCY_CONFLICT", "private"), 409, "IDEMPOTENCY_CONFLICT"],
    [new LedgerError("IDEMPOTENCY_IN_FLIGHT", "private"), 409, "IDEMPOTENCY_IN_FLIGHT"],
    [new SessionRemovalUnavailableError(), 503, "SESSION_REMOVAL_UNAVAILABLE"],
    [new LedgerError("HOLD_NOT_OPEN", "private"), 500, "INTERNAL_ERROR"],
    [new Error("private database URL"), 500, "INTERNAL_ERROR"],
  ] as const)("maps %s consistently through API and action", async (error, status, code) => {
    mocks.remove.mockRejectedValue(error);
    const response = await post();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code } });
    const action = await removeParticipant(sessionId, participationId, submission);
    expect(action).toMatchObject({ status: "error", code, refresh: status === 409,
      retrySameRequest: status >= 500 || code === "IDEMPOTENCY_IN_FLIGHT" });
    if (status === 500) expect(action).toMatchObject({ message: "Internal server error" });
  });

  test("list and preview do not return private data after owner or account denial", async () => {
    mocks.list.mockRejectedValue(new DomainError("UNAUTHORIZED", "Only owner"));
    mocks.preview.mockRejectedValue(new DomainError("INACTIVE_ACCOUNT", "Inactive"));
    const listResponse = await LIST(getRequest(), { params: Promise.resolve({ sessionId }) });
    expect(listResponse.status).toBe(403);
    expect(await listResponse.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Only owner" } });
    expect(await listSessionParticipants(sessionId)).toMatchObject({ status: "error", code: "UNAUTHORIZED" });
    expect((await GET(getRequest(), { params: Promise.resolve(params) })).status).toBe(403);
    expect(await previewParticipantRemoval(sessionId, participationId)).toMatchObject({ status: "error", code: "INACTIVE_ACCOUNT" });
  });

  test("does not report success or revalidate before commit resolves", async () => {
    let release!: () => void;
    mocks.remove.mockImplementation(() => new Promise((resolve) => { release = () => resolve(committed); }));
    let done = false;
    const pending = removeParticipant(sessionId, participationId, submission).then((value) => { done = true; return value; });
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    expect(done).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    release();
    expect(await pending).toMatchObject({ status: "removed" });
  });

  test("redacts dependency setup, body-read and authentication provider failures", async () => {
    mocks.dependencies.mockRejectedValueOnce(new DomainError("NOT_FOUND", "private setup"));
    expect((await post()).status).toBe(500);
    const incoming = request("{}");
    vi.spyOn(incoming, "json").mockRejectedValue(new DomainError("NOT_FOUND", "private reader"));
    expect((await POST(incoming, { params: Promise.resolve(params) })).status).toBe(500);
    mocks.user.mockResolvedValue({ data: { user: null }, error: { status: 503 } });
    expect(await previewParticipantRemoval(sessionId, participationId)).toMatchObject({ code: "INTERNAL_ERROR" });
  });
});
