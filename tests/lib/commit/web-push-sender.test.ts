import { WebPushError } from "web-push";
import { describe, expect, test, vi } from "vitest";
import { WebPushSender } from "@/lib/commit/web-push-sender";

const vapid = { subject: "mailto:team@example.com", publicKey: "public", privateKey: "private" };
const subscription = {
  endpoint: "https://push.example.com/abc",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
};

function sender(result: () => Promise<unknown>) {
  const send = vi.fn(result);
  return { send, sender: new WebPushSender(vapid, send as never) };
}

function pushError(statusCode: number) {
  return new WebPushError("push failed", statusCode, {}, "", subscription.endpoint);
}

describe("WebPushSender", () => {
  test("send_WhenAccepted_ReturnsDeliveredWithVapidAndTtl", async () => {
    // Arrange
    const { send, sender: subject } = sender(async () => ({ statusCode: 201 }));

    // Act
    const delivery = await subject.send(subscription, "payload");

    // Assert
    expect(delivery).toBe("DELIVERED");
    expect(send).toHaveBeenCalledExactlyOnceWith(subscription, "payload", {
      vapidDetails: vapid,
      TTL: 86_400,
      urgency: "high",
    });
  });

  test.each([404, 410])("send_WhenPushServiceReturns%i_ReturnsExpired", async (status) => {
    // Arrange
    const { sender: subject } = sender(async () => {
      throw pushError(status);
    });

    // Act / Assert
    expect(await subject.send(subscription, "payload")).toBe("EXPIRED");
  });

  test.each([
    ["a 500 from the push service", () => pushError(500)],
    ["a network error", () => new Error("ECONNRESET")],
  ])("send_WhenItFailsWith %s_ReturnsFailed", async (_name, failure) => {
    // Arrange
    const { sender: subject } = sender(async () => {
      throw failure();
    });

    // Act / Assert
    expect(await subject.send(subscription, "payload")).toBe("FAILED");
  });
});
