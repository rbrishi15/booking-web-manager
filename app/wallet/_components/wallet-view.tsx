"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Money } from "@/components/ui/money";
import {
  walletTransport,
  type WalletSummary,
  type WalletTransactionKind,
  type WalletTransactionsPage,
  type WalletTransport,
} from "../wallet-transport";

type Load<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "error"; readonly message: string; readonly signIn: boolean };

const kindLabels: Readonly<Record<WalletTransactionKind, string>> = {
  TOP_UP: "Top-up",
  LOCK: "Held for a session",
  RELEASE: "Session share released",
  REFUND: "Refund",
  FORFEIT: "Forfeited share",
  PAYOUT: "Payout",
};

const singaporeDateTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
});

/**
 * UC1-05 wallet overview: available and held balances, money held per session and the
 * transaction history, all read from the wallet API. This page moves no money.
 */
export function WalletView({ transport = walletTransport }: { readonly transport?: WalletTransport }) {
  const [summary, setSummary] = useState<Load<WalletSummary>>({ status: "loading" });
  const [history, setHistory] = useState<Load<WalletTransactionsPage>>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const requested = useRef(0);

  const load = useCallback(async () => {
    const request = ++requested.current;
    setSummary({ status: "loading" });
    setHistory({ status: "loading" });
    setMoreError(null);
    const [summaryResult, historyResult] = await Promise.all([transport.loadSummary(), transport.loadTransactions()]);
    if (request !== requested.current) return;
    setSummary(summaryResult.status === "ready" ? summaryResult : { status: "error", message: summaryResult.message, signIn: summaryResult.code === "UNAUTHENTICATED" });
    setHistory(historyResult.status === "ready" ? historyResult : { status: "error", message: historyResult.message, signIn: historyResult.code === "UNAUTHENTICATED" });
  }, [transport]);

  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (history.status !== "ready" || history.data.nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    const next = await transport.loadTransactions(history.data.nextCursor);
    setLoadingMore(false);
    if (next.status === "error") { setMoreError(next.message); return; }
    setHistory((current) => {
      if (current.status !== "ready") return current;
      // A timestamp cursor can repeat the boundary row; never show a transaction twice.
      const seen = new Set(current.data.items.map((item) => item.transactionId));
      return { status: "ready", data: { items: [...current.data.items, ...next.data.items.filter((item) => !seen.has(item.transactionId))], nextCursor: next.data.nextCursor } };
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6 md:px-8 md:pt-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Wallet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Your balance, money held for sessions you&apos;ve joined, and every movement of funds.</p>
      </header>

      <section aria-labelledby="balance-heading" className="mb-8">
        <h2 id="balance-heading" className="sr-only">Balance</h2>
        {summary.status === "loading" && <LoadingSpinner label="Loading your balance…" />}
        {summary.status === "error" && <LoadError message={summary.message} signIn={summary.signIn} onRetry={load} />}
        {summary.status === "ready" && <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-card p-4 md:p-6">
              <p className="text-sm text-muted-foreground">Available</p>
              <Money cents={summary.data.availableBalanceCents} className="mt-1 block text-3xl font-bold" />
              <p className="mt-2 text-xs text-muted-foreground">You can use this to join sessions.</p>
            </div>
            <div className="rounded-lg border bg-card p-4 md:p-6">
              <p className="text-sm text-muted-foreground">Held for sessions</p>
              <Money cents={summary.data.heldBalanceCents} className="mt-1 block text-3xl font-bold" />
              <p className="mt-2 text-xs text-muted-foreground">Reserved until attendance is verified, then released to the booker.</p>
            </div>
          </div>
          <InfoNote icon className="mt-3">Topping up with PayNow is coming soon.</InfoNote>
        </>}
      </section>

      {summary.status === "ready" && (
        <section aria-labelledby="holds-heading" className="mb-8">
          <h2 id="holds-heading" className="mb-3 text-lg font-semibold">Held for sessions</h2>
          {summary.data.activeHolds.length === 0
            ? <EmptyState title="Nothing held right now" description="When you join a session, its share is held here until attendance is verified." />
            : <ul className="space-y-3">
              {summary.data.activeHolds.map((hold) => (
                <li key={hold.holdId} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4">
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{hold.venueName ?? "Session"}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {hold.sport ?? "Session"}{hold.startAt && <> · <time dateTime={hold.startAt}>{singaporeDateTime.format(new Date(hold.startAt))}</time> SGT</>}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money cents={hold.heldCents} className="font-semibold" />
                    {hold.heldCents !== hold.originalCents && <p className="text-xs text-muted-foreground">of <Money cents={hold.originalCents} /></p>}
                  </div>
                </li>
              ))}
            </ul>}
        </section>
      )}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 text-lg font-semibold">Transactions</h2>
        {history.status === "loading" && <LoadingSpinner label="Loading transactions…" />}
        {history.status === "error" && <LoadError message={history.message} signIn={history.signIn} onRetry={load} />}
        {history.status === "ready" && (history.data.items.length === 0
          ? <EmptyState title="No transactions yet" description="Top-ups, held shares, refunds and payouts will appear here." />
          : <>
            <ul aria-label="Transactions" className="divide-y overflow-hidden rounded-lg border bg-card">
              {history.data.items.map((item) => (
                <li key={item.transactionId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{kindLabels[item.kind]}</p>
                    <p className="text-xs text-muted-foreground"><time dateTime={item.occurredAt}>{singaporeDateTime.format(new Date(item.occurredAt))}</time> SGT</p>
                  </div>
                  <Money cents={item.amountCents} className="shrink-0 font-semibold" />
                </li>
              ))}
            </ul>
            {moreError && <div className="mt-3"><ErrorMessage>{moreError}</ErrorMessage></div>}
            {history.data.nextCursor !== null && (
              <Button variant="outline" className="mt-3 min-h-11" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            )}
          </>)}
      </section>
    </div>
  );
}

function LoadError({ message, signIn, onRetry }: { readonly message: string; readonly signIn: boolean; readonly onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <ErrorMessage>{message}</ErrorMessage>
      {signIn
        ? <Button asChild variant="outline" className="min-h-11"><Link href="/login?next=%2Fwallet">Log in</Link></Button>
        : <Button variant="outline" className="min-h-11" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
