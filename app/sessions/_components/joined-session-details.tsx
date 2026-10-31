"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import Image from "next/image";
import { CalendarDays, ExternalLink, MapPin, UsersRound } from "lucide-react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import type { SessionFeedItem } from "../session-feed-contract";
import { sessionArtwork, sessionCalendarHref, sessionDate, sessionStatus, sessionTime, sessionTitle, sessionVenueLabel } from "./session-display";
import { useSessionsUiStore } from "./sessions-ui-provider";
import type { SessionDetailsPanel } from "./sessions-ui-store";
import { SessionParticipantControls } from "./session-participant-controls";
import styles from "./joined-session-details.module.css";

interface JoinedSessionDetailsProps {
  readonly session: SessionFeedItem;
  readonly userId: string;
  readonly canLeave: boolean;
  readonly onRefresh: () => void;
}

/** Editorial details for players; the feed deliberately exposes counts, not other players' identities. */
export function JoinedSessionDetails({ session, userId, canLeave, onRefresh }: JoinedSessionDetailsProps) {
  const panel = useSessionsUiStore((state) => state.detailPanels[session.sessionId] ?? "details");
  const selectPanel = useSessionsUiStore((state) => state.selectDetailPanel);
  const setPanel = (next: SessionDetailsPanel) => selectPanel(session.sessionId, next);
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const date = sessionDate(session.startAt);
  const venueLabel = sessionVenueLabel(session.venueName);
  const longVenue = venueLabel.length > 26;
  const status = sessionStatus(session);
  const committed = session.participationStatus === "COMMITTED";
  const waitlisted = session.participationStatus === "WAITLISTED";
  const filled = Math.min(session.participantCount, session.capacity);
  const slots = Math.min(session.capacity, 12);
  const filledSegments = Math.round((filled / session.capacity) * slots);
  const otherPlayers = Math.max(0, filled - (committed ? 1 : 0));

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: SessionDetailsPanel = event.key === "Home" ? "details" : event.key === "End" ? "participants" : panel === "details" ? "participants" : "details";
    setPanel(next);
    tabs.current?.querySelector<HTMLButtonElement>('[data-panel="' + next + '"]')?.focus();
  }

  return <div className={styles.layout}>
    <div className={styles.artwork}>
      <Image src={sessionArtwork(session)} alt="" fill sizes="(min-width: 760px) 400px, 100vw" className={styles.photo} />
    </div>
    <div className={styles.content}>
      <div className={styles.scrollArea} data-testid="session-details-scroll">
        <header className={styles.header}>
          <p className={styles.eyebrow}>Session details</p>
          <DialogTitle className={styles.title}>{sessionTitle(session)}</DialogTitle>
          <DialogDescription className="sr-only">Booking at {session.venueName}. {status}.</DialogDescription>
          <span className={styles.status} data-positive={status === "Joined" || status === "Hosting" || undefined}>
            <span aria-hidden="true" className={styles.statusDot} />{status}
          </span>
        </header>

        <section className={styles.schedule} aria-label="Session schedule and location">
          <div className={styles.scheduleCell}>
            <CalendarDays className={styles.scheduleIcon} size={23} strokeWidth={1.4} aria-hidden="true" />
            <div className={styles.scheduleCopy}>
              <h3 className={styles.label}>Date &amp; time</h3>
              <p className={styles.scheduleValue}><time dateTime={session.startAt}>{date.full}</time></p>
              <p className={styles.supporting}>{date.weekday} · {sessionTime(session)} SGT</p>
            </div>
          </div>
          <div className={styles.scheduleCell}>
            <MapPin className={styles.scheduleIcon} size={23} strokeWidth={1.4} aria-hidden="true" />
            <div className={styles.scheduleCopy}>
              <h3 className={styles.label}>Location</h3>
              <p className={styles.scheduleValue} data-long={longVenue || undefined}>
                <a className={styles.venue} href={"https://www.google.com/maps/search/?" + new URLSearchParams({ api: "1", query: session.venueName + ", Singapore" })} target="_blank" rel="noreferrer">
                  <span className={styles.venueText}>{venueLabel}</span>
                  <ExternalLink size={17} strokeWidth={1.5} aria-hidden="true" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </p>
            </div>
          </div>
        </section>

        <div ref={tabs} className={styles.tabs} role="tablist" aria-label="Session information" onKeyDown={handleTabKeyDown}>
          <button type="button" role="tab" data-panel="details" tabIndex={panel === "details" ? 0 : -1} aria-selected={panel === "details"} aria-controls={id + "-panel"} id={id + "-details-tab"} onClick={() => setPanel("details")}>Details</button>
          <button type="button" role="tab" data-panel="participants" tabIndex={panel === "participants" ? 0 : -1} aria-selected={panel === "participants"} aria-controls={id + "-panel"} id={id + "-participants-tab"} onClick={() => setPanel("participants")}>Participants ({session.participantCount})</button>
        </div>

        <div role="tabpanel" tabIndex={0} id={id + "-panel"} aria-labelledby={id + "-" + panel + "-tab"} className={styles.panel}>
          {panel === "details" ? <dl className={styles.metrics}>
            <div className={styles.metric}>
              <dt className={styles.label}>Availability</dt>
              <dd className={styles.metricValue}><span className={styles.number}>{filled} / {session.capacity}</span><span className={styles.unit}>places filled</span></dd>
              <dd className={styles.capacityBar} aria-hidden="true">
                {Array.from({ length: slots }, (_, index) => <span key={index} data-filled={index < filledSegments || undefined} />)}
              </dd>
            </div>
            <div className={styles.metric}>
              <dt className={styles.label}>{waitlisted ? "Waitlist" : "Your place"}</dt>
              <dd className={styles.metricValue}>
                <span className={styles.number}>{waitlisted ? "Waiting" : <Money cents={session.bookingShareCents} />}</span>
              </dd>
              <dd className={styles.unit}>
                {waitlisted ? "No funds held" : committed && session.section === "upcoming" && session.status === "OPEN" ? "Held from your wallet" : "Original booking share"}
              </dd>
            </div>
          </dl> : <div className={styles.roster}>
            {committed && <div className={styles.rosterRow}>
              <span className={styles.avatar} aria-hidden="true">Y</span>
              <div className={styles.rosterCopy}><strong>Your place</strong><span>You</span></div>
              <span className={styles.rosterStatus}>Joined</span>
            </div>}
            {otherPlayers > 0 && <div className={styles.rosterRow}>
              <span className={styles.avatar} aria-hidden="true"><UsersRound size={19} strokeWidth={1.4} /></span>
              <div className={styles.rosterCopy}><strong>Other players</strong><span>{otherPlayers} {otherPlayers === 1 ? "place" : "places"} filled</span></div>
            </div>}
            <p className={styles.rosterNote}>{filled} {filled === 1 ? "player has" : "players have"} a place in this session. Other players’ names are not available in this view.</p>
            {waitlisted && <p className={styles.rosterNote}>You’re on the waitlist. We’ll notify you if a place opens.</p>}
          </div>}
        </div>
      </div>
      <footer className={styles.footer}>
        <SessionParticipantControls userId={userId} session={session} onRefresh={onRefresh} available={canLeave} presentation="footer" />
        <a className={styles.calendarButton} href={sessionCalendarHref(session)} target="_blank" rel="noreferrer">
          View in calendar <ExternalLink size={15} strokeWidth={1.5} aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </footer>
    </div>
  </div>;
}
