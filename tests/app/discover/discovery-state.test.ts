import { describe, expect, test } from "vitest";
import { deriveDiscoveryState, type DiscoveryOutcome, type ValidationFeedback } from "@/app/discover/_components/discovery-state";

const ready: DiscoveryOutcome = { status: "ready", page: { items: [], nextCursor: null } };
const invalid: DiscoveryOutcome = { status: "invalid", fieldErrors: { date: ["Choose a date"] } };

describe("discovery screen transitions", () => {
  test("keeps the authoritative server result when there is no local feedback", () => {
    expect(deriveDiscoveryState(ready, false, { status: "idle" })).toBe(ready);
  });

  test("invalid local submission hides results until a correction clears feedback", () => {
    const feedback: ValidationFeedback = { status: "invalid", fieldErrors: { date: ["Choose a date"] } };
    expect(deriveDiscoveryState(ready, false, feedback).status).toBe("invalid");
    expect(deriveDiscoveryState(ready, false, { status: "idle" })).toBe(ready);
  });

  test.each<DiscoveryOutcome>([
    ready,
    invalid,
    { status: "error", kind: "unavailable" },
    { status: "error", kind: "unexpected" },
  ])("navigation replaces $status with loading, then reveals the new server outcome", (outcome) => {
    expect(deriveDiscoveryState(outcome, true, { status: "invalid", fieldErrors: { date: ["Old feedback"] } })).toEqual({ status: "loading" });
    expect(deriveDiscoveryState(outcome, false, { status: "idle" })).toBe(outcome);
  });

  test("empty results remain a ready result, with no separate boolean to synchronize", () => {
    expect(deriveDiscoveryState(ready, false, { status: "idle" })).toEqual({ status: "ready", page: { items: [], nextCursor: null } });
  });
});
