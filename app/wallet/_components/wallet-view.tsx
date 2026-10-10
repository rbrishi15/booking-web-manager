import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Money } from "@/components/ui/money";
import type { WalletSummary, WalletTransactionKind, WalletTransactionsPage } from "../wallet-transport";

/** One part of the wallet screen: still loading, loaded, or failed (optionally because the login expired). */
export type WalletLoadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "error"; readonly message: string; readonly signIn: boolean };

export interface WalletViewProps {
  readonly summary: WalletLoadState<WalletSummary>;
  readonly history: WalletLoadState<WalletTransactionsPage>;
  readonly loadingMore: boolean;
  readonly moreError: string | null;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
}

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
 * transaction history. Display only: WalletController loads the data and handles actions.
 */
export function WalletView({ summary, history, loadingMore, moreError, onRetry, onLoadMore }: WalletViewProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6 md:px-8 md:pt-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Wallet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Your balance, money held for sessions you&apos;ve joined, and every movement of funds.</p>
      </header>

      <section aria-labelledby="balance-heading" className="mb-8">
        <h2 id="balance-heading" className="sr-only">Balance</h2>
        {summary.status === "loading" && <LoadingSpinner label="Loading your balance…" />}
        {summary.status === "error" && <LoadError message={summary.message} signIn={summary.signIn} onRetry={onRetry} />}
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
        {history.status === "error" && <LoadError message={history.message} signIn={history.signIn} onRetry={onRetry} />}
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
              <Button variant="outline" className="mt-3 min-h-11" disabled={loadingMore} onClick={onLoadMore}>
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
