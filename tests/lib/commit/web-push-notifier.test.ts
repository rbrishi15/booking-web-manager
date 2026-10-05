import {
  type PushDelivery,
  pushPayloadFor,
  type WebPushSubscription,
  WebPushNotifier,
} from "@/lib/commit/web-push-notifier";
import { describe, expect, test } from "vitest";

describe("WebPushNotifier", () => {
  test("notify_WhenRecipientHasSubscriptions_SendsThePayloadToEach", async () => {
    // Arrange
    const { notifier, sends } = pushScenario({
      alice: [subscription("alice-phone"), subscription("alice-laptop")],
    });

    // Act
    await notifier.notify([
      { kind: "PROMOTED", recipientId: "alice", sessionId: "s1" },
    ]);

    // Assert
    expect(sends.map((send) => send.endpoint)).toEqual([
      "alice-phone",
      "alice-laptop",
    ]);
    expect(JSON.parse(sends[0]?.payload ?? "")).toEqual({
      kind: "PROMOTED",
      sessionId: "s1",
      url: "/sessions/s1",
      title: "You're in!",
      body: "A place opened up and your share is now held for this session.",
    });
  });

  test("notify_WhenRecipientHasNoSubscriptions_SendsNothing", async () => {
    // Arrange
    const { notifier, sends } = pushScenario({});

    // Act
    await notifier.notify([
      { kind: "PROMOTED", recipientId: "alice", sessionId: "s1" },
    ]);

    // Assert
    expect(sends).toEqual([]);
  });

  test("notify_WhenSubscriptionHasExpired_RemovesIt", async () => {
    // Arrange
    const { notifier, removed } = pushScenario(
      { alice: [subscription("stale"), subscription("current")] },
      { stale: "EXPIRED" },
    );

    // Act
    await notifier.notify([
      { kind: "FORFEITURE_DUE", recipientId: "alice", sessionId: "s1" },
    ]);

    // Assert
    expect(removed).toEqual(["stale"]);
  });

  test("notify_WhenOneDeliveryFails_StillDeliversTheRest", async () => {
    // Arrange
    const { notifier, sends, removed } = pushScenario(
      {
        alice: [subscription("broken")],
        bob: [subscription("bob-phone")],
      },
      { broken: "THROW" },
    );

    // Act
    await notifier.notify([
      { kind: "PROMOTED", recipientId: "alice", sessionId: "s1" },
      { kind: "PROMOTED", recipientId: "bob", sessionId: "s1" },
    ]);

    // Assert
    expect(sends.map((send) => send.endpoint)).toContain("bob-phone");
    expect(removed).toEqual([]);
  });
});

describe("WebPushNotifier deadlines", () => {
  test("notify_WhenASendNeverSettles_GivesUpAfterTheDeadlineAndDeliversTheRest", async () => {
    // Arrange
    const sends: string[] = [];
    const notifier = new WebPushNotifier(
      {
        subscriptionsFor: async (userId) => [subscription(`${userId}-device`)],
        remove: async () => undefined,
      },
      {
        send: (target) => {
          if (target.endpoint === "alice-device") return new Promise(() => {});
          sends.push(target.endpoint);
          return Promise.resolve("DELIVERED");
        },
      },
      20,
    );

    // Act
    await notifier.notify([
      { kind: "PROMOTED", recipientId: "alice", sessionId: "s1" },
      { kind: "PROMOTED", recipientId: "bob", sessionId: "s1" },
    ]);

    // Assert
    expect(sends).toEqual(["bob-device"]);
  });

  test("notify_WhenSubscriptionLookupNeverSettles_ResolvesAfterTheDeadline", async () => {
    // Arrange
    const notifier = new WebPushNotifier(
      { subscriptionsFor: () => new Promise(() => {}), remove: async () => undefined },
      { send: async () => "DELIVERED" },
      20,
    );

    // Act & Assert
    await expect(
      notifier.notify([
        { kind: "PROMOTED", recipientId: "alice", sessionId: "s1" },
      ]),
    ).resolves.toBeUndefined();
  });
});

describe("pushPayloadFor", () => {
  test("pushPayloadFor_ForEachKind_LinksToTheSession", () => {
    // Arrange
    const kinds = [
      "PROMOTED",
      "REPLACEMENT_INVITATION",
      "FORFEITURE_WARNING",
      "FORFEITURE_DUE",
      "VERIFICATION_REMINDER",
    ] as const;

    // Act
    const payloads = kinds.map((kind) =>
      pushPayloadFor({ kind, recipientId: "u", sessionId: "s9" }),
    );

    // Assert
    for (const payload of payloads) {
      expect(payload.url).toBe("/sessions/s9");
      expect(payload.title).not.toBe("");
      expect(payload.body).not.toBe("");
    }
  });
});

function subscription(endpoint: string): WebPushSubscription {
  return { endpoint, keys: { p256dh: "key", auth: "auth" } };
}

function pushScenario(
  byUser: Record<string, WebPushSubscription[]>,
  outcomes: Record<string, PushDelivery | "THROW"> = {},
) {
  const sends: { endpoint: string; payload: string }[] = [];
  const removed: string[] = [];
  const notifier = new WebPushNotifier(
    {
      subscriptionsFor: async (userId) => byUser[userId] ?? [],
      remove: async (endpoint) => {
        removed.push(endpoint);
      },
    },
    {
      send: async (target, payload) => {
        const outcome = outcomes[target.endpoint] ?? "DELIVERED";
        if (outcome === "THROW") throw new Error("network error");
        sends.push({ endpoint: target.endpoint, payload });
        return outcome;
      },
    },
  );
  return { notifier, sends, removed };
}
