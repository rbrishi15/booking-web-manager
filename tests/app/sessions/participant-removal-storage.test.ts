import { describe, expect, test } from "vitest";
import { participantRemovalStorageKey, readPendingParticipantRemoval } from "@/app/sessions/_components/participant-removal-storage";

const request = {
  userId: "host", sessionId: "20000000-0000-4000-8000-000000000001",
  participationId: "30000000-0000-4000-8000-000000000001", displayName: "Alex Tan",
  idempotencyKey: "40000000-0000-4000-8000-000000000001", previewVersion: "a".repeat(64), refundCents: 750,
};

describe("participant removal recovery", () => {
  test("retains the original submission identity and refund after reload", () => {
    expect(readPendingParticipantRemoval(JSON.stringify(request), request.userId, request.sessionId)).toEqual(request);
  });

  test("isolates storage by authenticated user and session", () => {
    expect(participantRemovalStorageKey("another-host", request.sessionId)).not.toBe(participantRemovalStorageKey(request.userId, request.sessionId));
    expect(readPendingParticipantRemoval(JSON.stringify(request), "another-host", request.sessionId)).toBeNull();
    expect(readPendingParticipantRemoval(JSON.stringify(request), request.userId, "20000000-0000-4000-8000-000000000002")).toBeNull();
  });

  test.each([
    "{incomplete", "null", "{}", JSON.stringify({ ...request, idempotencyKey: "" }),
    JSON.stringify({ ...request, refundCents: 7.5 }),
    JSON.stringify({ ...request, previewVersion: "bad" }),
    JSON.stringify({ ...request, previewVersion: "g".repeat(64) }),
  ])("refuses corrupt recovery state without synthesizing a replacement request: %s", (value) => {
    expect(readPendingParticipantRemoval(value, request.userId, request.sessionId)).toBeNull();
  });
});
