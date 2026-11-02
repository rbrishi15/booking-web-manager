"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Money } from "@/components/ui/money";
import { declinedWithdrawalMessage, type PayoutTransport, type SessionPayout, type WithdrawalMethod } from "../payout-transport";

export interface SessionPayoutsProps {
  readonly transport: Pick<PayoutTransport, "loadSessions" | "withdraw">;
  /** The payout destination is a debit card eligible for instant payouts. */
  readonly instantAvailable: boolean;
}

type ListState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly items: readonly SessionPayout[] }
  | { readonly status: "error"; readonly message: string };

type Notice = { readonly sessionId: string; readonly tone: "info" | "error"; readonly text: string };

const singaporeDate = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric",
});

const statusLabels: Readonly<Record<SessionPayout["status"], string>> = {
  AWAITING_PAYOUT: "Ready to withdraw",
  PAYOUT_PENDING: "Withdrawal in progress",
  SETTLED: "Paid out",
};

/**
 * UC1-08: verified sessions the booker can withdraw. The server computes every
 * amount. One idempotency key per session is kept until a definite outcome,
 * so retrying after an unclear failure resumes the same withdrawal.
 */
export function SessionPayouts({ transport, instantAvailable }: SessionPayoutsProps) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const keys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    const result = await transport.loadSessions();
    setList(result.status === "ready" ? { status: "ready", items: result.data } : result);
  }, [transport]);

  useEffect(() => void load(), [load]);

  async function withdraw(sessionId: string, method: WithdrawalMethod) {
    const key = keys.current.get(sessionId) ?? crypto.randomUUID();
    keys.current.set(sessionId, key);
    setBusy(sessionId);
    setNotice(null);
    const result = await transport.withdraw(sessionId, key, method);
    setBusy(null);
    if (result.status === "error") {
      if (!result.retrySameKey) keys.current.delete(sessionId);
      setNotice({ sessionId, tone: "error", text: result.message });
      return;
    }
    keys.current.delete(sessionId);
    const outcome = result.data;
    setNotice({
      sessionId,
      tone: outcome.kind === "DECLINED" ? "error" : "info",
      text:
        outcome.kind === "DECLINED"
          ? declinedWithdrawalMessage(outcome.reason)
          : outcome.kind === "NOTHING_TO_PAY"
            ? "Every share in this session was refunded, so there's nothing to withdraw."
            : outcome.bankPayout === "INSTANT"
              ? "Paid. The money is on its way to your debit card now."
              : outcome.bankPayout === "STANDARD"
                ? "Paid. Stripe sends it to your bank on its standard schedule, usually within a few business days."
                : "Paid. Your session payout is complete.",
    });
    await load();
  }

  return (
    <section aria-labelledby="session-payouts-heading" className="mt-6">
      <h2 id="session-payouts-heading" className="mb-3 text-lg font-semibold">Session payouts</h2>
      {list.status === "loading" && <LoadingSpinner label="Loading your sessions…" />}
      {list.status === "error" && (
        <div className="space-y-3">
          <ErrorMessage>{list.message}</ErrorMessage>
          <Button variant="outline" className="min-h-11" onClick={() => void load()}>Try again</Button>
        </div>
      )}
      {list.status === "ready" && list.items.length === 0 && (
        <EmptyState
          title="Nothing to withdraw yet"
          description="Once you verify attendance for a session you booked, its players' shares can be withdrawn here."
        />
      )}
      {list.status === "ready" && list.items.length > 0 && (
        <ul className="space-y-3">
          {list.items.map((item) => (
            <li key={item.sessionId} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{item.venueName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.sport} · <time dateTime={item.startAt}>{singaporeDate.format(new Date(item.startAt))}</time> · {statusLabels[item.status]}
                  </p>
                </div>
                <Money cents={item.amountCents} className="shrink-0 font-semibold" />
              </div>
              {item.status !== "SETTLED" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button className="min-h-11" disabled={busy !== null} onClick={() => void withdraw(item.sessionId, "STANDARD")}>
                    {busy === item.sessionId ? "Withdrawing…" : item.status === "PAYOUT_PENDING" ? "Finish withdrawal" : "Withdraw"}
                  </Button>
                  {instantAvailable && (
                    <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void withdraw(item.sessionId, "INSTANT")}>
                      Withdraw instantly
                    </Button>
                  )}
                </div>
              )}
              {notice?.sessionId === item.sessionId && (notice.tone === "error"
                ? <ErrorMessage className="mt-3">{notice.text}</ErrorMessage>
                : <InfoNote icon className="mt-3">{notice.text}</InfoNote>)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
