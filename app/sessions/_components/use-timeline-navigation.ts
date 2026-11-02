"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type { SessionFeedItem } from "../session-feed-contract";

type Weights = Readonly<Record<string, number>>;
type Stop = { id: string; top: number };
const NAVIGATION_KEYS = ["PageUp", "ArrowUp", "Home", "PageDown", "ArrowDown", "End"];
const DURATION = 280;
const SCROLL_SETTLE_DELAY = 200;

function acceptsInput(root: HTMLElement, event: WheelEvent | ReactKeyboardEvent<HTMLElement>) {
  if (!window.matchMedia("(min-width: 768px)").matches || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (document.querySelector('[role="dialog"],dialog[open]') || !(event.target instanceof Element)) return false;
  if (event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="listbox"],[role="menu"],[role="slider"]')) return false;
  for (let node: Element | null = event.target; node && node !== root; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return false;
  }
  return true;
}

/** Native scrolling moves the marker; a quiet pause opens the nearest session. */
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
  const followingScroll = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const controlledScroll = useRef<number | null>(null);
  const controlledFrame = useRef<number | null>(null);
  const selectAfterScroll = useRef<(id: string) => void>(() => {});
  const [transitioning, setTransitioning] = useState(false);
  const animation = useRef<{ frame: number; token: number; lastScroll: number } | null>(null);
  const generation = useRef(0);
  const pendingFocus = useRef<string | null>(null);
  const positioned = useRef(false);
  const viewportAnchor = useRef<{ id: string; top: number } | null>(null);

  const moveMarker = useCallback((position: number) => {
    markerPosition.current = position;
    setMarker(position);
  }, []);

  const recordScroll = useCallback(() => {
    controlledScroll.current = window.scrollY;
    if (controlledFrame.current !== null) cancelAnimationFrame(controlledFrame.current);
    // A programmatic write can suppress its queued notification, never a later
    // native return to the same coordinate.
    controlledFrame.current = requestAnimationFrame(() => {
      controlledScroll.current = null;
      controlledFrame.current = null;
    });
  }, []);

  const stopFollowing = useCallback(() => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    settleTimer.current = null;
    scrollFrame.current = null;
  }, []);

  const publish = useCallback((next: Weights) => {
    weightsRef.current = next;
    setWeights(next);
  }, []);

  const cancel = useCallback((settleTo?: string) => {
    stopFollowing();
    const running = animation.current;
    ++generation.current;
    if (running) cancelAnimationFrame(running.frame);
    animation.current = null;
    setTransitioning(false);
    if (!running) return;
    const nearest = settleTo ?? Object.entries(weightsRef.current).reduce((best, entry) => entry[1] > best[1] ? entry : best, [selected.current, -1] as [string, number])[0];
    selected.current = nearest;
    setActive(nearest);
    publish({ [nearest]: 1 });
    // Native takeover owns scrollY. In particular, never finish an old seek here.
  }, [publish, setActive, stopFollowing]);

  const select = useCallback((id: string, focus = false, fromScroll = false) => {
    const stop = positions.current.find((position) => position.id === id);
    if (!stop) return;
    const root = list.current;
    const row = rows.current.get(id);
    if (!root || !row) return;
    const markerStart = markerPosition.current + root.getBoundingClientRect().top;
    const anchorTop = row.getBoundingClientRect().top;
    stopFollowing();
    followingScroll.current = fromScroll;
    const previous = animation.current;
    if (previous) cancelAnimationFrame(previous.frame);
    const token = ++generation.current;
    const start = { ...weightsRef.current };
    const startY = window.scrollY;
    // Focus may have scrolled the browser before its queued scroll event arrives.
    recordScroll();
    const focused = document.activeElement;
    if (focus) pendingFocus.current = id;
    if (focused instanceof HTMLElement && rows.current.get(selected.current)?.contains(focused) && !focused.matches("[data-date-control]")) pendingFocus.current = id;
    selected.current = id;
    setActive(id);
    const complete = () => {
      if (generation.current !== token) return;
      animation.current = null;
      followingScroll.current = fromScroll;
      setTransitioning(false);
    };
    const position = (mix: number) => {
      if (fromScroll) {
        // Opening after a pause keeps this date in place as the old card closes.
        const correction = row.getBoundingClientRect().top - anchorTop;
        if (Math.abs(correction) > .5) window.scrollBy({ top: correction, behavior: "instant" });
      } else {
        window.scrollTo({ top: startY + (stop.top - startY) * mix, behavior: "instant" });
      }
      recordScroll();
      const day = row.querySelector<HTMLElement>("[data-date-control] time strong")?.getBoundingClientRect();
      if (day) moveMarker((fromScroll ? markerStart : markerStart + (day.top + day.height / 2 - markerStart) * mix) - root.getBoundingClientRect().top);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      flushSync(() => publish({ [id]: 1 }));
      position(1);
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
      position(mix);
      state.lastScroll = window.scrollY;
      if (fraction < 1) state.frame = requestAnimationFrame(tick);
      else complete();
    };
    state.frame = requestAnimationFrame(tick);
  }, [publish, setActive, moveMarker, stopFollowing, recordScroll]);

  useLayoutEffect(() => { selectAfterScroll.current = (id) => select(id, false, true); }, [select]);

  useLayoutEffect(() => {
    if (selected.current !== active) {
      cancel(active);
      followingScroll.current = false;
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
    if (!root || animation.current || followingScroll.current) return;
    let center = 0;
    for (const [id, weight] of Object.entries(weights)) {
      const day = rows.current.get(id)?.querySelector<HTMLElement>("[data-date-control] time strong");
      if (day && weight) {
        const bounds = day.getBoundingClientRect();
        center += weight * (bounds.top - root.getBoundingClientRect().top + bounds.height / 2);
      }
    }
    moveMarker(center);
  }, [active, weights, sessions, moveMarker]);

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
      const markerScreen = markerPosition.current + root.getBoundingClientRect().top;
      if (initial || realign) stopFollowing();
      if (!desktop.matches) { positioned.current = false; followingScroll.current = false; cancel(); return; }
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
      // Native scrolling must reach the last date while a full card is still
      // open above it. Reserve that space independently of the selected card.
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
          if (Math.abs(correction) > .5) {
            window.scrollBy({ top: correction, behavior: "instant" });
            recordScroll();
          }
        }
      }
      publish({ ...weightsRef.current });
      if (followingScroll.current) moveMarker(markerScreen - root.getBoundingClientRect().top);
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
  }, [sessions, scrollTargetId, onUrlRestored, cancel, publish, stopFollowing, moveMarker, recordScroll]);

  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const canFollow = () => window.matchMedia("(min-width: 768px)").matches && !document.hidden && !document.querySelector('[role="dialog"],dialog[open]');
    const trackScroll = () => {
      scrollFrame.current = null;
      if (!canFollow()) { stopFollowing(); return; }
      const header = root.closest("[data-view]")?.querySelector("header");
      if (!header) return;
      const bounds = root.getBoundingClientRect();
      const readingLine = header.getBoundingClientRect().bottom + 28 + 63;
      if (bounds.top > window.innerHeight || bounds.bottom < readingLine) { stopFollowing(); return; }
      const dates = Array.from(rows.current, ([id, row]) => {
        const day = row.querySelector<HTMLElement>("[data-date-control] time strong")!.getBoundingClientRect();
        return { id, center: day.top + day.height / 2 - bounds.top };
      }).sort((left, right) => left.center - right.center);
      if (!dates.length) return;
      const position = Math.max(dates[0]!.center, Math.min(dates.at(-1)!.center, readingLine - bounds.top));
      followingScroll.current = true;
      moveMarker(position);
      const nearest = dates.reduce((best, date) => Math.abs(date.center - position) < Math.abs(best.center - position) ? date : best);
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        if (canFollow() && rows.current.has(nearest.id)) {
          // The progress dot belongs to scrolling, even when the card stays open.
          if (nearest.id !== selected.current) selectAfterScroll.current(nearest.id);
        }
        else stopFollowing();
      }, SCROLL_SETTLE_DELAY);
    };
    const follow = () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      settleTimer.current = null;
      followingScroll.current = true;
      if (scrollFrame.current === null) scrollFrame.current = requestAnimationFrame(trackScroll);
    };
    const onScroll = () => {
      const running = animation.current;
      const ownScroll = (controlledScroll.current !== null && Math.abs(window.scrollY - controlledScroll.current) <= 1)
        || (running !== null && Math.abs(window.scrollY - running.lastScroll) <= 1);
      controlledScroll.current = null;
      if (!ownScroll) {
        if (running) cancel();
        follow();
      }
      if (!document.querySelector('[role="dialog"],dialog[open]')) {
        const row = rows.current.get(selected.current);
        if (row) viewportAnchor.current = { id: selected.current, top: row.getBoundingClientRect().top };
      }
    };
    const release = (event: Event) => {
      if (event.defaultPrevented) return;
      if (event instanceof WheelEvent) {
        if (!acceptsInput(root, event) || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
        cancel();
        follow();
        return;
      }
      // Direct controls will replace the seek in their click handler. Keep the
      // live weights until then, including when clicking a date mid-transition.
      if (event.type === "pointerdown" && event.target instanceof Element && root.contains(event.target) && event.target.closest("button,a")) return;
      cancel();
    };
    const dialogs = new MutationObserver(() => {
      if (document.querySelector('[role="dialog"],dialog[open]')) cancel(selected.current);
    });
    dialogs.observe(document.body, { childList: true });
    const onVisibility = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", onVisibility);
    // Native wheel/trackpad input owns scrolling and interrupts a click seek.
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("pointerdown", release, { passive: true });
    window.addEventListener("keydown", release);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ++generation.current;
      if (animation.current) cancelAnimationFrame(animation.current.frame);
      animation.current = null;
      if (controlledFrame.current !== null) cancelAnimationFrame(controlledFrame.current);
      controlledFrame.current = null;
      controlledScroll.current = null;
      stopFollowing();
      dialogs.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("wheel", release);
      window.removeEventListener("pointerdown", release);
      window.removeEventListener("keydown", release);
      window.removeEventListener("scroll", onScroll);
    };
  }, [cancel, moveMarker, stopFollowing]);

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!list.current || !acceptsInput(list.current, event) || !NAVIGATION_KEYS.includes(event.key)) return;
    if (!(event.target instanceof Element) || !event.target.closest("[data-date-control]")) return;
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
