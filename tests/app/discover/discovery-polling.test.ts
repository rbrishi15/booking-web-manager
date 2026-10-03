import { afterEach, describe, expect, test, vi } from "vitest";
import { startDiscoveryPolling } from "@/app/discover/_components/discovery-polling";

afterEach(() => vi.useRealTimers());

/** Creates polling with fake timers and controllable visibility, connectivity, and refresh eligibility. */
function scenario() {
  vi.useFakeTimers();
  const documentEvents = new EventTarget();
  const windowEvents = new EventTarget();
  let visible = true;
  let online = true;
  let allowed = true;
  const refresh = vi.fn();
  const polling = startDiscoveryPolling({
    refresh, canRefresh: () => allowed, online: () => online,
    document: {
      get visibilityState() { return visible ? "visible" : "hidden"; },
      addEventListener: documentEvents.addEventListener.bind(documentEvents),
      removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    },
    window: {
      addEventListener: windowEvents.addEventListener.bind(windowEvents),
      removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    },
  });
  return {
    polling, refresh,
    /** Changes refresh eligibility without emitting a browser event. */
    setAllowed(value: boolean) { allowed = value; },
    /** Updates simulated page visibility and emits its change event. */
    setVisible(value: boolean) { visible = value; documentEvents.dispatchEvent(new Event("visibilitychange")); },
    /** Updates simulated connectivity and emits an online event when reconnecting. */
    setOnline(value: boolean) { online = value; if (value) windowEvents.dispatchEvent(new Event("online")); },
  };
}

describe("discovery background refresh scheduling", () => {
  test("refreshes every second while idle and never overlaps an unfinished read", () => {
    const { polling, refresh } = scenario();
    vi.advanceTimersByTime(999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5_000);
    expect(refresh).toHaveBeenCalledOnce();
    polling.complete();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    polling.stop();
  });

  test("suppresses invalid queries or foreground navigation and resumes the current page", () => {
    const { polling, refresh, setAllowed } = scenario();
    setAllowed(false);
    vi.advanceTimersByTime(3_000);
    expect(refresh).not.toHaveBeenCalled();
    setAllowed(true);
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledOnce();
    polling.stop();
  });

  test("pauses in a hidden tab and refreshes immediately when visible again", () => {
    const { polling, refresh, setVisible } = scenario();
    setVisible(false);
    vi.advanceTimersByTime(5_000);
    expect(refresh).not.toHaveBeenCalled();
    setVisible(true);
    expect(refresh).toHaveBeenCalledOnce();
    setVisible(true);
    expect(refresh).toHaveBeenCalledOnce();
    polling.stop();
  });

  test("pauses offline and refreshes immediately after reconnection", () => {
    const { polling, refresh, setOnline } = scenario();
    setOnline(false);
    vi.advanceTimersByTime(5_000);
    expect(refresh).not.toHaveBeenCalled();
    setOnline(true);
    expect(refresh).toHaveBeenCalledOnce();
    polling.stop();
  });

  test("removes timers and resume listeners when the page departs", () => {
    const { polling, refresh, setVisible, setOnline } = scenario();
    polling.stop();
    polling.complete();
    setVisible(false);
    setVisible(true);
    setOnline(false);
    setOnline(true);
    vi.advanceTimersByTime(10_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
