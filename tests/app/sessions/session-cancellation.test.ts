import { beforeEach, describe, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { LedgerError } from "@/lib/money/errors";
import { CancellationConflict } from "@/use-cases/sessions/cancellation-preview";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";

const mocks = vi.hoisted(() => ({
  dependencies: vi.fn(), authenticate: vi.fn(), preview: vi.fn(), cancel: vi.fn(),
  factory: vi.fn(), client: vi.fn(), user: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/app/sessions/cancellation-server-dependencies", () => ({ getSessionCancellationDependencies: mocks.dependencies }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { GET } from "@/app/api/sessions/[sessionId]/cancellation-preview/route";
import { POST } from "@/app/api/sessions/[sessionId]/cancel/route";
import { previewSessionCancellation, cancelSession } from "@/app/sessions/cancellation-actions";
import { withCancellationAction } from "@/app/sessions/session-actions";

const bookerId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const submission = { idempotencyKey: "30000000-0000-4000-8000-000000000001", previewVersion: "a".repeat(64) };
const preview = { sessionId, affectedParticipantCount: 2, refundRecipientCount: 1, totalRefundCents: 500, previewVersion: submission.previewVersion };
const committed = { sessionId, status: "CANCELLED", refundRecipientCount: 1, totalRefundCents: 500 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(bookerId);
  mocks.user.mockResolvedValue({ data: { user: { id: bookerId } }, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user } });
  mocks.preview.mockResolvedValue(preview);
  mocks.cancel.mockResolvedValue(committed);
  mocks.factory.mockReturnValue({ forBooker: mocks.cancel });
  mocks.dependencies.mockResolvedValue({ authenticate: mocks.authenticate, previewCancellation: { forBooker: mocks.preview }, createCancellation: mocks.factory });
});

function request(body: string) {
  return new Request(`http://localhost/api/sessions/${sessionId}/cancel`, { method: "POST",
    headers: { Authorization: "Bearer trusted", "Content-Type": "application/json" }, body });
}
function post(body: unknown = submission, id = sessionId) {
  return POST(request(JSON.stringify(body)), { params: Promise.resolve({ sessionId: id }) });
}

describe("UC2-03c entry points", () => {
  test("API and action previews invoke the same coordinator using authenticated identity", async () => {
    const response = await GET(new Request("http://localhost", { headers: { Authorization: "Bearer trusted" } }), { params: Promise.resolve({ sessionId }) });
    expect(await response.json()).toEqual(withCancellationAction(preview));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await previewSessionCancellation(sessionId)).toEqual({ status: "ready", preview: withCancellationAction(preview) });
    expect(mocks.preview).toHaveBeenNthCalledWith(1, bookerId, sessionId);
    expect(mocks.preview).toHaveBeenNthCalledWith(2, bookerId, sessionId);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  test("API and action cancellation share submission factory and ignore forged identity or amounts", async () => {
    const response = await post({ ...submission, bookerId: "forged", totalRefundCents: 999 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(committed);
    expect(await cancelSession(sessionId, submission)).toEqual({ status: "cancelled", result: committed });
    expect(mocks.factory).toHaveBeenCalledWith({ idempotencyKey: submission.idempotencyKey });
    expect(mocks.cancel).toHaveBeenNthCalledWith(1, bookerId, sessionId, submission.previewVersion);
    expect(mocks.cancel).toHaveBeenNthCalledWith(2, bookerId, sessionId, submission.previewVersion);
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/sessions");
  });
  test.each([null, {}, { ...submission, idempotencyKey: "" }, { ...submission, previewVersion: "invalid" }])("rejects malformed submission %j", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  test("rejects bad UUIDs, malformed JSON and action validation", async () => {
    expect((await post(submission, "bad")).status).toBe(400);
    expect((await POST(request("{"), { params: Promise.resolve({ sessionId }) })).status).toBe(400);
    expect(await previewSessionCancellation("bad")).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await cancelSession("bad", submission)).toMatchObject({ code: "INVALID_REQUEST" });
  });
  test("authenticates before parsing and rejects expired cookie identity", async () => {
    mocks.authenticate.mockResolvedValue(null);
    expect((await POST(request("{"), { params: Promise.resolve({ sessionId }) })).status).toBe(401);
    mocks.user.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect(await cancelSession(sessionId, submission)).toMatchObject({ code: "UNAUTHENTICATED", retrySameRequest: true });
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  test.each([
    [new DomainError("INACTIVE_ACCOUNT", "Inactive"), 403, "INACTIVE_ACCOUNT"],
    [new DomainError("UNAUTHORIZED", "Foreign"), 403, "UNAUTHORIZED"],
    [new DomainError("NOT_FOUND", "Missing"), 404, "NOT_FOUND"],
    [new DomainError("SESSION_STARTED", "Started"), 409, "SESSION_STARTED"],
    [new DomainError("SESSION_CLOSED", "Closed"), 409, "SESSION_CLOSED"],
    [new CancellationConflict(), 409, "STALE_CANCELLATION_PREVIEW"],
    [new LedgerError("IDEMPOTENCY_CONFLICT", "private"), 409, "IDEMPOTENCY_CONFLICT"],
    [new LedgerError("IDEMPOTENCY_IN_FLIGHT", "private"), 409, "IDEMPOTENCY_IN_FLIGHT"],
    [new SessionManagementUnavailableError(), 503, "SESSION_MANAGEMENT_UNAVAILABLE"],
    [new LedgerError("HOLD_NOT_OPEN", "private"), 500, "INTERNAL_ERROR"],
    [new Error("private database URL"), 500, "INTERNAL_ERROR"],
  ] as const)("maps %s consistently through API and action", async (error, status, code) => {
    mocks.cancel.mockRejectedValue(error);
    const response = await post();
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
    const action = await cancelSession(sessionId, submission);
    expect(action).toMatchObject({ status: "error", code, refresh: status === 409,
      retrySameRequest: status === 403 || status >= 500 || code === "IDEMPOTENCY_IN_FLIGHT" });
    if (status === 500) expect(action).toMatchObject({ message: "Internal server error" });
  });
  test("does not report success or revalidate before commit resolves", async () => {
    let release!: () => void;
    mocks.cancel.mockImplementation(() => new Promise((resolve) => { release = () => resolve(committed); }));
    let done = false;
    const pending = cancelSession(sessionId, submission).then((value) => { done = true; return value; });
    await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce());
    expect(done).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    release();
    expect(await pending).toMatchObject({ status: "cancelled" });
  });
  test("redacts dependency setup, body-read and authentication provider failures", async () => {
    mocks.dependencies.mockRejectedValueOnce(new DomainError("NOT_FOUND", "private setup"));
    expect((await post()).status).toBe(500);
    const incoming = request("{}");
    vi.spyOn(incoming, "json").mockRejectedValue(new DomainError("NOT_FOUND", "private reader"));
    expect((await POST(incoming, { params: Promise.resolve({ sessionId }) })).status).toBe(500);
    mocks.user.mockResolvedValue({ data: { user: null }, error: { status: 503 } });
    expect(await previewSessionCancellation(sessionId)).toMatchObject({ code: "INTERNAL_ERROR" });
  });
});
