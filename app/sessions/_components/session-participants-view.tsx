"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, ExternalLink, MapPin, MoreHorizontal, Pencil, UsersRound, UserRoundPlus } from "lucide-react";
import * as Tabs from "@radix-ui/react-tabs";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Money } from "@/components/ui/money";
import { initials } from "@/components/ui/initials";
import { AttendanceVerificationForm } from "@/app/commit/_components/attendance-verification-form";
import type { SessionParticipantsOutcome } from "../removal-actions";
import type { SessionInviteDisplay, SendSessionInvitationsResult } from "../session-invitation-contract";
import { sessionTitle, sessionVenueLabel, sessionTime } from "./session-display";
import { ParticipantRemovalDialog, type ParticipantRemovalTransport, type RemovalResult, type RemovalTarget } from "./participant-removal-dialog";
import { SessionGroupImportDialog, SessionInviteDialog, type ImportGroup, type SessionInvitationsTransport } from "./session-participants-invitations";
import styles from "./session-participants.module.css";

export interface SessionParticipantsViewProps {
  readonly sessionId: string;
  readonly outcome: SessionParticipantsOutcome;
  readonly groups: readonly ImportGroup[];
  readonly invitations: readonly SessionInviteDisplay[];
  readonly invitationTransport: SessionInvitationsTransport;
  readonly invitationError?: string;
  readonly invitationsLoading?: boolean;
  readonly refreshing: boolean;
  readonly removal: ParticipantRemovalTransport;
  readonly onRefresh: () => void;
}

type RosterTab = "participants" | "waitlist" | "withdrawn" | "invitations";
type RosterPlayer = {
  readonly participationId: string;
  readonly displayName: string;
  readonly status: string;
  readonly attendance?: "UNVERIFIED" | "ATTENDED" | "ABSENT";
  readonly isBooker?: boolean;
  readonly canRemove?: boolean;
};

const date = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric" });
const weekday = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", weekday: "short" });

const captions: Record<RosterTab, string> = {
  participants: "No players have joined this session yet.",
  waitlist: "There is nobody on the waitlist.",
  withdrawn: "No players have withdrawn or been removed.",
  invitations: "You haven’t invited any players yet.",
};

function PlayerAvatar({ name }: { readonly name: string }) {
  return <span className={styles.avatar} aria-hidden="true">{initials(name)}</span>;
}

/** Editorial host roster, with the original transaction-safe refund removal and attendance workflows intact. */
export function SessionParticipantsView({ sessionId, outcome, groups, invitations, invitationTransport, invitationError, invitationsLoading = false, refreshing, removal, onRefresh }: SessionParticipantsViewProps) {
  const [selected, setSelected] = useState<RemovalTarget | null>(null);
  const [removed, setRemoved] = useState<ReadonlyMap<string, RemovalResult>>(new Map());
  const [success, setSuccess] = useState<{ result: RemovalResult; displayName: string } | null>(null);
  const [recoveryLocked, setRecoveryLocked] = useState(true);
  const [started, setStarted] = useState(false);
  const [tab, setTab] = useState<RosterTab>("participants");
  const [visibleCount, setVisibleCount] = useState(2);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const invitationTrigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const session = outcome.status === "ready" ? outcome.session : null;
  const startAt = session?.startAt;

  useEffect(() => {
    if (!startAt) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const remaining = new Date(startAt).getTime() - Date.now();
      setStarted(remaining <= 0);
      if (remaining > 0) timer = setTimeout(update, Math.min(remaining, 2_147_483_647));
    };
    update();
    return () => clearTimeout(timer);
  }, [startAt]);

  function handleInvited(result: Extract<SendSessionInvitationsResult, { status: "sent" }>) {
    const sent = `${result.invited} new ${result.invited === 1 ? "invitation" : "invitations"} sent.`;
    const existing = result.alreadyInvited ? ` ${result.alreadyInvited} already invited.` : "";
    const joined = result.alreadyParticipating ? ` ${result.alreadyParticipating} already participating.` : "";
    setInviteNotice(`${sent}${existing}${joined}`);
    onRefresh();
  }

  function restoreFocus() {
    if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus();
    else heading.current?.focus();
  }

  function restoreInvitationFocus() {
    if (invitationTrigger.current?.isConnected && !invitationTrigger.current.disabled) invitationTrigger.current.focus();
    else heading.current?.focus();
  }

  const regularPlayers: RosterPlayer[] = session ? session.participants.map((participant) => ({
    participationId: participant.participationId,
    displayName: participant.displayName,
    status: removed.has(participant.participationId) ? "REMOVED" : participant.status,
    attendance: participant.attendance,
    canRemove: participant.canRemove,
    isBooker: session.booker.participationId === participant.participationId,
  })) : [];

  const booker: RosterPlayer | null = session ? regularPlayers.find((player) => player.isBooker) ?? {
    participationId: "booker",
    displayName: session.booker.displayName,
    status: "COMMITTED",
    isBooker: true,
  } : null;
  const allPlayers = booker ? [booker, ...regularPlayers.filter((player) => !player.isBooker)] : regularPlayers;
  const committed = allPlayers.filter((player) => player.status === "COMMITTED");
  const waitlisted = allPlayers.filter((player) => player.status === "WAITLISTED");
  const withdrawn = allPlayers.filter((player) => player.status !== "COMMITTED" && player.status !== "WAITLISTED");
  const capacity = session?.totalSlots ?? 0;
  const invited: RosterPlayer[] = invitations.map((invite) => ({ participationId: invite.inviteeId, displayName: invite.displayName, status: invite.status }));
  const activeList = tab === "participants" ? committed : tab === "waitlist" ? waitlisted : tab === "withdrawn" ? withdrawn : invited;
  const displayed = activeList.slice(0, visibleCount);
  const canInvite = session?.status === "OPEN" && !started;
  const venue = session ? sessionVenueLabel(session.venueName) : "";
  const mapHref = session ? `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: `${session.venueName}, Singapore` })}` : "";

  return <div className={styles.page}>
    <div className={styles.topbar}>
      <Link className={styles.back} href="/sessions"><ArrowLeft size={20} aria-hidden="true" /> My sessions</Link>
      <div className={styles.topActions}>
        <button type="button" disabled title="Editing sessions is not yet supported" className={styles.outlineAction} aria-label="Edit session (unavailable)"><Pencil size={19} aria-hidden="true" /> Edit session</button>
        <Link className={styles.moreButton} href="/sessions" aria-label="Return to session management"><MoreHorizontal size={25} aria-hidden="true" /></Link>
      </div>
    </div>

    <header className={styles.heroHeader}>
      <p className={styles.eyebrow}>Session details</p>
      <div className={styles.titleRow}>
        <h1 ref={heading} tabIndex={-1} className={styles.title}>{session ? sessionTitle(session) : "Manage participants"}</h1>
        {session && <span className={`${styles.openBadge} ${session.status === "OPEN" ? "" : styles.closedBadge}`}>
          {session.status.charAt(0) + session.status.slice(1).toLowerCase()}
        </span>}
      </div>
    </header>

    <ParticipantRemovalDialog sessionId={sessionId} selected={selected} transport={removal}
      onClose={() => setSelected(null)} onRestoreFocus={restoreFocus}
      onRemoved={(result, displayName) => {
        setRemoved((previous) => new Map(previous).set(result.participationId, result));
        setSuccess({ result, displayName });
      }}
      onRefresh={onRefresh} onRecoveryChange={setRecoveryLocked} />

    {inviteNotice && <p role="status" className={styles.feedback}>{inviteNotice}</p>}
    {success && <p role="status" className={styles.feedback}>
      {success.displayName} removed. <Money cents={success.result.refundCents} /> refunded to their in-app wallet.
    </p>}

    {outcome.status === "error" ? <div className={styles.feedback}>
      <ErrorMessage>{outcome.message}</ErrorMessage>
      <Button className="mt-3" variant="outline" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Loading…" : "Retry"}</Button>
    </div> : session && <>
      <section aria-label="Session details" className={styles.summaryCard}>
        <div className={styles.summaryItem}>
          <CalendarDays className={styles.summaryIcon} aria-hidden="true" />
          <div>
            <time dateTime={session.startAt} className={styles.summaryValue}>{date.format(new Date(session.startAt))}</time>
            <p className={styles.summaryDescription}>{weekday.format(new Date(session.startAt))} · {sessionTime(session).replace(/\bAM\b/g, "am").replace(/\bPM\b/g, "pm")} SGT</p>
          </div>
        </div>
        <div className={styles.summaryItem}>
          <MapPin className={styles.summaryIcon} aria-hidden="true" />
          <div>
            <a className={`${styles.summaryValue} ${styles.venueValue} ${styles.venueLink}`} href={mapHref} target="_blank" rel="noreferrer">
              <span>{venue}</span> <ExternalLink size={19} aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </div>
        <div className={styles.summaryItem}>
          <UsersRound className={styles.summaryIcon} aria-hidden="true" />
          <div style={{ width: "100%" }}>
            <p className={styles.summaryValue}>{committed.length} / {capacity} players</p>
            <div className={styles.progress} role="progressbar" aria-label="Session occupancy" aria-valuenow={committed.length} aria-valuemin={0} aria-valuemax={Math.max(capacity, 1)}>
              <span style={{ width: `${capacity > 0 ? Math.min(100, 100 * committed.length / capacity) : 0}%` }} />
            </div>
          </div>
        </div>
      </section>

      <Tabs.Root asChild value={tab} onValueChange={(value) => { setTab(value as RosterTab); setVisibleCount(2); setMenuId(null); }}>
      <section aria-label="Manage players">
        {invitationsLoading && <p role="status" className={styles.feedback}>Loading invitations and groups…</p>}
        {invitationError && <div role="alert" className={styles.feedback}>
          <p>{invitationError}</p>
          <Button variant="outline" className="mt-3" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Loading…" : "Retry invitations"}</Button>
        </div>}
        <div className={styles.actionsBar}>
          <Tabs.List aria-label="Participant status" className={styles.tabs}>
            {([
              ["participants", "Participants", committed.length],
              ["waitlist", "Waitlist", waitlisted.length],
              ["withdrawn", "Withdrawn", withdrawn.length],
              ["invitations", "Invitations", invitationError || invitationsLoading ? "—" : invitations.length],
            ] as const).map(([value, label, count]) => <Tabs.Trigger key={value} value={value} className={styles.tab}>
              {label} ({count})
            </Tabs.Trigger>)}
          </Tabs.List>
          <div className={styles.rosterActions}>
            <button type="button" disabled={!canInvite || Boolean(invitationError) || invitationsLoading} className={styles.importButton} onClick={(event) => { invitationTrigger.current = event.currentTarget; setShowGroups(true); }}>
              <UsersRound size={22} aria-hidden="true" /> Import from group
            </button>
            <span className={styles.actionDivider} aria-hidden="true" />
            <button type="button" disabled={!canInvite} className={styles.inviteButton} onClick={(event) => { invitationTrigger.current = event.currentTarget; setShowInvite(true); }}>
              <UserRoundPlus size={22} aria-hidden="true" /> Invite player
            </button>
          </div>
        </div>

        <Tabs.Content value={tab}>
          {displayed.length === 0 ? <p className={styles.emptyState}>{tab === "invitations" && invitationError ? "Invitation history is temporarily unavailable." : captions[tab]}</p> :
            <ul className={styles.list} aria-label={tab === "participants" ? "Participants" : tab === "waitlist" ? "Waitlist" : tab === "invitations" ? "Invitations" : "Withdrawn players"}>
              {displayed.map((player) => {
                const canRemove = !player.isBooker && player.canRemove && player.status === "COMMITTED" && canInvite;
                const label = player.status === "COMMITTED" ? "Booked" : player.status === "WAITLISTED" ? "Waiting" : player.status === "REMOVED" ? "Removed" : player.status === "WITHDRAWN" ? "Withdrawn" : player.status === "CANCELLED" ? "Cancelled" : player.status === "LEFT_WAITLIST" ? "Left waitlist" : player.status === "PENDING" ? "Invited" : player.status === "ACCEPTED" ? "Accepted" : player.status === "DECLINED" ? "Declined" : "Left";
                return <li className={styles.playerRow} key={player.participationId}>
                  <div className={styles.playerInfo}>
                    <PlayerAvatar name={player.displayName} />
                    <div>
                      <p className={styles.name}>{player.displayName}</p>
                      {player.isBooker && <span className={styles.caption}>Booker · You</span>}
                      {player.attendance && player.attendance !== "UNVERIFIED" && <span className={styles.caption}>{player.attendance === "ATTENDED" ? "Attended" : "Absent"}</span>}
                    </div>
                  </div>
                  <span className={styles.statusBadge}>{label}</span>
                  <div className={styles.rowMenu}>
                    {player.isBooker && <span className={styles.dots} aria-hidden="true"><MoreHorizontal size={24} /></span>}
                    {canRemove && <>
                      <button type="button" className={styles.dots} disabled={refreshing || recoveryLocked} aria-label={`Manage ${player.displayName}`} aria-expanded={menuId === player.participationId}
                        onClick={() => setMenuId((previous) => previous === player.participationId ? null : player.participationId)}>
                        <MoreHorizontal size={24} aria-hidden="true" />
                      </button>
                      {menuId === player.participationId && <div className={styles.menu}>
                        <button type="button" onClick={(event) => { trigger.current = event.currentTarget.parentElement?.previousElementSibling as HTMLButtonElement | null; setSelected(player); setMenuId(null); }}>Remove participant</button>
                      </div>}
                    </>}
                  </div>
                </li>;
              })}
            </ul>}
          {activeList.length > visibleCount && <button type="button" className={styles.loadMore} onClick={() => setVisibleCount((previous) => previous + 10)}>
            Show more {tab === "participants" ? "participants" : "players"} ({activeList.length - visibleCount} remaining)
          </button>}
        </Tabs.Content>
        {tab === "waitlist" && waitlisted.length > 0 && <p className={styles.hint}>Waitlist order is preserved. Removing someone does not automatically promote a waitlisted player.</p>}
        {!canInvite && <p className={styles.hint}>Invitations and removals are available only before an open session starts.</p>}
      </section>
      </Tabs.Root>

      {session.canVerifyAttendance && <div className={styles.attendance}>
        <AttendanceVerificationForm sessionId={session.sessionId} onSaved={onRefresh}
          players={session.participants.filter((player) => player.status === "COMMITTED" && player.attendance === "UNVERIFIED")} />
      </div>}
      {showGroups && <SessionGroupImportDialog sessionId={sessionId} transport={invitationTransport} groups={groups} open onOpenChange={setShowGroups} onInvited={handleInvited} onRestoreFocus={restoreInvitationFocus} />}
      {showInvite && <SessionInviteDialog sessionId={sessionId} transport={invitationTransport} open onOpenChange={setShowInvite} onInvited={handleInvited} onRestoreFocus={restoreInvitationFocus} />}
    </>}
  </div>;
}
