export interface DiscoveryPolling {
  /** Called when the router transition settles, including failed reads. */
  complete(): void;
  stop(): void;
}

/** Schedules refreshes without overlapping requests or retaining a departed page. */
export function startDiscoveryPolling(options: {
  readonly refresh: () => void;
  readonly canRefresh: () => boolean;
  readonly document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  readonly window: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly online: () => boolean;
}): DiscoveryPolling {
  let inFlight = false;
  let stopped = false;
  function refresh() {
    if (stopped || inFlight || options.document.visibilityState !== "visible" || !options.online() || !options.canRefresh()) return;
    inFlight = true;
    options.refresh();
  }
  const timer = setInterval(refresh, 1_000);
  options.document.addEventListener("visibilitychange", refresh);
  options.window.addEventListener("online", refresh);
  return {
    complete() { inFlight = false; },
    stop() {
      stopped = true;
      clearInterval(timer);
      options.document.removeEventListener("visibilitychange", refresh);
      options.window.removeEventListener("online", refresh);
    },
  };
}
