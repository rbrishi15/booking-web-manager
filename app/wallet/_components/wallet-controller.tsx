"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { walletTransport, type WalletLoad, type WalletSummary, type WalletTransactionsPage, type WalletTransport } from "../wallet-transport";
import { WalletView, type WalletLoadState } from "./wallet-view";

function toState<T>(result: WalletLoad<T>): WalletLoadState<T> {
  return result.status === "ready" ? result : { status: "error", message: result.message, signIn: result.code === "UNAUTHENTICATED" };
}

/**
 * Loads the wallet through the wallet API and drives WalletView. Each load gets a
 * generation number: a Load more that finishes after a Retry belongs to the old list,
 * so its page is discarded instead of being appended to the new one.
 */
export function WalletController({ transport = walletTransport }: { readonly transport?: WalletTransport }) {
  const [summary, setSummary] = useState<WalletLoadState<WalletSummary>>({ status: "loading" });
  const [history, setHistory] = useState<WalletLoadState<WalletTransactionsPage>>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setSummary({ status: "loading" });
    setHistory({ status: "loading" });
    setLoadingMore(false);
    setMoreError(null);
    const [summaryResult, historyResult] = await Promise.all([transport.loadSummary(), transport.loadTransactions()]);
    if (current !== generation.current) return;
    setSummary(toState(summaryResult));
    setHistory(toState(historyResult));
  }, [transport]);

  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (history.status !== "ready" || history.data.nextCursor === null || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    const next = await transport.loadTransactions(history.data.nextCursor);
    if (current !== generation.current) return;
    setLoadingMore(false);
    if (next.status === "error") {
      // An expired login needs the same Log in action as the first load, not just a message.
      if (next.code === "UNAUTHENTICATED") setHistory({ status: "error", message: next.message, signIn: true });
      else setMoreError(next.message);
      return;
    }
    setHistory((previous) => {
      if (previous.status !== "ready") return previous;
      // A timestamp cursor can repeat the boundary row; never show a transaction twice.
      const seen = new Set(previous.data.items.map((item) => item.transactionId));
      return { status: "ready", data: { items: [...previous.data.items, ...next.data.items.filter((item) => !seen.has(item.transactionId))], nextCursor: next.data.nextCursor } };
    });
  }

  return <WalletView summary={summary} history={history} loadingMore={loadingMore} moreError={moreError}
    onRetry={() => void load()} onLoadMore={() => void loadMore()} />;
}
