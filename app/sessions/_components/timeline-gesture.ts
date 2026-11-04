export type TimelineGestureDirection = -1 | 1;
export type TimelineGesturePhase = "ready" | "accumulating" | "transitioning" | "momentum-consuming";

export interface TimelineGestureInput {
  /** Qualifying vertical wheel distance, normalized to pixels by the caller. */
  readonly delta: number;
  /** Monotonic event time in milliseconds. */
  readonly now: number;
  readonly momentum: boolean;
  readonly transitioning: boolean;
  /** Whether the input's direction has an adjacent session. */
  readonly hasNeighbor: boolean;
}

export type TimelineGestureDecision =
  | { readonly kind: "pass" | "consume" }
  | { readonly kind: "navigate" | "queue"; readonly direction: TimelineGestureDirection };

const intentThreshold = 24;
const quietInterval = 220;

/** Own one wheel burst independently of how long its visual transition takes. */
export class TimelineGesture {
  private currentPhase: TimelineGesturePhase = "ready";
  private lastEventAt: number | null = null;
  private ownership: "none" | "timeline" | "page" = "none";
  private direction: TimelineGestureDirection | null = null;
  private distance = 0;
  private committed = false;
  private peak = 0;
  private previousMagnitude = 0;
  private decreasingSamples = 0;
  private tailFloor: number | null = null;
  private renewed: { direction: TimelineGestureDirection; distance: number; samples: number } | null = null;

  get phase(): TimelineGesturePhase { return this.currentPhase; }

  handle({ delta, now, momentum, transitioning, hasNeighbor }: TimelineGestureInput): TimelineGestureDecision {
    if (!Number.isFinite(delta) || !Number.isFinite(now) || delta === 0) return { kind: "pass" };

    // A positive browser momentum signal remains a tail even after a delayed
    // event. It can neither create navigation nor transfer page-owned input.
    if (momentum) {
      this.lastEventAt = now;
      this.renewed = null;
      if (this.ownership !== "timeline") {
        this.ownership = "page";
        this.currentPhase = "ready";
        return { kind: "pass" };
      }
      this.committed = true;
      this.currentPhase = transitioning ? "transitioning" : "momentum-consuming";
      return { kind: "consume" };
    }

    // Browsers without a momentum signal use this quiet interval as a burst
    // heuristic. Completing an animation never starts another burst by itself.
    if (this.lastEventAt === null || now - this.lastEventAt >= quietInterval) this.reset();
    this.lastEventAt = now;
    if (this.ownership === "page") return { kind: "pass" };
    let distance = Math.abs(delta);
    if (this.committed) {
      const renewed = this.freshIntent(delta);
      if (!renewed) {
        this.currentPhase = transitioning ? "transitioning" : "momentum-consuming";
        return { kind: "consume" };
      }
      distance = renewed.distance;
      this.committed = false;
      this.distance = 0;
      this.direction = null;
    }

    if (!hasNeighbor) {
      this.ownership = "page";
      this.currentPhase = "ready";
      return { kind: "pass" };
    }

    const direction = delta < 0 ? -1 : 1;
    this.distance = this.direction === direction ? this.distance + distance : distance;
    this.direction = direction;
    this.ownership = "timeline";
    this.currentPhase = "accumulating";
    if (this.distance < intentThreshold) return { kind: "consume" };

    this.committed = true;
    this.peak = this.previousMagnitude = Math.abs(delta);
    this.decreasingSamples = 0;
    this.tailFloor = null;
    this.renewed = null;
    this.currentPhase = "transitioning";
    return { kind: transitioning ? "queue" : "navigate", direction };
  }

  /** Distinguish another physical push from the previous swipe's fading tail. */
  private freshIntent(delta: number) {
    const direction = delta < 0 ? -1 : 1;
    const magnitude = Math.abs(delta);
    const reversing = direction !== this.direction;
    // A same-direction push must follow actual decay. Initial acceleration
    // belongs to the first swipe, even if its deltas exceed the threshold.
    const renewedPush = this.tailFloor !== null && magnitude >= Math.max(intentThreshold / 2, this.tailFloor * 2, this.previousMagnitude / 2);
    if (reversing || renewedPush) {
      const previous = this.renewed;
      this.renewed = {
        direction,
        distance: (previous?.direction === direction ? previous.distance : 0) + magnitude,
        samples: (previous?.direction === direction ? previous.samples : 0) + 1,
      };
    } else this.renewed = null;

    if (!reversing) {
      this.peak = Math.max(this.peak, magnitude);
      this.decreasingSamples = magnitude < this.previousMagnitude ? this.decreasingSamples + 1 : 0;
      if (this.decreasingSamples >= 2 && magnitude <= this.peak / 4) this.tailFloor = Math.min(this.tailFloor ?? magnitude, magnitude);
      this.previousMagnitude = magnitude;
    }
    // Reject isolated spikes and tiny tail noise: two substantial packets
    // must sustain at least half the preceding magnitude. Reversal needs 24 px.
    return this.renewed && this.renewed.distance >= intentThreshold && (reversing || this.renewed.samples >= 2) ? this.renewed : null;
  }

  transitionCompleted(): void {
    if (this.currentPhase === "transitioning") this.currentPhase = "momentum-consuming";
  }

  /** Release input ownership after a dialog, direct navigation or native takeover. */
  reset(): void {
    this.currentPhase = "ready";
    this.lastEventAt = null;
    this.ownership = "none";
    this.direction = null;
    this.distance = 0;
    this.committed = false;
    this.peak = this.previousMagnitude = this.decreasingSamples = 0;
    this.tailFloor = null;
    this.renewed = null;
  }
}
