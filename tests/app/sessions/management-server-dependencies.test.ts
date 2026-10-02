import type { SessionManagementDependencies } from "@/app/sessions/management-dependencies";
import { beforeEach, expect, test, vi } from "vitest";

const config = vi.hoisted(() => ({ createSessionManagementDependencies: vi.fn<() => SessionManagementDependencies>() }));
vi.mock("@/use-case-config/session-management", () => config);
const dependencies: SessionManagementDependencies = {
  authenticate: async () => null,
  toggleVisibility: { forBooker: async (_bookerId, sessionId, visibility) => ({ sessionId, visibility }) },
  listHostedSessions: { forBooker: async () => [] },
};

beforeEach(() => {
  vi.resetModules();
  config.createSessionManagementDependencies.mockReset().mockReturnValue(dependencies);
});

test("shares concurrent initialization and later successful reads", async () => {
  const { getSessionManagementDependencies } = await import("@/app/sessions/management-server-dependencies");
  expect(config.createSessionManagementDependencies).not.toHaveBeenCalled();
  const [first, second] = await Promise.all([getSessionManagementDependencies(), getSessionManagementDependencies()]);
  expect(first).toBe(dependencies);
  expect(second).toBe(first);
  expect(await getSessionManagementDependencies()).toBe(first);
  expect(config.createSessionManagementDependencies).toHaveBeenCalledOnce();
});

test("shares an initialization failure and permits subsequent setup retry", async () => {
  const failure = new Error("private setup failure");
  config.createSessionManagementDependencies.mockImplementationOnce(() => { throw failure; });
  const { getSessionManagementDependencies } = await import("@/app/sessions/management-server-dependencies");
  expect(await Promise.allSettled([getSessionManagementDependencies(), getSessionManagementDependencies()])).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }]);
  expect(await getSessionManagementDependencies()).toBe(dependencies);
  expect(config.createSessionManagementDependencies).toHaveBeenCalledTimes(2);
});

test("does not discard valid dependencies following an individual use-case failure", async () => {
  const forBooker = vi.fn().mockRejectedValueOnce(new Error("Temporary database outage")).mockResolvedValue([]);
  config.createSessionManagementDependencies.mockReturnValue({ ...dependencies, listHostedSessions: { forBooker } });
  const { getSessionManagementDependencies } = await import("@/app/sessions/management-server-dependencies");
  await expect((await getSessionManagementDependencies()).listHostedSessions.forBooker("booker")).rejects.toThrow("Temporary database outage");
  expect(await (await getSessionManagementDependencies()).listHostedSessions.forBooker("booker")).toEqual([]);
  expect(config.createSessionManagementDependencies).toHaveBeenCalledOnce();
});
