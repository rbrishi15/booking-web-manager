"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type { SessionFeedItem } from "../session-feed-contract";
import { TimelineGesture } from "./timeline-gesture";

type Weights = Readonly<Record<string, number>>;
type Stop = { id: string; top: number };
const NAVIGATION_KEYS = ["PageUp", "ArrowUp", "Home", "PageDown", "ArrowDown", "End"];
const DURATION = 280;

function acceptsInput(root: HTMLElement, event: WheelEvent | ReactKeyboardEvent<HTMLElement>) {
  if (!window.matchMedia("(min-width: 768px)").matches || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (document.querySelector('[role="dialog"],dialog[open]') || !(event.target instanceof Element)) return false;
  if (event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="listbox"],[role="menu"],[role="slider"]')) return false;
  for (let node: Element | null = event.target; node && node !== root; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return false;
  }
  return true;
}

/** Owns a finite transition; ordinary document scrolling never changes selection. */
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
  const [transitioning, setTransitioning] = useState(false);
  const animation = useRef<{ frame: number; token: number; lastScroll: number } | null>(null);
  const generation = useRef(0);
  const gesture = useRef(new TimelineGesture());
  const pendingGesture = useRef<-1 | 1 | null>(null);
  const recoveryTarget = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const positioned = useRef(false);
  const viewportAnchor = useRef<{ id: string; top: number } | null>(null);
  const navigateRef = useRef<(id: string) => void>(() => {});

  const publish = useCallback((next: Weights) => {
    weightsRef.current = next;
    setWeights(next);
  }, []);

  const cancel = useCallback((settleTo?: string, preserveGesture = false) => {
    const running = animation.current;
    ++generation.current;
    if (running) cancelAnimationFrame(running.frame);
    animation.current = null;
    pendingGesture.current = null;
    if (!preserveGesture) { gesture.current.reset(); recoveryTarget.current = null; }
    setTransitioning(false);
    if (!running) return;
    const nearest = settleTo ?? Object.entries(weightsRef.current).reduce((best, entry) => entry[1] > best[1] ? entry : best, [selected.current, -1] as [string, number])[0];
    selected.current = nearest;
    setActive(nearest);
    publish({ [nearest]: 1 });
    // Native takeover owns scrollY. In particular, never finish an old seek here.
  }, [publish, setActive]);

  const select = useCallback((id: string, focus = false) => {
    const stop = positions.current.find((position) => position.id === id);
    if (!stop) return;
    const previous = animation.current;
    if (previous) cancelAnimationFrame(previous.frame);
    const token = ++generation.current;
    pendingGesture.current = null;
    const start = { ...weightsRef.current };
    const startY = window.scrollY;
    const focused = document.activeElement;
    if (focus) pendingFocus.current = id;
    if (focused instanceof HTMLElement && rows.current.get(selected.current)?.contains(focused) && !focused.matches("[data-date-control]")) pendingFocus.current = id;
    selected.current = id;
    setActive(id);
    const complete = () => {
      if (generation.current !== token) return;
      animation.current = null;
      setTransitioning(false);
      gesture.current.transitionCompleted();
      const direction = pendingGesture.current;
      pendingGesture.current = null;
      if (direction) {
        const stops = positions.current;
        const next = stops[stops.findIndex((position) => position.id === id) + direction];
        if (next) navigateRef.current(next.id);
      }
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      publish({ [id]: 1 });
      window.scrollTo({ top: stop.top, behavior: "instant" });
      complete();
      return;
    }
    const started = performance.now();
    const state = { frame: 0, token, lastScroll: startY };
    animation.current = state;
    setTransitioning(true);
    const tick = (now: number) => {
      if (generation.current !== token) return;
      const fraction = Math.min(1, (now - started) / DURATION);
      const mix = 1 - (1 - fraction) ** 3;
      const next: Record<string, number> = {};
      for (const [key, weight] of Object.entries(start)) if (weight > 0 && fraction < 1) next[key] = weight * (1 - mix);
      next[id] = (next[id] ?? 0) + mix;
      // Commit geometry before the matching scroll write, so neither can lag a frame.
      flushSync(() => publish(fraction === 1 ? { [id]: 1 } : next));
      // A layout effect may have cancelled this seek while committing geometry.
      if (generation.current !== token || animation.current !== state) return;
      window.scrollTo({ top: startY + (stop.top - startY) * mix, behavior: "instant" });
      state.lastScroll = window.scrollY;
      if (fraction < 1) state.frame = requestAnimationFrame(tick);
      else complete();
    };
    state.frame = requestAnimationFrame(tick);
  }, [publish, setActive]);

  useLayoutEffect(() => { navigateRef.current = select; }, [select]);

  useLayoutEffect(() => {
    if (selected.current !== active) {
      cancel(active);
      selected.current = active;
      publish({ [active]: 1 });
    }
  }, [active, cancel, publish]);

  useLayoutEffect(() => {
    if (pendingFocus.current) {
      rows.current.get(pendingFocus.current)?.querySelector<HTMLButtonElement>("[data-date-control]")?.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
    const root = list.current;
    if (!root) return;
    let center = 0;
    for (const [id, weight] of Object.entries(weights)) {
      const day = rows.current.get(id)?.querySelector<HTMLElement>("[data-date-control] time strong");
      if (day && weight) {
        const bounds = day.getBoundingClientRect();
        center += weight * (bounds.top - root.getBoundingClientRect().top + bounds.height / 2);
      }
    }
    setMarker(center);
  }, [active, weights, sessions]);

  useLayoutEffect(() => {
    const row = rows.current.get(active);
    if (row) viewportAnchor.current = { id: active, top: row.getBoundingClientRect().top };
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
      // A changing feed or viewport invalidates all coordinates of an old glide.
      const interrupted = Boolean(animation.current);
      if (interrupted) cancel(selected.current);
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
      const tail = Math.max(24, window.innerHeight + (positions.current.at(-1)?.top ?? 0) - contentBottom);
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
          positioned.current = true;
          if (scrollTargetId) onUrlRestored?.();
        }
      } else if (anchor && !document.querySelector('[role="dialog"],dialog[open]')) {
        const row = rows.current.get(anchor.id);
        if (row) {
          const correction = row.getBoundingClientRect().top - anchor.top;
          if (Math.abs(correction) > .5) window.scrollBy({ top: correction, behavior: "instant" });
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
  }, [sessions, scrollTargetId, onUrlRestored, cancel, publish]);

  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const classified = new WeakSet<Event>();
    const onWheel = (event: WheelEvent) => {
      if (!acceptsInput(root, event) || !event.cancelable || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const current = rows.current.get(selected.current)?.getBoundingClientRect();
      const readingTop = parseFloat(getComputedStyle(root).getPropertyValue("--reading-top")) || 0;
      const stops = positions.current;
      let recovery: Stop | undefined;
      if (!animation.current && current && (current.bottom <= readingTop || current.top >= window.innerHeight)) {
        // Native scrolling can carry the selected card entirely out of view.
        // Resume at what the person is reading, rather than navigating from
        // that off-screen selection or leaving every visible row collapsed.
        let distance = Infinity;
        for (const stop of stops) {
          const bounds = rows.current.get(stop.id)?.getBoundingClientRect();
          if (!bounds || bounds.bottom <= readingTop || bounds.top >= window.innerHeight) continue;
          const offset = Math.abs(bounds.top - readingTop);
          if (offset < distance) { recovery = stop; distance = offset; }
        }
        if (!recovery) return;
        // Reset boundary ownership once on entry, not when native momentum
        // changes the visible candidate between small trackpad packets:
        // the usual intent threshold and explicit momentum rules still apply.
        if (recoveryTarget.current === null) gesture.current.reset();
        recoveryTarget.current = recovery.id;
      } else recoveryTarget.current = null;
      const line = parseFloat(getComputedStyle(root).lineHeight) || 16;
      const delta = event.deltaY * (event.deltaMode === 1 ? line : event.deltaMode === 2 ? window.innerHeight : 1);
      const direction = delta > 0 ? 1 : -1;
      const next = recovery ?? stops[stops.findIndex((position) => position.id === selected.current) + direction];
      const decision = gesture.current.handle({ delta, now: performance.now(), momentum: "momentum" in event && event.momentum === true, transitioning: Boolean(animation.current), hasNeighbor: Boolean(next) });
      classified.add(event);
      if (decision.kind === "pass") return;
      event.preventDefault();
      if (decision.kind === "navigate" && next) select(next.id);
      if (decision.kind === "queue") pendingGesture.current = decision.direction;
    };
    const onScroll = () => {
      const running = animation.current;
      if (running && Math.abs(window.scrollY - running.lastScroll) > 1) cancel();
      if (!document.querySelector('[role="dialog"],dialog[open]')) {
        const row = rows.current.get(selected.current);
        if (row) viewportAnchor.current = { id: selected.current, top: row.getBoundingClientRect().top };
      }
    };
    const release = (event: Event) => {
      if (event.defaultPrevented) return;
      if (event instanceof KeyboardEvent && root.contains(event.target instanceof Node ? event.target : null) && NAVIGATION_KEYS.includes(event.key)) return;
      // Direct controls will replace the seek in their click handler. Keep the
      // live weights until then, including when clicking a date mid-transition.
      if (event.type === "pointerdown" && event.target instanceof Element && root.contains(event.target) && event.target.closest("button,a")) return;
      cancel(undefined, classified.has(event));
    };
    const dialogs = new MutationObserver(() => {
      if (document.querySelector('[role="dialog"],dialog[open]')) cancel(selected.current);
    });
    dialogs.observe(document.body, { childList: true });
    root.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("pointerdown", release, { passive: true });
    window.addEventListener("keydown", release);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ++generation.current;
      if (animation.current) cancelAnimationFrame(animation.current.frame);
      animation.current = null;
      dialogs.disconnect();
      root.removeEventListener("wheel", onWheel);
      window.removeEventListener("wheel", release);
      window.removeEventListener("pointerdown", release);
      window.removeEventListener("keydown", release);
      window.removeEventListener("scroll", onScroll);
    };
  }, [cancel, select]);

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!list.current || !acceptsInput(list.current, event) || !NAVIGATION_KEYS.includes(event.key)) return;
    const stops = positions.current;
    const index = stops.findIndex((stop) => stop.id === selected.current);
    const target = stops[event.key === "Home" ? 0 : event.key === "End" ? stops.length - 1 : index + (["PageDown", "ArrowDown"].includes(event.key) ? 1 : -1)];
    if (!target) return;
    event.preventDefault();
    pendingFocus.current = target.id;
    select(target.id);
  };

  return { list, rows, weights, marker, transitioning, select, onKey };
}
