import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { observeWalletIdentity } from "@/app/wallet/wallet-identity";

let windowTarget: EventTarget;
let documentTarget: EventTarget & { visibilityState: string };
beforeEach(() => {
  vi.useFakeTimers();
  windowTarget = Object.assign(new EventTarget(), { setInterval, clearInterval });
  documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test("checks initial cookies, focus, visible transitions and periodic cross-tab logout; cleans up", async () => {
  let userId: string | null = "A";
  const read = vi.fn(async () => userId);
  const observed = vi.fn();
  const observer = observeWalletIdentity(read, observed, vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(observed).toHaveBeenLastCalledWith("A");
  userId = "B";
  windowTarget.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(0);
  expect(observed).toHaveBeenLastCalledWith("B");
  documentTarget.visibilityState = "hidden";
  await vi.advanceTimersByTimeAsync(15_000);
  expect(read).toHaveBeenCalledTimes(2);
  documentTarget.visibilityState = "visible";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(observed).toHaveBeenLastCalledWith("B");
  userId = null;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(observed).toHaveBeenLastCalledWith(null);
  observer.dispose();
  windowTarget.dispatchEvent(new Event("focus"));
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(read).toHaveBeenCalledTimes(4);
});

test("discards overlapping and unmounted identity responses", async () => {
  const pending: ((id: string | null) => void)[] = [];
  const read = () => new Promise<string | null>((resolve) => pending.push(resolve));
  const observed = vi.fn();
  const observer = observeWalletIdentity(read, observed, vi.fn());
  observer.recheck();
  pending[1]!("B");
  await Promise.resolve();
  pending[0]!("A");
  await Promise.resolve();
  expect(observed).toHaveBeenCalledExactlyOnceWith("B");
  observer.recheck();
  observer.dispose();
  pending[2]!("A");
  await Promise.resolve();
  expect(observed).toHaveBeenCalledTimes(1);
});

test("reports only the latest check failure", async () => {
  const error = vi.fn();
  const observer = observeWalletIdentity(async () => { throw new Error("offline"); }, vi.fn(), error);
  await Promise.resolve();
  expect(error).toHaveBeenCalledOnce();
  observer.recheck();
  observer.dispose();
  await Promise.resolve();
  expect(error).toHaveBeenCalledOnce();
});
