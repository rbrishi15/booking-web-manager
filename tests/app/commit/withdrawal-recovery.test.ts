import { describe, expect, test } from "vitest";
import type { JoinedSessionItem } from "@/app/commit/withdrawal-ports";
import {
  browserUnresolvedStore, reconcile, settleAttempt, termsDiffer, unresolvedDepartureSchema, unresolvedWithdrawalSchema,
  type UnresolvedWithdrawal,
} from "@/app/commit/withdrawal-recovery";

const sessionId = "11111111-1111-4111-8111-111111111111";
const entry: UnresolvedWithdrawal = {
  request: { sessionId, idempotencyKey: "first-key", replacement: { mode: "OPEN_SLOT" } },
  preview: { kind: "REFUNDED", refundCents: 1250, heldCents: 1250 },
};
const listed = (status: JoinedSessionItem["status"]): JoinedSessionItem => ({
  sessionId, venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central",
  startAt: "2045-04-12T10:00:00Z", endAt: "2045-04-12T12:00:00Z", status, bookingShareCents: 1250,
});

/** A Storage that keeps values in memory, or fails every call. */
function memoryStorage(failing = false): Storage {
  const values = new Map<string, string>();
  const guard = () => { if (failing) throw new DOMException("Blocked", "SecurityError"); };
  return {
    get length() { return values.size; },
    clear: () => { guard(); values.clear(); },
    getItem: (key) => { guard(); return values.get(key) ?? null; },
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { guard(); values.delete(key); },
    setItem: (key, value) => { guard(); values.set(key, value); },
  };
}

describe("UC2-05 settling an attempt", () => {
  test("keeps a request whose outcome is unknown", () => {
    // Act
    const next = settleAttempt(new Map(), sessionId, entry, "unconfirmed", false);

    // Assert
    expect(next.get(sessionId)).toBe(entry);
  });

  test("clears it once the attempt succeeds", () => {
    // Act & Assert
    expect(settleAttempt(new Map([[sessionId, entry]]), sessionId, entry, "succeeded", true).size).toBe(0);
  });

  test("a first attempt the server rejects did nothing, so nothing is kept", () => {
    // Act & Assert
    expect(settleAttempt(new Map(), sessionId, entry, "rejected", false).size).toBe(0);
  });

  test("a failed retry (for example an expired login) never discards the earlier uncertain request", () => {
    // Arrange
    const unresolved = new Map([[sessionId, entry]]);

    // Act
    const next = settleAttempt(unresolved, sessionId, entry, "rejected", true);

    // Assert
    expect(next).toBe(unresolved);
    expect(next.get(sessionId)?.request.idempotencyKey).toBe("first-key");
  });
});

describe("UC2-05 reconciling with the server's joined sessions", () => {
  const unresolved = new Map([[sessionId, entry]]);

  test("keeps the request while the place is still listed, so it can be retried", () => {
    // Act & Assert
    expect(reconcile(unresolved, [listed("COMMITTED")], "COMMITTED")).toBe(unresolved);
  });

  test.each([
    ["the place is no longer listed (withdrawn or the session ended)", []],
    ["the place is listed with another status", [listed("WAITLISTED")]],
  ])("clears the request when %s", (_name, sessions) => {
    // Act & Assert
    expect(reconcile(unresolved, sessions, "COMMITTED").size).toBe(0);
  });

  test("changes nothing until the list has loaded", () => {
    // Act & Assert
    expect(reconcile(unresolved, undefined, "COMMITTED")).toBe(unresolved);
  });
});

describe("UC2-05 refund terms", () => {
  test.each([
    [{ kind: "AWAITING_REPLACEMENT", refundCents: 0, heldCents: 1250 }, true],
    [{ kind: "REFUNDED", refundCents: 1000, heldCents: 1250 }, true],
    [{ kind: "REFUNDED", refundCents: 1250, heldCents: 1250 }, false],
  ] as const)("detects a change to %j", (latest, changed) => {
    // Act & Assert
    expect(termsDiffer(entry.preview, latest)).toBe(changed);
  });
});

describe("UC2-05 saved unresolved requests", () => {
  test("survive a reload for the same user and are invisible to another user", () => {
    // Arrange
    const storage = memoryStorage();
    browserUnresolvedStore("withdrawals", "user-a", unresolvedWithdrawalSchema, () => storage).save(new Map([[sessionId, entry]]));

    // Act
    const reloaded = browserUnresolvedStore("withdrawals", "user-a", unresolvedWithdrawalSchema, () => storage).load();
    const otherUser = browserUnresolvedStore("withdrawals", "user-b", unresolvedWithdrawalSchema, () => storage).load();

    // Assert
    expect(reloaded.get(sessionId)).toEqual(entry);
    expect(otherUser.size).toBe(0);
  });

  test("keeps withdrawals and waitlist departures apart, and removes the entry when empty", () => {
    // Arrange
    const storage = memoryStorage();
    const departures = browserUnresolvedStore("waitlist-departures", "user-a", unresolvedDepartureSchema, () => storage);
    departures.save(new Map([[sessionId, "leave-key"]]));

    // Act & Assert
    expect(browserUnresolvedStore("withdrawals", "user-a", unresolvedWithdrawalSchema, () => storage).load().size).toBe(0);
    expect(departures.load().get(sessionId)).toBe("leave-key");
    departures.save(new Map());
    expect(storage.length).toBe(0);
  });

  test.each([
    ["unreadable JSON", "{not json"],
    ["data in the wrong shape", JSON.stringify({ [sessionId]: { request: { sessionId }, preview: { kind: "FREE" } } })],
  ])("ignores %s instead of replaying it", (_name, raw) => {
    // Arrange
    const storage = memoryStorage();
    storage.setItem("booking-web-manager:unresolved-withdrawals:user-a", raw);

    // Act & Assert
    expect(browserUnresolvedStore("withdrawals", "user-a", unresolvedWithdrawalSchema, () => storage).load().size).toBe(0);
  });

  test("never throws when storage is blocked or missing", () => {
    // Arrange
    const blocked = browserUnresolvedStore("withdrawals", "user-a", unresolvedWithdrawalSchema, () => memoryStorage(true));
    const missing = browserUnresolvedStore("withdrawals", "user-a", unresolvedWithdrawalSchema, () => undefined);

    // Act & Assert
    expect(() => blocked.save(new Map([[sessionId, entry]]))).not.toThrow();
    expect(blocked.load().size).toBe(0);
    expect(missing.load().size).toBe(0);
  });
});
