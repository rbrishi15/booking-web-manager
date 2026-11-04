"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type { SessionFeedItem } from "../session-feed-contract";
import { TimelineGesture } from "./timeline-gesture";

type Weights = Readonly<Record<string, number>>;
type Stop = { id: string; top: number };
const NAVIGATION_KEYS = ["PageUp", "ArrowUp", "Home", "PageDown", "ArrowDown", "End"];
const OPEN_DELAY = 200;
const OPEN_DURATION = 280;
const MARKER_DURATION = 180;
const CLOSE_DURATION = 160;

function acceptsInput(root: HTMLElement, event: WheelEvent | ReactKeyboardEvent<HTMLElement>) {
  if (!window.matchMedia("(min-width: 768px)").matches || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (document.querySelector('[role="dialog"],dialog[open]') || !(event.target instanceof Element)) return false;
  if (event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="listbox"],[role="menu"],[role="slider"]')) return false;
  for (let node: Element | null = event.target; node && node !== root; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return false;
  }
  return true;
}

/** Close the current card, position the compact destination, then open after quiet. */
export function useTimelineNavigation({ sessions, active, setActive, scrollTargetId, onUrlRestored }: {
  readonly sessions: readonly SessionFeedItem[];
  readonly active: string;
  readonly setActive: (id: string) => void;
  readonly scrollTargetId?: string | null;
  readonly onUrlRestored?: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const positions = useRef<Stop[]>([]);
  const selected = useRef(active);
  const [weights, setWeights] = useState<Weights>({ [active]: 1 });
  const weightsRef = useRef(weights);
  const [marker, setMarker] = useState(0);
  const markerPosition = useRef(0);
  const markerSession = useRef(active);
  const markerFrame = useRef<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const animation = useRef<{ frame: number; token: number } | null>(null);
  const closing = useRef<{ frame: number; target: string } | null>(null);
  const openingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const gesture = useRef(new TimelineGesture());
  const recoveryTarget = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const positioned = useRef(false);
  const viewportAnchor = useRef<{ id: string; top: number } | null>(null);
  const controlledScroll = useRef<number | null>(null);

  const publish = useCallback((next: Weights) => {
    weightsRef.current = next;
    setWeights(next);
  }, []);

  const recordScroll = useCallback(() => {
    // Native scroll events may arrive after several animation frames. Match
    // their actual position instead of expiring ownership on a frame deadline.
    controlledScroll.current = window.scrollY;
  }, []);

  const stopOpening = useCallback(() => {
    ++generation.current;
    if (openingTimer.current !== null) clearTimeout(openingTimer.current);
    openingTimer.current = null;
    if (animation.current) cancelAnimationFrame(animation.current.frame);
    if (closing.current) cancelAnimationFrame(closing.current.frame);
    animation.current = null;
    closing.current = null;
    setTransitioning(false);
  }, []);

  const cancel = useCallback((settleTo = closing.current?.target ?? selected.current) => {
    stopOpening();
    gesture.current.reset();
    recoveryTarget.current = null;
    selected.current = settleTo;
    setActive(settleTo);
    publish({ [settleTo]: 1 });
  }, [publish, setActive, stopOpening]);

  const open = useCallback((id: string, token: number) => {
    openingTimer.current = null;
    if (generation.current !== token || selected.current !== id || !rows.current.has(id) || document.hidden || document.querySelector('[role="dialog"],dialog[open]')) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      publish({ [id]: 1 });
      return;
    }
    const started = performance.now();
    const state = { frame: 0, token };
    animation.current = state;
    setTransitioning(true);
    const tick = (now: number) => {
      if (generation.current !== token) return;
      const fraction = Math.min(1, (now - started) / OPEN_DURATION);
      publish({ [id]: 1 - (1 - fraction) ** 3 });
      // Expanding this row changes only the space below it. Page position is
      // never interpolated; the reserved feature space keeps the scrollbar stable.
      if (fraction < 1) state.frame = requestAnimationFrame(tick);
      else { animation.current = null; setTransitioning(false); }
    };
    state.frame = requestAnimationFrame(tick);
  }, [publish]);

  const place = useCallback((id: string, focus = false, deferOpening = false) => {
    const stop = positions.current.find((position) => position.id === id);
    if (!stop) return;
    stopOpening();
    if (!deferOpening) { gesture.current.reset(); recoveryTarget.current = null; }
    const focused = document.activeElement;
    if (focus || (focused instanceof HTMLElement && rows.current.get(selected.current)?.contains(focused) && !focused.matches("[data-date-control]"))) pendingFocus.current = id;
    selected.current = id;
    flushSync(() => { setActive(id); publish({}); });
    window.scrollTo({ top: stop.top, behavior: "instant" });
    recordScroll();
    const token = generation.current;
    if (deferOpening) openingTimer.current = setTimeout(() => open(id, token), OPEN_DELAY);
    else open(id, token);
  }, [open, publish, recordScroll, setActive, stopOpening]);

  const select = useCallback((id: string, focus = false, deferOpening = false) => {
    if (!positions.current.some((position) => position.id === id)) return;
    if (!deferOpening || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      place(id, focus, deferOpening);
      return;
    }
    // Input can redirect an in-flight close without restarting it. The old
    // card finishes closing before the page is placed at the compact new row.
    if (closing.current) { closing.current.target = id; return; }
    const from = weightsRef.current;
    if (!Object.values(from).some((weight) => weight > 0)) { place(id, focus, true); return; }
    stopOpening();
    const state = { frame: 0, target: id };
    const token = generation.current;
    const started = performance.now();
    closing.current = state;
    setTransitioning(true);
    const tick = (now: number) => {
      if (generation.current !== token) return;
      const fraction = Math.min(1, (now - started) / CLOSE_DURATION);
      publish(Object.fromEntries(Object.entries(from).map(([key, weight]) => [key, weight * (1 - fraction) ** 3])));
      if (fraction < 1) state.frame = requestAnimationFrame(tick);
      else {
        closing.current = null;
        place(state.target, focus, true);
      }
    };
    state.frame = requestAnimationFrame(tick);
  }, [place, publish, stopOpening]);

  useLayoutEffect(() => {
    if (selected.current !== active) cancel(active);
  }, [active, cancel]);

  useLayoutEffect(() => {
    if (pendingFocus.current) {
      rows.current.get(pendingFocus.current)?.querySelector<HTMLButtonElement>("[data-date-control]")?.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
    const root = list.current;
    if (!root) return;
    const target = () => {
      const day = rows.current.get(selected.current)?.querySelector<HTMLElement>("[data-date-control] time strong");
      if (!day) return markerPosition.current;
      const bounds = day.getBoundingClientRect();
      return bounds.top - root.getBoundingClientRect().top + bounds.height / 2;
    };
    const move = (position: number) => { markerPosition.current = position; setMarker(position); };
    if (markerSession.current !== selected.current) {
      markerSession.current = selected.current;
      if (markerFrame.current !== null) cancelAnimationFrame(markerFrame.current);
      markerFrame.current = null;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        // Retarget from the visible position, including a reversal mid-flight.
        // Only the dot/rail animate; this never writes the page scroll position.
        const from = markerPosition.current;
        const started = performance.now();
        const tick = (now: number) => {
          const fraction = Math.min(1, (now - started) / MARKER_DURATION);
          move(from + (target() - from) * (1 - (1 - fraction) ** 3));
          markerFrame.current = fraction < 1 ? requestAnimationFrame(tick) : null;
        };
        markerFrame.current = requestAnimationFrame(tick);
      }
    }
    if (markerFrame.current === null) move(target());
  }, [active, weights, sessions]);

  useLayoutEffect(() => {
    // Feed insertion must use the previous viewport anchor, before new rows
    // change this row's position. Measurement below applies the correction.
    const row = rows.current.get(selected.current);
    if (row) viewportAnchor.current = { id: selected.current, top: row.getBoundingClientRect().top };
  }, [active, weights]);

  useLayoutEffect(() => {
    const root = list.current;
    const header = root?.closest("[data-view]")?.querySelector("header");
    if (!root || !header) return;
    const desktop = window.matchMedia("(min-width: 768px)");
    let measured = "";
    const measure = (initial = false, realign = false) => {
      if (!desktop.matches) { positioned.current = false; cancel(); return; }
      const features = Array.from(root.querySelectorAll<HTMLElement>("[data-timeline-feature]"));
      const readingTop = (parseFloat(getComputedStyle(header).top) || 0) + header.getBoundingClientRect().height + 28;
      const width = features[0]?.getBoundingClientRect().width ?? 0;
      const copyHeight = Math.max(0, ...features.map((feature) => feature.offsetHeight - (feature.querySelector<HTMLElement>('[data-timeline-reveal="hero"]')?.offsetHeight ?? 0)));
      const naturalPhoto = Math.min(420, Math.max(240, width * 3 / 8));
      const photo = Math.min(naturalPhoto, Math.max(120, window.innerHeight - readingTop - copyHeight - 24));
      const signature = `${width}:${copyHeight}:${readingTop}:${photo}:${window.innerHeight}`;
      if (!initial && measured === signature) return;
      measured = signature;
      const anchor = viewportAnchor.current;
      // A changing feed or viewport invalidates pending opening coordinates.
      if (markerFrame.current !== null) cancelAnimationFrame(markerFrame.current);
      markerFrame.current = null;
      const interrupted = Boolean(animation.current || closing.current || openingTimer.current);
      if (interrupted) cancel();
      root.style.setProperty("--timeline-photo-height", `${photo}px`);
      const height = Math.max(112, ...features.map((feature) => feature.offsetHeight));
      const extra = height - 112;
      root.style.setProperty("--feature-extra", `${extra}px`);
      root.style.setProperty("--feature-height", `${height}px`);
      root.style.setProperty("--reading-top", `${readingTop}px`);
      let expansionAbove = 0;
      const natural = sessions.flatMap((session) => {
        const row = rows.current.get(session.sessionId);
        if (!row) return [];
        const heading = row.previousElementSibling;
        const label = heading?.matches("h2") ? heading.getBoundingClientRect().height : 0;
        const top = row.getBoundingClientRect().top + window.scrollY - expansionAbove * extra;
        // Use committed DOM weights: a layout-effect cancellation has not painted yet.
        expansionAbove += Number(row.style.getPropertyValue("--expansion"));
        return [{ id: session.sessionId, top, label }];
      });
      positions.current = natural.map((row, index) => {
        const previous = natural[index - 1];
        const context = previous ? row.top - previous.top : 0;
        const room = window.innerHeight - readingTop - height - (index < natural.length - 1 ? 112 : 0) - 24;
        const offset = context && room >= context ? context : row.label;
        return { id: row.id, top: Math.max(0, row.top - readingTop - offset) };
      });
      // Every stop must be reachable, even in a tall viewport or a short feed.
      const padding = parseFloat(getComputedStyle(root).paddingBottom) || 24;
      // scrollHeight is floored to the viewport and hides unused space in a
      // short feed. Measure the actual content edge before adding trailing room.
      const contentBottom = root.getBoundingClientRect().bottom + window.scrollY - padding;
      const nativeEnd = (natural.at(-1)?.top ?? 0) - readingTop + extra;
      const tail = Math.max(24, window.innerHeight + Math.max(positions.current.at(-1)?.top ?? 0, nativeEnd) - contentBottom);
      root.style.setProperty("--timeline-tail", `${tail}px`);
      const currentBounds = rows.current.get(selected.current)?.getBoundingClientRect();
      const visible = currentBounds && currentBounds.bottom > readingTop && currentBounds.top < window.innerHeight;
      const target = scrollTargetId ?? (!positioned.current || interrupted || (realign && visible) ? selected.current : null);
      if (target) {
        const stop = positions.current.find((position) => position.id === target);
        if (stop) {
          selected.current = target;
          publish({ [target]: 1 });
          window.scrollTo({ top: stop.top, behavior: "instant" });
          recordScroll();
          positioned.current = true;
          if (scrollTargetId) onUrlRestored?.();
        }
      } else if (anchor && !document.querySelector('[role="dialog"],dialog[open]')) {
        const row = rows.current.get(anchor.id);
        if (row) {
          const correction = row.getBoundingClientRect().top - anchor.top;
          if (Math.abs(correction) > .5) { window.scrollBy({ top: correction, behavior: "instant" }); recordScroll(); }
        }
      }
      publish({ ...weightsRef.current });
    };
    measure(true);
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => measure());
    });
    observer.observe(root);
    observer.observe(header);
    root.querySelectorAll<HTMLElement>("[data-timeline-feature]").forEach((feature) => observer.observe(feature));
    const onResize = () => { measured = ""; measure(false, true); };
    window.addEventListener("resize", onResize);
    return () => { observer.disconnect(); cancelAnimationFrame(resizeFrame); window.removeEventListener("resize", onResize); };
  }, [sessions, scrollTargetId, onUrlRestored, cancel, publish, recordScroll]);

  useEffect(() => {
    const root = list.current;
    if (!root) return;
    let nativeExit = false;
    const canNavigate = () => window.matchMedia("(min-width: 768px)").matches && !document.hidden && !document.querySelector('[role="dialog"],dialog[open]');
    const onWheel = (event: WheelEvent) => {
      if (!acceptsInput(root, event) || !event.cancelable || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const current = rows.current.get(selected.current)?.getBoundingClientRect();
      const readingTop = parseFloat(getComputedStyle(root).getPropertyValue("--reading-top")) || 0;
      const stops = positions.current;
      let recovery: Stop | undefined;
      if (current && (current.bottom <= readingTop || current.top >= window.innerHeight)) {
        let distance = Infinity;
        for (const stop of stops) {
          const bounds = rows.current.get(stop.id)?.getBoundingClientRect();
          if (!bounds || bounds.bottom <= readingTop || bounds.top >= window.innerHeight) continue;
          const offset = Math.abs(bounds.top - readingTop);
          if (offset < distance) { recovery = stop; distance = offset; }
        }
        if (!recovery) return;
        if (recoveryTarget.current === null) gesture.current.reset();
        recoveryTarget.current = recovery.id;
      } else recoveryTarget.current = null;
      const line = parseFloat(getComputedStyle(root).lineHeight) || 16;
      const delta = event.deltaY * (event.deltaMode === 1 ? line : event.deltaMode === 2 ? window.innerHeight : 1);
      const destination = closing.current?.target ?? selected.current;
      const next = recovery ?? stops[stops.findIndex((position) => position.id === destination) + (delta > 0 ? 1 : -1)];
      // Gesture ownership is independent of animation. New intent redirects
      // the destination instead of queuing behind opening or page scrolling.
      const decision = gesture.current.handle({ delta, now: performance.now(), momentum: "momentum" in event && event.momentum === true, transitioning: false, hasNeighbor: Boolean(next) });
      // Do not release page scrolling while a close still owns a pending seek.
      // The next outward packet can pass once the compact boundary is placed.
      nativeExit = decision.kind === "pass" && closing.current === null;
      if (nativeExit) return;
      event.preventDefault();
      select(decision.kind === "navigate" && next ? next.id : destination, false, true);
      gesture.current.transitionCompleted();
    };
    const onScroll = () => {
      const ownScroll = window.scrollY === controlledScroll.current;
      if (!ownScroll) controlledScroll.current = null;
      if (!ownScroll && !nativeExit && canNavigate()) {
        const readingTop = parseFloat(getComputedStyle(root).getPropertyValue("--reading-top")) || 0;
        const readingLine = readingTop + 63;
        const current = rows.current.get(selected.current)?.getBoundingClientRect();
        // In short windows a fully open card cannot fit below the header.
        // Let native scrolling reveal its actions before choosing another date.
        if (weightsRef.current[selected.current] === 1 && current && current.height > window.innerHeight - readingTop - 24 && current.top <= readingLine && current.bottom > readingLine) {
          viewportAnchor.current = { id: selected.current, top: current.top };
          return;
        }
        const dates = Array.from(rows.current, ([id, row]) => {
          const date = row.querySelector<HTMLElement>("[data-date-control] time strong")!.getBoundingClientRect();
          return { id, center: date.top + date.height / 2 };
        }).sort((left, right) => left.center - right.center);
        const nearest = dates.reduce<typeof dates[number] | undefined>((best, date) => !best || Math.abs(date.center - readingLine) < Math.abs(best.center - readingLine) ? date : best, undefined);
        // Clamp a scrollbar jump to the nearest boundary. Once that boundary
        // is selected, outward page movement remains native.
        const withinDates = dates.length && readingLine >= dates[0]!.center && readingLine <= dates.at(-1)!.center;
        if (nearest && (withinDates || nearest.id !== selected.current || openingTimer.current !== null)) {
          const row = rows.current.get(nearest.id)!;
          const anchor = row.getBoundingClientRect().top;
          stopOpening();
          gesture.current.reset();
          selected.current = nearest.id;
          flushSync(() => { setActive(nearest.id); publish({}); });
          const correction = row.getBoundingClientRect().top - anchor;
          if (Math.abs(correction) > .5) { window.scrollBy({ top: correction, behavior: "instant" }); recordScroll(); }
          openingTimer.current = setTimeout(() => { if (canNavigate()) select(nearest.id); }, OPEN_DELAY);
        } else if (openingTimer.current !== null || animation.current) cancel();
      }
      if (canNavigate()) {
        const row = rows.current.get(selected.current);
        if (row) viewportAnchor.current = { id: selected.current, top: row.getBoundingClientRect().top };
      }
    };
    const release = (event: Event) => {
      if (event.defaultPrevented) return;
      nativeExit = false;
      if (event.type === "pointerdown" && event.target instanceof Element && root.contains(event.target) && event.target.closest("button,a")) return;
      cancel();
    };
    const dialogs = new MutationObserver(() => { if (document.querySelector('[role="dialog"],dialog[open]')) cancel(); });
    dialogs.observe(document.body, { childList: true });
    const onVisibility = () => { if (document.hidden) cancel(); };
    root.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointerdown", release, { passive: true });
    window.addEventListener("keydown", release);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      ++generation.current;
      if (openingTimer.current !== null) clearTimeout(openingTimer.current);
      if (animation.current) cancelAnimationFrame(animation.current.frame);
      if (closing.current) cancelAnimationFrame(closing.current.frame);
      if (markerFrame.current !== null) cancelAnimationFrame(markerFrame.current);
      openingTimer.current = null;
      animation.current = null;
      closing.current = null;
      controlledScroll.current = null;
      markerFrame.current = null;
      dialogs.disconnect();
      root.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerdown", release);
      window.removeEventListener("keydown", release);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cancel, publish, recordScroll, select, setActive, stopOpening]);

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!list.current || !acceptsInput(list.current, event) || !NAVIGATION_KEYS.includes(event.key)) return;
    if (!(event.target instanceof Element) || !event.target.closest("[data-date-control]")) return;
    const stops = positions.current;
    const index = stops.findIndex((stop) => stop.id === selected.current);
    const target = stops[event.key === "Home" ? 0 : event.key === "End" ? stops.length - 1 : index + (["PageDown", "ArrowDown"].includes(event.key) ? 1 : -1)];
    if (!target) return;
    event.preventDefault();
    select(target.id, true);
  };

  return { list, rows, weights, marker, transitioning, select, onKey };
}
