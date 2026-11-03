import { describe, expect, test } from "vitest";
import { TimelineGesture, type TimelineGestureInput } from "@/app/sessions/_components/timeline-gesture";

function input(delta: number, now: number, options: Partial<TimelineGestureInput> = {}): TimelineGestureInput {
  return { delta, now, momentum: false, transitioning: false, hasNeighbor: true, ...options };
}

describe("timeline wheel gestures", () => {
  test.each([-1, 1])("accumulates small inputs to one adjacent navigation in direction %s", (direction) => {
    const gesture = new TimelineGesture();
    expect(gesture.phase).toBe("ready");
    expect(gesture.handle(input(direction * 9, 0))).toEqual({ kind: "consume" });
    expect(gesture.phase).toBe("accumulating");
    expect(gesture.handle(input(direction * 14, 10))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(direction, 20))).toEqual({ kind: "navigate", direction });
    expect(gesture.phase).toBe("transitioning");
    expect(gesture.handle(input(direction * 100, 30, { transitioning: true }))).toEqual({ kind: "consume" });
  });

  test("a large flick advances once and its tiny tail keeps the burst owned beyond the animation", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(1500, 0))).toEqual({ kind: "navigate", direction: 1 });
    expect(gesture.handle(input(80, 150, { transitioning: true }))).toEqual({ kind: "consume" });
    gesture.transitionCompleted();
    expect(gesture.phase).toBe("momentum-consuming");
    for (const now of [300, 450, 600, 750]) {
      expect(gesture.handle(input(0.01, now))).toEqual({ kind: "consume" });
    }
    expect(gesture.handle(input(100, 969))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(24, 1189))).toEqual({ kind: "navigate", direction: 1 });
  });

  test("a quiet interval discards incomplete intent", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(23, 0))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(1, 220))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(23, 221))).toEqual({ kind: "navigate", direction: 1 });
  });

  test("reversal before commitment requires a complete threshold in the new direction", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(23, 0))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(-1, 10))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(-22, 20))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(-1, 30))).toEqual({ kind: "navigate", direction: -1 });
  });

  test("tiny direction jitter after commitment does not rearm or reverse navigation", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(24, 0))).toEqual({ kind: "navigate", direction: 1 });
    expect(gesture.handle(input(-2, 100, { transitioning: true }))).toEqual({ kind: "consume" });
    gesture.transitionCompleted();
    expect(gesture.handle(input(100, 200))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(-24, 420))).toEqual({ kind: "navigate", direction: -1 });
  });

  test.each([-1, 1])("a deliberate reversal responds before the quiet interval, direction %s", (direction) => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(direction * 40, 0))).toEqual({ kind: "navigate", direction });
    gesture.transitionCompleted();
    expect(gesture.handle(input(-direction * 12, 80))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(-direction * 12, 96))).toEqual({ kind: "navigate", direction: -direction });
  });

  test("a reversal during a glide queues once and consumes its tail", () => {
    const gesture = new TimelineGesture();
    gesture.handle(input(40, 0));
    expect(gesture.handle(input(-30, 80, { transitioning: true }))).toEqual({ kind: "queue", direction: -1 });
    expect(gesture.handle(input(-20, 96, { transitioning: true }))).toEqual({ kind: "consume" });
  });

  test.each([-1, 1])("a renewed push after a decaying tail starts a fresh gesture, direction %s", (direction) => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(direction * 80, 0))).toEqual({ kind: "navigate", direction });
    for (const [index, delta] of [40, 10, 2, 20].entries()) {
      expect(gesture.handle(input(direction * delta, (index + 1) * 16, { transitioning: true }))).toEqual({ kind: "consume" });
    }
    expect(gesture.handle(input(direction * 18, 80, { transitioning: true }))).toEqual({ kind: "queue", direction });
    gesture.transitionCompleted();
    expect(gesture.handle(input(direction * 12, 96))).toEqual({ kind: "consume" });
  });

  test.each([
    { name: "initial acceleration", deltas: [24, 40, 80, 60, 40, 20, 10, 2, 4, 1, 6, 2] },
    { name: "isolated spike", deltas: [80, 40, 10, 2, 100, 1, 2] },
    { name: "spike followed by small tail", deltas: [80, 40, 10, 2, 100, 4] },
    { name: "spike followed by larger tail", deltas: [80, 40, 10, 2, 100, 12] },
    { name: "sustained tiny tail noise", deltas: [80, 40, 10, 2, 4, 4, 4, 4, 4, 4] },
    { name: "direction jitter", deltas: [80, 40, 10, 2, -2, -3, 2, -4, 1] },
  ])("$name stays one gesture", ({ deltas }) => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(deltas[0]!, 0))).toEqual({ kind: "navigate", direction: 1 });
    for (const [index, delta] of deltas.slice(1).entries()) {
      expect(gesture.handle(input(delta, (index + 1) * 16))).toEqual({ kind: "consume" });
    }
  });

  test("a renewed push can start decelerating without being mistaken for the old tail", () => {
    const gesture = new TimelineGesture();
    gesture.handle(input(80, 0));
    for (const [index, delta] of [40, 10, 2, 40].entries()) {
      expect(gesture.handle(input(delta, (index + 1) * 16))).toEqual({ kind: "consume" });
    }
    expect(gesture.handle(input(20, 80))).toEqual({ kind: "navigate", direction: 1 });
  });

  test("explicit momentum cannot rearm on either a reversal or renewed acceleration", () => {
    const gesture = new TimelineGesture();
    gesture.handle(input(80, 0));
    for (const [index, delta] of [40, 10, 2, 40, 50, -40, -50].entries()) {
      expect(gesture.handle(input(delta, (index + 1) * 16, { momentum: true }))).toEqual({ kind: "consume" });
    }
  });

  test("only a fresh qualifying burst queues during an unfinished transition", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(24, 0))).toEqual({ kind: "navigate", direction: 1 });
    expect(gesture.handle(input(-12, 220, { transitioning: true }))).toEqual({ kind: "consume" });
    expect(gesture.phase).toBe("accumulating");
    expect(gesture.handle(input(-12, 230, { transitioning: true }))).toEqual({ kind: "queue", direction: -1 });
    expect(gesture.handle(input(-80, 240, { transitioning: true }))).toEqual({ kind: "consume" });
    gesture.transitionCompleted();
    expect(gesture.handle(input(-80, 250))).toEqual({ kind: "consume" });
  });

  test("an earlier animation can complete while the next gesture is still accumulating", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(12, 0, { transitioning: true }))).toEqual({ kind: "consume" });
    gesture.transitionCompleted();
    expect(gesture.phase).toBe("accumulating");
    expect(gesture.handle(input(12, 10))).toEqual({ kind: "navigate", direction: 1 });
  });

  test.each([-1, 1])("a fresh outward boundary burst passes throughout, direction %s", (direction) => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(direction * 1, 0, { hasNeighbor: false }))).toEqual({ kind: "pass" });
    expect(gesture.phase).toBe("ready");
    // Pagination or direction jitter must not steal an already native burst.
    expect(gesture.handle(input(direction * 100, 50))).toEqual({ kind: "pass" });
    expect(gesture.handle(input(-direction * 100, 100))).toEqual({ kind: "pass" });
    expect(gesture.handle(input(-direction * 24, 320))).toEqual({ kind: "navigate", direction: -direction });
  });

  test("reaching the final session does not release the committed burst to native scrolling", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(24, 0))).toEqual({ kind: "navigate", direction: 1 });
    gesture.transitionCompleted();
    expect(gesture.handle(input(400, 100, { hasNeighbor: false }))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(1, 200, { hasNeighbor: false }))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(24, 420, { hasNeighbor: false }))).toEqual({ kind: "pass" });
  });

  test("explicit momentum continues owned input even after a long scheduling gap", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(24, 0))).toEqual({ kind: "navigate", direction: 1 });
    gesture.transitionCompleted();
    expect(gesture.handle(input(200, 1000, { momentum: true, hasNeighbor: false }))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(30, 1100))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(-24, 1320))).toEqual({ kind: "navigate", direction: -1 });
  });

  test("unowned momentum passes without starting navigation or donating its distance", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(100, 0, { momentum: true }))).toEqual({ kind: "pass" });
    expect(gesture.handle(input(100, 10, { momentum: true }))).toEqual({ kind: "pass" });
    expect(gesture.handle(input(100, 100))).toEqual({ kind: "pass" });
    expect(gesture.handle(input(23, 320))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(1, 321))).toEqual({ kind: "navigate", direction: 1 });
  });

  test("explicit momentum cannot complete an under-threshold gesture", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(12, 0))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(100, 10, { momentum: true }))).toEqual({ kind: "consume" });
    expect(gesture.phase).toBe("momentum-consuming");
    expect(gesture.handle(input(100, 20))).toEqual({ kind: "consume" });
    expect(gesture.handle(input(24, 240))).toEqual({ kind: "navigate", direction: 1 });
  });

  test("reset releases prior ownership and permits a new deliberate gesture", () => {
    const gesture = new TimelineGesture();
    expect(gesture.handle(input(24, 0))).toEqual({ kind: "navigate", direction: 1 });
    gesture.reset();
    expect(gesture.phase).toBe("ready");
    expect(gesture.handle(input(100, 10, { momentum: true }))).toEqual({ kind: "pass" });
    gesture.reset();
    expect(gesture.handle(input(-24, 20))).toEqual({ kind: "navigate", direction: -1 });
  });
});
