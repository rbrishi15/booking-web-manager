import type { DiscoveryDependencies } from "@/app/discover/dependencies";
import { beforeEach, expect, test, vi } from "vitest";

const config = vi.hoisted(() => ({ createDiscoveryDependencies: vi.fn<() => DiscoveryDependencies>() }));
vi.mock("@/use-case-config/discovery", () => config);

const dependencies: DiscoveryDependencies = {
  authenticate: async () => null,
  discoverSessions: { forParticipant: async () => [] },
};

beforeEach(() => {
  vi.resetModules();
  config.createDiscoveryDependencies.mockReset().mockReturnValue(dependencies);
});

test("shares concurrent initialization and subsequent successful reads", async () => {
  const { getDiscoveryDependencies } = await import("@/app/discover/server-dependencies");
  const [first, second] = await Promise.all([getDiscoveryDependencies(), getDiscoveryDependencies()]);
  expect(first).toBe(dependencies);
  expect(second).toBe(first);
  expect(await getDiscoveryDependencies()).toBe(first);
  expect(config.createDiscoveryDependencies).toHaveBeenCalledOnce();
});

test("shares a failed initialization and permits the next caller to retry", async () => {
  const failure = new Error("private configuration failure");
  config.createDiscoveryDependencies.mockImplementationOnce(() => { throw failure; });
  const { getDiscoveryDependencies } = await import("@/app/discover/server-dependencies");
  const outcomes = await Promise.allSettled([getDiscoveryDependencies(), getDiscoveryDependencies()]);
  expect(outcomes).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }]);
  expect(config.createDiscoveryDependencies).toHaveBeenCalledOnce();
  expect(await getDiscoveryDependencies()).toBe(dependencies);
  expect(config.createDiscoveryDependencies).toHaveBeenCalledTimes(2);
});

test("request failures do not reset valid initialization", async () => {
  const forParticipant = vi.fn().mockRejectedValueOnce(new Error("Temporary database failure")).mockResolvedValue([]);
  config.createDiscoveryDependencies.mockReturnValue({ ...dependencies, discoverSessions: { forParticipant } });
  const { getDiscoveryDependencies } = await import("@/app/discover/server-dependencies");
  await expect((await getDiscoveryDependencies()).discoverSessions.forParticipant("10000000-0000-4000-8000-000000000001")).rejects.toThrow("Temporary database failure");
  expect(await (await getDiscoveryDependencies()).discoverSessions.forParticipant("10000000-0000-4000-8000-000000000001")).toEqual([]);
  expect(config.createDiscoveryDependencies).toHaveBeenCalledOnce();
});
