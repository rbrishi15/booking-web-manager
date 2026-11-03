"use client";

import { ArrowUpRight, ChevronRight, CircleArrowUp, CircleDot, CirclePlus, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { WalletSummary, WalletTransactionsPage } from "../wallet-transport";
import { WalletTransactions } from "./wallet-transactions";
import { singaporeDateTime, walletHoldHref } from "./wallet-activity";
import { useWalletHoldsTable } from "./wallet-holds-table";
import { WalletMoney } from "./wallet-money";
import styles from "./wallet-view.module.css";

/** Each resource loads independently; an expired login replaces its stale data. */
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
  /** Two-stage PayNow modal; absence shows the coming-soon notice. */
  readonly topUp?: React.ReactNode;
}

/** UC1-05 presentation and local filters. Data fetching and payment state stay with their owners. */
export function WalletView({ summary, history, loadingMore, moreError, onRetry, onLoadMore, topUp }: WalletViewProps) {
  const [topUpOpen, setTopUpOpen] = useState(false);
  const holdsTable = useWalletHoldsTable(summary.status === "ready" ? summary.data.activeHolds : undefined);
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1 className={styles.breadcrumb}>Wallet <span aria-hidden="true">/</span></h1>
      </header>
      <div className={styles.overview}>
      <section aria-labelledby="balance-heading" className={styles.balanceSection}>
        <h2 id="balance-heading" className="sr-only">Balance</h2>
        {summary.status === "loading" && <div className={styles.loadingCard}><LoadingSpinner label="Loading your balance…" /></div>}
        {summary.status === "error" && <div className={styles.statePanel}><LoadError message={summary.message} signIn={summary.signIn} onRetry={onRetry} /></div>}
        {summary.status === "ready" && <>
          <div className={styles.balanceCard}>
            <BalanceArtwork />
            <div className={styles.balanceMain}>
              <p className={styles.eyebrow}>Available balance</p>
              <WalletMoney cents={summary.data.availableBalanceCents} className={styles.balanceAmount} />
              <p className={styles.balanceHint}>Available for new bookings</p>
            </div>
            <dl className={styles.balanceStats}>
              <div>
                <dt>Held</dt>
                <dd><WalletMoney cents={summary.data.heldBalanceCents} /></dd>
              </div>
              <div>
                <dt title="Withdrawals being processed">Pending<span className="sr-only"> withdrawals</span></dt>
                <dd>{summary.data.pendingPayoutCents === undefined
                  ? <span aria-label="Pending withdrawals unavailable">—</span>
                  : <WalletMoney cents={summary.data.pendingPayoutCents} />}</dd>
              </div>
            </dl>
            <div className={styles.balanceActions}>
              <Button className={styles.addFunds} aria-haspopup="dialog" onClick={() => setTopUpOpen(true)}>
                <CirclePlus className={styles.mobileInline} aria-hidden="true" /><Plus className={styles.desktopInline} aria-hidden="true" />Add funds
              </Button>
              <Button asChild variant="outline" className={styles.payoutAction}>
                <Link href="/payouts"><CircleArrowUp className={`${styles.mobileInline} ${styles.withdrawIcon}`} aria-hidden="true" /><ArrowUpRight className={styles.desktopInline} aria-hidden="true" /><span className={styles.mobileInline}>Withdraw</span><span className={styles.desktopInline}>Payouts</span></Link>
              </Button>
            </div>
          </div>
          <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
            <DialogContent className="max-h-[calc(100dvh-1.25rem)] w-[calc(100vw-1.25rem)] max-w-[445px] min-w-0 gap-0 overflow-x-hidden overflow-y-auto rounded-[9px] border border-[#dfe4dd] bg-[#f7f9f7] p-0 text-[#181b19] shadow-2xl dark:border-[#303d49] dark:bg-[#101720] dark:text-[#f5f7f4] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)]" overlayClassName="bg-black/75 backdrop-blur-[3px]">
              <DialogTitle className="sr-only">Add funds to your wallet</DialogTitle>
              <DialogDescription className="sr-only">Choose an amount, simulate a test-mode PayNow scan or use the QR code, and view Stripe-confirmed payment details.</DialogDescription>
              {topUp ?? <div className="px-8 py-12"><InfoNote icon>Topping up with PayNow is coming soon.</InfoNote></div>}
            </DialogContent>
          </Dialog>
        </>}
      </section>
        {summary.status === "ready" && <Holds summary={summary.data} />}
      </div>
        <WalletTransactions history={history} loadingMore={loadingMore} moreError={moreError} onLoadMore={onLoadMore}
          holdsControls={holdsTable.controls}
          holds={summary.status === "ready" ? holdsTable.content
            : summary.status === "loading" ? <LoadingSpinner label="Loading active holds…" />
            : <LoadError message={summary.message} signIn={summary.signIn} onRetry={onRetry} />}
          error={history.status === "error" ? <LoadError message={history.message} signIn={history.signIn} onRetry={onRetry} /> : undefined} />
    </div>
  );
}

function Holds({ summary }: { readonly summary: WalletSummary }) {
  return (
    <section aria-label="Held for sessions" className={styles.holds}>
      <div className={styles.holdsHeader}>
        <div>
          <h2><span className={styles.mobileInline}>Funds in use</span><span className={styles.desktopInline}>Funds on hold</span><span className={styles.holdCount}>{summary.activeHolds.length}</span></h2>
          <p className={styles.holdsDescription}>Reserved for upcoming sessions</p>
        </div>
        <WalletMoney cents={summary.heldBalanceCents} className={styles.holdsTotal} />
      </div>
      {summary.activeHolds.length === 0
        ? <EmptyState title="Nothing held right now" description="When you join a session, its share is held here until attendance is verified." />
        : <ul className={styles.holdList}>
          {summary.activeHolds.map((hold) => (
            <li key={hold.holdId}>
              <Link href={walletHoldHref(hold)} className={styles.holdLink}>
                <span className={styles.holdIcon} aria-hidden="true">{hold.sport === "Badminton" ? <Shuttlecock /> : <CircleDot size={22} strokeWidth={1.2} />}</span>
                <span className={styles.holdPhoto} data-surface={hold.sport === "Tennis" ? "clay" : "grass"} aria-hidden="true">
                  <Image src={hold.sport === "Tennis" ? "/images/sports/tennis.jpg" : "/images/landing-court.webp"} fill sizes="64px" alt="" />
                </span>
                <div className={styles.holdDetails}>
                  <p className={styles.holdName}><span className={styles.mobileInline}>{hold.sport && `${hold.sport} · `}</span>{hold.venueName ?? "Session"}</p>
                  {hold.startAt && <p className={styles.holdDate}><time dateTime={hold.startAt}><span className={styles.desktopInline}>{singaporeDateTime.format(new Date(hold.startAt))}</span><span className={styles.mobileInline}>{mobileHoldDate(hold.startAt)}</span></time></p>}
                </div>
                <div className={styles.holdAmount}>
                  <WalletMoney cents={hold.heldCents} />
                  <p className={hold.heldCents === hold.originalCents ? styles.heldCaption : undefined}>{hold.heldCents !== hold.originalCents ? <>of <WalletMoney cents={hold.originalCents} /></> : "held"}</p>
                </div>
                <ChevronRight className={styles.holdChevron} size={16} strokeWidth={1.5} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>}
    </section>
  );
}

function mobileHoldDate(timestamp: string) {
  const date = new Date(timestamp);
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" });
  const tomorrow = new Date(Date.now() + 86_400_000);
  const day = dayFormat.format(date) === dayFormat.format(new Date()) ? "Today"
    : dayFormat.format(date) === dayFormat.format(tomorrow) ? "Tomorrow"
    : new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short" }).format(date);
  const time = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit", hour12: true }).format(date).toUpperCase();
  return `${day} · ${time}`;
}

function Shuttlecock() {
  return <svg width="22" height="24" viewBox="0 0 24 26" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7.2 19.2 4.6 3.1M8.5 17.4l4.7 3.3M7 19.4c-3.7.9-3.5 4.2-1.1 4.6 1.5.3 3.3-1 4.5-2.5L7 19.4Z" />
    <path d="M8 18 9.2 4.9c.3-1.9 2.6-1.6 2.7.1l.4 9.3M10 19l6-14c.7-1.6 2.9-.6 2.2 1.1l-4.6 11.6M12 21l9.3-8.2c1.3-1.4-.4-3-1.7-1.8L10 19" />
  </svg>;
}

/** Layered translucent ribbons match the desktop artwork; mobile has a static dark surface. */
function BalanceArtwork() {
  const grainId = useId();
  return <div className={styles.cardArtwork} aria-hidden="true">
    <svg className={styles.cardWaves} viewBox="0 0 700 285" preserveAspectRatio="none">
      <defs>
        <filter id={grainId}><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="3" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
      </defs>
      <g className={styles.waveBack}>
        <path d="M280 285C366 215 373 189 454 191C584 198 538 21 700 5V285Z" fill="#a1a798" fillOpacity=".15" />
        <path d="M348 285C409 220 439 219 465 157C518 26 574 137 700 126V285Z" fill="#9ba291" fillOpacity=".15" />
        <path d="M416 285C515 224 527 159 573 107C617 58 653 61 700 59V285Z" fill="#929a87" fillOpacity=".16" />
      </g>
      <g className={styles.waveFront}>
        <path d="M385 285C478 231 484 200 535 195C609 189 599 124 700 126V285Z" fill="#8c9582" fillOpacity=".18" />
        <path d="M468 285C523 237 562 217 592 190C630 157 654 151 700 163V285Z" fill="#818c76" fillOpacity=".20" />
        <path d="M512 285C557 248 596 232 631 220C666 208 681 219 700 215V285Z" fill="#77836c" fillOpacity=".13" />
        <path d="M470 285C513 239 538 218 592 190C632 170 661 155 700 161M547 285C581 257 608 237 644 225C663 218 683 216 700 219" stroke="#fff" strokeOpacity=".36" strokeWidth="1" fill="none" />
      </g>
      <rect width="700" height="285" filter={`url(#${grainId})`} opacity=".035" />
    </svg>
  </div>;
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
