"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Money } from "@/components/ui/money";
import { ErrorMessage } from "@/components/ui/error-message";
import { useWithdrawalFlow } from "@/app/commit/use-withdrawal-flow";
import { useLeaveWaitlistFlow } from "@/app/commit/use-leave-waitlist-flow";
import { useReplacementSearch } from "@/app/commit/use-replacement-search";
import { joinedSessionsQueryKey } from "@/app/commit/withdrawal-query-keys";
import { findReplacementCandidate, leaveWaitlist, loadJoinedSessions, previewWithdrawal, withdrawFromSession } from "@/app/commit/withdrawal-transport";
import { WithdrawalDialog } from "@/app/commit/_components/withdrawal-dialog";
import { LeaveWaitlistDialog } from "@/app/commit/_components/leave-waitlist-dialog";
import type { SessionFeedItem } from "../session-feed-contract";
import styles from "./session-details.module.css";

const defaultTransport = { loadJoinedSessions, previewWithdrawal, withdrawFromSession, leaveWaitlist, findReplacementCandidate };

/** Opens the existing refund preview or waitlist confirmation for this specific place. */
export function SessionParticipantControls({ userId, session, onRefresh, available = true, presentation = "default", transport = defaultTransport }: {
  readonly userId: string;
  readonly session: SessionFeedItem;
  readonly onRefresh: () => void;
  readonly available?: boolean;
  readonly presentation?: "default" | "footer";
  readonly transport?: typeof defaultTransport;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sessions = useQuery({ queryKey: joinedSessionsQueryKey(userId), queryFn: transport.loadJoinedSessions, enabled: false, retry: false });
  const withdrawal = useWithdrawalFlow({ userId, sessions: sessions.data, previewWithdrawal: transport.previewWithdrawal, withdraw: transport.withdrawFromSession });
  const inviteSearch = useReplacementSearch({ userId, findCandidate: transport.findReplacementCandidate, onChoose: withdrawal.chooseInvitee });
  const leaving = useLeaveWaitlistFlow({ userId, sessions: sessions.data, leaveWaitlist: async (request) => {
    const result = await transport.leaveWaitlist(request);
    if (result.status === "left") onRefresh();
    return result;
  } });

  async function leave() {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    setError(null);
    try {
      const result = await sessions.refetch();
      if (result.isError) throw result.error;
      const current = result.data?.find((item) => item.sessionId === session.sessionId);
      if (!current) {
        setError("Your place has changed. Refresh your sessions to see the latest status.");
        onRefresh();
      } else if (current.status === "WAITLISTED") leaving.start(current);
      else {
        inviteSearch.reset();
        withdrawal.start(current);
      }
    } catch {
      setError("We couldn’t check your place. Please try again.");
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  const waitlisted = session.participationStatus === "WAITLISTED";
  return <>
    {available && <>
      {presentation === "default" && <div className={styles.row}><div><h3>{waitlisted ? "Your waitlist place" : "Your place"}</h3>
        <p>{waitlisted ? "We’ll notify you when a place opens. Nothing is held yet." : <><Money cents={session.bookingShareCents} /> held from your wallet.</>}</p>
      </div></div>}
      <div className={presentation === "footer" ? styles.dangerCompact : styles.danger}>
        <button ref={trigger} type="button" disabled={checking} onClick={() => void leave()}>{checking ? "Checking your place…" : waitlisted ? "Leave waitlist" : "Leave session"}</button>
        {presentation === "default" && <p>{waitlisted ? "You’ll lose your place in the queue." : "Review your refund before confirming."}</p>}
      </div>
      {error && <div className={styles.feedback}><ErrorMessage>{error}</ErrorMessage></div>}
    </>}
    <WithdrawalDialog state={withdrawal.state} inviteSearch={inviteSearch.state} onSearchInvitee={inviteSearch.search} onChooseMode={withdrawal.chooseMode}
      onConfirm={withdrawal.confirm} onRetryPreview={withdrawal.retryPreview} onClose={() => {
        const succeeded = withdrawal.state.step === "withdrawn";
        withdrawal.close();
        if (succeeded) onRefresh();
      }} onRestoreFocus={() => trigger.current?.focus()} />
    <LeaveWaitlistDialog state={leaving.state} onConfirm={leaving.confirm} onClose={leaving.close} onRestoreFocus={() => trigger.current?.focus()} />
  </>;
}
