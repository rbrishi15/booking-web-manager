import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

/** Runs public/sw.js against a minimal service-worker global. */
function loadServiceWorker(windows: { url: string; focus: () => Promise<unknown> }[] = []) {
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: { origin: "https://app.example" },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
  };
  const source = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
  new Function("self", source)(self);
  const dispatch = async (type: string, event: object) => {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)?.({ ...event, waitUntil: (work: Promise<unknown>) => pending.push(work) });
    await Promise.all(pending);
  };
  return { self, dispatch };
}

const payload = {
  title: "You're in!",
  body: "A place opened up.",
  url: "/sessions/20000000-0000-4000-8000-000000000001",
  kind: "PROMOTED",
  sessionId: "20000000-0000-4000-8000-000000000001",
};

describe("push service worker", () => {
  test("shows the pushed notification, tagged by kind and session", async () => {
    const { self, dispatch } = loadServiceWorker();

    await dispatch("push", { data: { json: () => payload } });

    expect(self.registration.showNotification).toHaveBeenCalledExactlyOnceWith("You're in!", {
      body: "A place opened up.",
      tag: `PROMOTED:${payload.sessionId}`,
      data: { url: payload.url },
    });
  });

  test("an unreadable payload still shows a generic notification", async () => {
    const { self, dispatch } = loadServiceWorker();

    await dispatch("push", { data: { json: () => { throw new SyntaxError("bad"); } } });

    expect(self.registration.showNotification).toHaveBeenCalledWith(
      "Booking Web Manager",
      expect.objectContaining({ data: { url: "/" } }),
    );
  });

  test("clicking opens the notification's page on this site", async () => {
    const { self, dispatch } = loadServiceWorker();
    const close = vi.fn();

    await dispatch("notificationclick", { notification: { close, data: { url: payload.url } } });

    expect(close).toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalledWith(`https://app.example${payload.url}`);
  });

  test("clicking focuses an already open window at that page", async () => {
    const focus = vi.fn(async () => undefined);
    const { self, dispatch } = loadServiceWorker([{ url: `https://app.example${payload.url}`, focus }]);

    await dispatch("notificationclick", { notification: { close: vi.fn(), data: { url: payload.url } } });

    expect(focus).toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  test("a URL on another site opens Home instead", async () => {
    const { self, dispatch } = loadServiceWorker();

    await dispatch("push", { data: { json: () => ({ ...payload, url: "https://evil.example/phish" }) } });
    await dispatch("notificationclick", {
      notification: { close: vi.fn(), data: { url: "https://evil.example/phish" } },
    });

    expect(self.registration.showNotification).toHaveBeenCalledWith(
      payload.title,
      expect.objectContaining({ data: { url: "/" } }),
    );
    expect(self.clients.openWindow).toHaveBeenCalledWith("https://app.example/");
  });
});
