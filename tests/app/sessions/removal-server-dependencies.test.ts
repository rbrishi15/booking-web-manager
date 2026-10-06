import type { SessionRemovalDependencies } from "@/app/sessions/removal-dependencies";
import { beforeEach, expect, test, vi } from "vitest";

const config = vi.hoisted(() => ({ createSessionRemovalDependencies: vi.fn<() => SessionRemovalDependencies>() }));
vi.mock("@/use-case-config/removal", () => config);
const dependencies: SessionRemovalDependencies = {
  authenticate: async () => null,
  listParticipants: { forBooker: async (_bookerId, sessionId) => ({ sessionId, venueName: "Venue", sport: "BADMINTON", startAt: new Date(), endAt: new Date(), status: "OPEN", availableSlots: 1, participants: [] }) },
  previewRemoval: { forBooker: async (_bookerId, sessionId, participationId) => ({ sessionId, participationId, refundCents: 501, previewVersion: "a".repeat(64) }) },
  createRemoval: () => ({ forBooker: async (_bookerId, sessionId, participationId) => ({ sessionId, participationId, status: "REMOVED", refundCents: 501 }) }),
};

beforeEach(() => {
  vi.resetModules();
  config.createSessionRemovalDependencies.mockReset().mockReturnValue(dependencies);
});

test("shares concurrent initialization and later successful reads", async () => {
  const { getSessionRemovalDependencies } = await import("@/app/sessions/removal-server-dependencies");
  expect(config.createSessionRemovalDependencies).not.toHaveBeenCalled();
  const [first, second] = await Promise.all([getSessionRemovalDependencies(), getSessionRemovalDependencies()]);
  expect(first).toBe(dependencies);
  expect(second).toBe(first);
  expect(await getSessionRemovalDependencies()).toBe(first);
  expect(config.createSessionRemovalDependencies).toHaveBeenCalledOnce();
});

test("shares an initialization failure and permits subsequent setup retry", async () => {
  const failure = new Error("private setup failure");
  config.createSessionRemovalDependencies.mockImplementationOnce(() => { throw failure; });
  const { getSessionRemovalDependencies } = await import("@/app/sessions/removal-server-dependencies");
  expect(await Promise.allSettled([getSessionRemovalDependencies(), getSessionRemovalDependencies()])).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }]);
  expect(await getSessionRemovalDependencies()).toBe(dependencies);
  expect(config.createSessionRemovalDependencies).toHaveBeenCalledTimes(2);
});

test("does not discard valid dependencies after an individual use-case failure", async () => {
  const forBooker = vi.fn().mockRejectedValueOnce(new Error("Temporary database outage")).mockResolvedValue({});
  config.createSessionRemovalDependencies.mockReturnValue({ ...dependencies, listParticipants: { forBooker } });
  const { getSessionRemovalDependencies } = await import("@/app/sessions/removal-server-dependencies");
  await expect((await getSessionRemovalDependencies()).listParticipants.forBooker("booker", "session")).rejects.toThrow("Temporary database outage");
  await (await getSessionRemovalDependencies()).listParticipants.forBooker("booker", "session");
  expect(config.createSessionRemovalDependencies).toHaveBeenCalledOnce();
});
