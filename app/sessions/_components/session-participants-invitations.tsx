"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Check, Copy, Link2, UserRound, UserRoundPlus, UsersRound, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { initials } from "@/components/ui/initials";
import type { FindPlayerState } from "@/app/users/find-player-action";
import { userHandleSchema } from "@/app/users/schemas";
import type { LoadSessionInvitation } from "../invitation-transport";
import type { ImportGroup, SendSessionInvitationsResult } from "../session-invitation-contract";
import styles from "./session-participants.module.css";

export type { ImportGroup } from "../session-invitation-contract";

/** Browser-facing boundaries. Production supplies HTTP queries/mutations; Storybook supplies inert fakes. */
export interface SessionInvitationsTransport {
  readonly findPlayer: (previousState: FindPlayerState, formData: FormData) => Promise<FindPlayerState>;
  readonly loadSessionInvitation: LoadSessionInvitation;
  readonly sendDirectSessionInvitations: (sessionId: string, handles: readonly string[]) => Promise<SendSessionInvitationsResult>;
  readonly sendGroupSessionInvitations: (sessionId: string, groupId: string, userIds: readonly string[]) => Promise<SendSessionInvitationsResult>;
}

type CopyState = { readonly message: string; readonly url?: string; readonly clipboard?: "copied" | "manual" };

async function getShareLink(sessionId: string, loadSessionInvitation: LoadSessionInvitation): Promise<CopyState> {
  const result = await loadSessionInvitation(sessionId);
  if (result.status === "error") return { message: result.message };
  const url = new URL(result.invitationPath, window.location.origin).href;
  try {
    await navigator.clipboard.writeText(url);
    return { message: "Invitation link copied. Players can review and confirm their own places.", url, clipboard: "copied" };
  } catch {
    return { message: "Copy the invitation link below and share it with your players.", url, clipboard: "manual" };
  }
}

function Avatar({ name }: { readonly name: string }) {
  return <span className={styles.avatar} aria-hidden="true">{initials(name)}</span>;
}

/** Host sends recipient-specific notifications; the recipient confirms their paid place separately. */
export function SessionInviteDialog({ sessionId, transport, open, onOpenChange, onInvited, onRestoreFocus }: {
  readonly sessionId: string;
  readonly transport: SessionInvitationsTransport;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onInvited: (result: Extract<SendSessionInvitationsResult, { status: "sent" }>) => void;
  readonly onRestoreFocus?: () => void;
}) {
  const inputId = useId();
  const [tab, setTab] = useState<"id" | "link">("id");
  const [handle, setHandle] = useState("");
  const [players, setPlayers] = useState<readonly { handle: string; displayName: string }[]>([]);
  const [finding, setFinding] = useState(false);
  const [sending, setSending] = useState(false);
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<CopyState | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (finding || sending) return;
    if (players.length >= 50) { setMessage("Select up to 50 players at a time."); return; }
    const parsed = userHandleSchema.safeParse(handle);
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "Enter a user ID."); return; }
    if (players.some((player) => player.handle === parsed.data)) { setMessage("This player is already on the list."); return; }
    setFinding(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("handle", parsed.data);
      const outcome = await transport.findPlayer({ status: "idle" }, form);
      if (!mounted.current) return;
      if (outcome.status === "found") {
        if (outcome.player.isSelf) { setMessage("You are already hosting this session."); return; }
        setPlayers((previous) => [...previous, { handle: outcome.player.handle, displayName: outcome.player.displayName }]);
        setHandle("");
      } else if (outcome.status === "not-found") setMessage("No player has this user ID.");
      else if (outcome.status === "error") setMessage(outcome.message);
    } catch {
      if (mounted.current) setMessage("Player lookup is unavailable. Try again.");
    } finally { setFinding(false); }
  }

  async function send() {
    if (sending || finding || players.length === 0) return;
    setSending(true);
    setMessage("");
    try {
      const result = await transport.sendDirectSessionInvitations(sessionId, players.map((player) => player.handle));
      if (result.status === "error") { setMessage(result.message); return; }
      if (mounted.current) { setPlayers([]); onOpenChange(false); }
      onInvited(result);
    } catch {
      setMessage("Could not send invitations. Please try again.");
    } finally { setSending(false); }
  }

  async function copy() {
    if (copying) return;
    setCopying(true);
    setCopied(null);
    try { setCopied(await getShareLink(sessionId, transport.loadSessionInvitation)); }
    catch { setCopied({ message: "Could not load the invitation link. Try again." }); }
    finally { setCopying(false); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={styles.dialog} overlayClassName={styles.invitationOverlay}
      onCloseAutoFocus={(event) => { if (onRestoreFocus) { event.preventDefault(); onRestoreFocus(); } }}>
      <div className={styles.dialogHeader}>
        <span className={styles.dialogIcon} aria-hidden="true"><UserRoundPlus /></span>
        <div>
          <DialogTitle className={styles.dialogTitle}>Invite players</DialogTitle>
          <DialogDescription className={styles.dialogDescription}>Add players to this session.</DialogDescription>
        </div>
      </div>
      <Tabs.Root value={tab} onValueChange={(value) => { setTab(value as "id" | "link"); setCopied(null); setMessage(""); }}>
      <div className={styles.dialogBody}>
        <Tabs.List className={styles.modalTabs} aria-label="Invite method">
          <Tabs.Trigger value="id" disabled={sending || finding} className={styles.modalTab}>By user ID</Tabs.Trigger>
          <Tabs.Trigger value="link" disabled={sending || finding} className={styles.modalTab}>By invite link</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="id">
          <form onSubmit={(event) => void add(event)}>
            <label className={styles.fieldLabel} htmlFor={inputId}>User ID</label>
            <div className={styles.searchRow}>
              <div className={styles.inputWrap}>
                <UserRound size={24} aria-hidden="true" />
                <input id={inputId} value={handle} disabled={finding || sending} onChange={(event) => { setHandle(event.target.value); setMessage(""); }}
                  placeholder="Enter a user ID (e.g. @tian_pok_neoh)" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={33} />
              </div>
              <button type="submit" disabled={finding || sending || players.length >= 50} className={styles.primaryButton}>{finding ? "Finding…" : "Add"}</button>
            </div>
          </form>
          {message && <p className={styles.modalStatus} role="status">{message}</p>}
          <ul className={styles.queue} aria-label="Players selected for invitations">
            {players.map((player) => <li className={styles.queueItem} key={player.handle}>
              <Avatar name={player.displayName} />
              <span>@{player.handle}</span>
              <button type="button" disabled={sending} aria-label={`Remove @${player.handle}`} onClick={() => setPlayers((previous) => previous.filter((item) => item.handle !== player.handle))}><X size={22} /></button>
            </li>)}
          </ul>
        </Tabs.Content>
        <Tabs.Content value="link">
          <label className={styles.fieldLabel} htmlFor={inputId + "-link"}>Session invitation link</label>
          <p className={styles.hint}>Anyone with the link can review the session and choose to join. The session host controls availability.</p>
          <div className={styles.searchRow} style={{ marginTop: 20 }}>
            <div className={styles.inputWrap}><Link2 size={23} aria-hidden="true" /><input id={inputId + "-link"} readOnly value={copied?.url ?? "Generate a secure invitation link"} onFocus={(event) => event.currentTarget.select()} /></div>
            <button type="button" className={styles.primaryButton} onClick={() => void copy()} disabled={copying}><Copy size={18} /> {copying ? "Loading…" : "Copy"}</button>
          </div>
        </Tabs.Content>
      </div>
      {copied && <div role="status" className={styles.modalStatus}>{copied.message}{copied.clipboard === "manual" && copied.url && <input aria-label="Invitation URL to copy" readOnly value={copied.url} onFocus={(event) => event.currentTarget.select()} className={styles.inputWrap} style={{ width: "100%", minHeight: 48, marginTop: 10, padding: 12 }} />}</div>}
      <div className={styles.modalFooter}>
        {tab === "id" && <span className={styles.footerCount}>Invite {players.length} {players.length === 1 ? "player" : "players"}</span>}
        <button type="button" className={styles.secondaryButton} onClick={() => onOpenChange(false)}>Cancel</button>
        <button type="button" className={styles.primaryButton} disabled={copying || sending || finding || (tab === "id" && players.length === 0)}
          onClick={() => tab === "id" ? void send() : void copy()}>{sending ? "Sending…" : copying ? "Loading…" : tab === "id" ? "Invite players" : "Copy invite link"}</button>
      </div>
      </Tabs.Root>
    </DialogContent>
  </Dialog>;
}

/** Bulk invite validates selected membership inside the same database transaction as notifications. */
export function SessionGroupImportDialog({ sessionId, transport, groups, open, onOpenChange, onInvited, onRestoreFocus }: {
  readonly sessionId: string;
  readonly transport: SessionInvitationsTransport;
  readonly groups: readonly ImportGroup[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onInvited: (result: Extract<SendSessionInvitationsResult, { status: "sent" }>) => void;
  readonly onRestoreFocus?: () => void;
}) {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const activeGroup = groups.find((group) => group.groupId === groupId) ?? groups[0];
  const members = activeGroup?.members ?? [];
  const selected = (activeGroup && overrides.get(activeGroup.groupId)) ?? new Set(members.slice(0, 50).map((member) => member.userId));
  const selectedCount = members.filter((member) => selected.has(member.userId)).length;

  function changeSelection(userId: string, enabled: boolean) {
    if (!activeGroup || sending) return;
    const next = new Set(selected);
    if (enabled) next.add(userId); else next.delete(userId);
    if (next.size > 50) { setMessage("Select up to 50 members at a time."); return; }
    setOverrides((previous) => new Map(previous).set(activeGroup.groupId, next));
  }
  async function send() {
    if (sending || !activeGroup || selectedCount === 0) return;
    setSending(true);
    setMessage("");
    try {
      const result = await transport.sendGroupSessionInvitations(
        sessionId, activeGroup.groupId, members.filter((member) => selected.has(member.userId)).map((member) => member.userId),
      );
      if (result.status === "error") { setMessage(result.message); return; }
      if (mounted.current) onOpenChange(false);
      onInvited(result);
    } catch {
      setMessage("Could not send group invitations. Please try again.");
    } finally { setSending(false); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={`${styles.dialog} ${styles.dialogWide}`} overlayClassName={styles.invitationOverlay}
      onCloseAutoFocus={(event) => { if (onRestoreFocus) { event.preventDefault(); onRestoreFocus(); } }}>
      <div className={styles.dialogHeader}>
        <span className={styles.dialogIcon} aria-hidden="true"><UsersRound /></span>
        <div>
          <DialogTitle className={styles.dialogTitle}>Import from group</DialogTitle>
          <DialogDescription className={styles.dialogDescription}>Invite members from one of your groups to this session.</DialogDescription>
        </div>
      </div>
      <div className={styles.groupColumns}>
        <section className={styles.groupColumn} aria-labelledby="import-group-heading">
          <h3 id="import-group-heading" className={styles.groupHeading}>Select group</h3>
          <div className={styles.groupList}>
            {groups.length === 0 ? <p className={styles.hint}>You don’t belong to any active groups yet.</p> : groups.map((group) => {
              const sport = /badminton/i.test(group.name) ? "badminton" : /basketball|hoops/i.test(group.name) ? "basketball" : "tennis";
              return <button type="button" key={group.groupId} disabled={sending} className={styles.groupChoice} aria-pressed={activeGroup?.groupId === group.groupId}
                onClick={() => { setGroupId(group.groupId); setMessage(""); }}>
                <span aria-hidden="true" className={styles.groupThumbnail} data-sport={sport} />
                <span className={styles.groupIdentity}><strong>{group.name}</strong><small>{group.memberCount} members</small></span>
                {activeGroup?.groupId === group.groupId && <Check size={25} aria-hidden="true" />}
              </button>;
            })}
          </div>
        </section>
        <section className={styles.groupColumn} aria-labelledby="import-members-heading">
          <h3 id="import-members-heading" className={`${styles.groupHeading} ${styles.memberHeading}`}>Members to import</h3>
          <p className={styles.memberSubheading}>{activeGroup ? `${selectedCount} members from ${activeGroup.name}` : "Select a group"}</p>
          <ul className={styles.memberList} aria-label="Choose group members">
            {members.length === 0 && <li className={styles.hint}>No other members available.</li>}
            {members.map((member) => <li key={member.userId} className={styles.memberRow}>
              <label>
                <Avatar name={member.displayName} />
                <span>{member.displayName}</span>
                <input className={styles.check} type="checkbox" disabled={sending} checked={selected.has(member.userId)}
                  onChange={(event) => changeSelection(member.userId, event.target.checked)} aria-label={`Select ${member.displayName}`} />
              </label>
            </li>)}
          </ul>
        </section>
      </div>
      {message && <div className={styles.modalStatus} role="alert">{message}</div>}
      <div className={styles.modalFooter}>
        <span className="sr-only">Members receive an invitation and confirm their own booking share.</span>
        <button type="button" className={styles.secondaryButton} onClick={() => onOpenChange(false)}>Cancel</button>
        <button type="button" className={styles.primaryButton} disabled={sending || selectedCount === 0} onClick={() => void send()}>
          {sending ? "Sending…" : `Invite ${selectedCount} ${selectedCount === 1 ? "member" : "members"}`}
        </button>
      </div>
    </DialogContent>
  </Dialog>;
}
