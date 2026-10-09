export type WalletIdentityReader = () => Promise<string | null>;

/** Cookie changes made in another tab need no browser auth event to be observed. */
export function observeWalletIdentity(
  read: WalletIdentityReader,
  onIdentity: (userId: string | null) => void,
  onError: () => void,
) {
  let disposed = false;
  let revision = 0;
  const recheck = () => {
    const current = ++revision;
    void read().then((userId) => {
      if (!disposed && current === revision) onIdentity(userId);
    }, () => {
      if (!disposed && current === revision) onError();
    });
  };
  const visibleCheck = () => {
    if (document.visibilityState === "visible") recheck();
  };
  window.addEventListener("focus", visibleCheck);
  document.addEventListener("visibilitychange", visibleCheck);
  // Bound detection latency for a wallet tab left open and visible.
  const timer = window.setInterval(visibleCheck, 15_000);
  recheck();
  return {
    recheck,
    dispose: () => {
      disposed = true;
      ++revision;
      window.removeEventListener("focus", visibleCheck);
      document.removeEventListener("visibilitychange", visibleCheck);
      window.clearInterval(timer);
    },
  };
}
