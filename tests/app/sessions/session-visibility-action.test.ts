import { beforeEach, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";

const mocks = vi.hoisted(() => ({ getDependencies: vi.fn(), forBooker: vi.fn(), createClient: vi.fn(), getUser: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/app/sessions/management-server-dependencies", () => ({ getSessionManagementDependencies: mocks.getDependencies }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { setSessionVisibility } from "@/app/sessions/actions";

const bookerId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: bookerId } }, error: null });
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.forBooker.mockResolvedValue({ sessionId, visibility: "PUBLIC" });
  mocks.getDependencies.mockResolvedValue({ toggleVisibility: { forBooker: mocks.forBooker } });
});

test("uses cookie identity with the shared use case and refreshes after commit", async () => {
  expect(await setSessionVisibility(sessionId, "PUBLIC")).toEqual({ status: "saved", sessionId, visibility: "PUBLIC" });
  expect(mocks.forBooker).toHaveBeenCalledExactlyOnceWith(bookerId, sessionId, "PUBLIC");
  expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/sessions");
  expect(mocks.forBooker.mock.invocationCallOrder[0]).toBeLessThan(mocks.revalidatePath.mock.invocationCallOrder[0]!);
});

test("rejects expired cookie identity and malformed session IDs without invoking the use case", async () => {
  mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 401 } });
  expect(await setSessionVisibility(sessionId, "PUBLIC")).toMatchObject({ status: "error", code: "UNAUTHENTICATED", refresh: false });
  expect(await setSessionVisibility("bad-id", "PUBLIC")).toMatchObject({ status: "error", code: "INVALID_REQUEST", refresh: false });
  expect(mocks.forBooker).not.toHaveBeenCalled();
});

test.each(["SESSION_STARTED", "SESSION_CLOSED", "CAPACITY_EXCEEDED"] as const)("refreshes after %s to replace stale lifecycle controls", async (code) => {
  mocks.forBooker.mockRejectedValue(new DomainError(code, "Cannot change visibility"));
  expect(await setSessionVisibility(sessionId, "PUBLIC")).toEqual({ status: "error", code, message: "Cannot change visibility", refresh: true });
  expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/sessions");
});

test.each(["INACTIVE_ACCOUNT", "UNAUTHORIZED", "NOT_FOUND"] as const)("returns current %s access failure without revalidating", async (code) => {
  mocks.forBooker.mockRejectedValue(new DomainError(code, "Cannot manage session"));
  expect(await setSessionVisibility(sessionId, "PUBLIC")).toEqual({ status: "error", code, message: "Cannot manage session", refresh: false });
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});

test("exposes deliberate unavailability and redacts infrastructure failures", async () => {
  mocks.forBooker.mockRejectedValueOnce(new SessionManagementUnavailableError()).mockRejectedValueOnce(new Error("private SQL"));
  expect(await setSessionVisibility(sessionId, "PUBLIC")).toMatchObject({ code: "SESSION_MANAGEMENT_UNAVAILABLE", refresh: false });
  expect(await setSessionVisibility(sessionId, "PUBLIC")).toEqual({ status: "error", code: "INTERNAL_ERROR", message: "Internal server error", refresh: false });
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});

test("redacts authentication provider outages rather than claiming an expired session", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503, message: "private auth outage" } });
  expect(await setSessionVisibility(sessionId, "PUBLIC")).toMatchObject({ code: "INTERNAL_ERROR", message: "Internal server error", refresh: false });
  expect(mocks.forBooker).not.toHaveBeenCalled();
});

test("redacts setup errors that resemble business failures", async () => {
  mocks.getDependencies.mockRejectedValue(new DomainError("NOT_FOUND", "private config"));
  expect(await setSessionVisibility(sessionId, "PUBLIC")).toMatchObject({ code: "INTERNAL_ERROR", message: "Internal server error" });
});
