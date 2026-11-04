import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ provider: vi.fn(), openPool: vi.fn() }));
vi.mock("@/lib/database/postgres-pool", () => ({ createPostgresPoolProvider: mocks.provider }));
vi.mock("@/app/sessions/server-environment", () => ({ readSessionServerSettings: () => ({
  databaseUrl: "postgresql://postgres:local-test@127.0.0.1:5432/postgres",
  supabaseUrl: "https://test.supabase.co", supabaseAnonKey: "test-anon-key",
}) }));
vi.mock("@/use-case-config/notification-publisher", () => ({ createNotificationPublisher: () => undefined }));

beforeEach(() => {
  vi.resetModules();
  mocks.provider.mockReset().mockReturnValue(mocks.openPool);
  mocks.openPool.mockReset().mockImplementation(() => { throw new Error("A read has not requested a pool"); });
});

test("concurrent and warm HTTP callers share one invitation pool provider without opening it eagerly", async () => {
  const { getSessionInvitationManagementDependencies: load } = await import("@/app/sessions/session-invitation-server-dependencies");
  const [first, concurrent] = await Promise.all([load(), load()]);
  expect(concurrent).toBe(first);
  expect(await load()).toBe(first);
  expect(mocks.provider).toHaveBeenCalledOnce();
  expect(mocks.openPool).not.toHaveBeenCalled();
});

test("failed assembly is shared and retried while the later successful provider stays cached", async () => {
  const failure = new Error("Setup failed");
  mocks.provider.mockImplementationOnce(() => { throw failure; });
  const { getSessionInvitationManagementDependencies: load } = await import("@/app/sessions/session-invitation-server-dependencies");
  expect(await Promise.allSettled([load(), load()])).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }]);
  const recovered = await load();
  expect(await load()).toBe(recovered);
  expect(mocks.provider).toHaveBeenCalledTimes(2);
  expect(mocks.openPool).not.toHaveBeenCalled();
});
