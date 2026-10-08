import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dependencies: vi.fn(),
  authenticate: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
}));
vi.mock("@/app/commit/push-subscription-server-dependencies", () => ({
  getPushSubscriptionDependencies: mocks.dependencies,
}));
import { DELETE, POST } from "@/app/api/push/subscriptions/route";
import { createPushSubscriptionDependencies } from "@/use-case-config/push-subscriptions";

const userId = "10000000-0000-4000-8000-000000000001";
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  expirationTime: null,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(userId);
  mocks.dependencies.mockResolvedValue({
    authenticate: mocks.authenticate,
    subscriptions: { register: mocks.register, unregister: mocks.unregister },
  });
});

function request(method: "POST" | "DELETE", body: unknown, raw = false): Request {
  return new Request("http://localhost/api/push/subscriptions", {
    method,
    headers: { Authorization: "Bearer trusted", "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

describe("POST /api/push/subscriptions", () => {
  test("registers the browser for the authenticated user only", async () => {
    const response = await POST(request("POST", { ...subscription, userId: "forged" }));

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith(userId, {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    });
  });

  test("requires authentication", async () => {
    mocks.authenticate.mockResolvedValue(null);

    const response = await POST(request("POST", subscription));

    expect(response.status).toBe(401);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  test.each([
    ["an http endpoint", { ...subscription, endpoint: "http://push.example.com/abc" }],
    ["a missing auth key", { endpoint: subscription.endpoint, keys: { p256dh: "abc" } }],
    ["a key with invalid characters", { ...subscription, keys: { p256dh: "a b", auth: "c" } }],
    ["an over-long endpoint", { ...subscription, endpoint: `https://push.example.com/${"a".repeat(2100)}` }],
  ])("rejects %s with 400", async (_name, body) => {
    const response = await POST(request("POST", body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid push subscription" },
    });
    expect(mocks.register).not.toHaveBeenCalled();
  });

  test("rejects malformed JSON with 400", async () => {
    const response = await POST(request("POST", "{", true));

    expect(response.status).toBe(400);
  });

  test("keeps storage failures opaque", async () => {
    mocks.register.mockRejectedValue(new Error("connection refused at 10.0.0.1"));

    const response = await POST(request("POST", subscription));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  test("keeps a dependency setup failure opaque", async () => {
    mocks.dependencies.mockRejectedValue(new Error("pool for postgres://secret"));

    const response = await POST(request("POST", subscription));

    expect(response.status).toBe(500);
  });

  test("without VAPID settings, configuration reports 503", async () => {
    const original = { ...process.env };
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      mocks.dependencies.mockResolvedValue(createPushSubscriptionDependencies());

      const response = await POST(request("POST", subscription));

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "PUSH_UNAVAILABLE" } });
    } finally {
      process.env = original;
    }
  });
});

describe("DELETE /api/push/subscriptions", () => {
  test("removes only the authenticated user's subscription", async () => {
    const response = await DELETE(request("DELETE", { endpoint: subscription.endpoint }));

    expect(response.status).toBe(204);
    expect(mocks.unregister).toHaveBeenCalledExactlyOnceWith(userId, subscription.endpoint);
  });

  test("requires authentication", async () => {
    mocks.authenticate.mockResolvedValue(null);

    const response = await DELETE(request("DELETE", { endpoint: subscription.endpoint }));

    expect(response.status).toBe(401);
    expect(mocks.unregister).not.toHaveBeenCalled();
  });

  test("rejects a missing endpoint with 400", async () => {
    const response = await DELETE(request("DELETE", {}));

    expect(response.status).toBe(400);
  });
});
