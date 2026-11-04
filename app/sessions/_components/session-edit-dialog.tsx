"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LockKeyhole, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { decimalCents, parseSgdCents, singaporeTimestamp } from "../create/model";
import type { SessionEditRequest, SessionEditingDetails } from "../editing-contract";
import { sessionEditingTransport, SessionEditingError, type SessionEditingTransport } from "../editing-transport";
import styles from "./session-edit-dialog.module.css";

function singaporeInput(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
}

export function SessionEditDialog({ sessionId, transport = sessionEditingTransport, onClose, onSaved }: {
  readonly sessionId: string;
  readonly transport?: SessionEditingTransport;
  readonly onClose: () => void;
  readonly onSaved: (details: SessionEditingDetails) => void;
}) {
  const [details, setDetails] = useState<SessionEditingDetails | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const initialFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailure(null);
    void transport.load(sessionId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setDetails(result);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setFailure(error instanceof SessionEditingError ? error.message : "We couldn't load this session. Please try again.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionId, transport, generation]);

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className={styles.dialog}
      onOpenAutoFocus={() => { initialFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={(event) => { if (initialFocus.current?.isConnected) { event.preventDefault(); initialFocus.current.focus(); } }}>
      <header className={styles.header}>
        <span className={styles.icon} aria-hidden="true"><Pencil size={23} /></span>
        <div><p className={styles.eyebrow}>Session settings</p><DialogTitle className={styles.title}>Edit session</DialogTitle>
          <DialogDescription className={styles.description}>Update the details for your next game.</DialogDescription></div>
      </header>
      {loading ? <div role="status" className={styles.loading}>Loading session details…</div>
        : failure ? <div className={styles.loading}><p role="alert">{failure}</p>
          <Button variant="outline" onClick={() => setGeneration((value) => value + 1)}>Retry</Button></div>
        : details && <SessionEditForm key={`${details.version}:${generation}`} details={details} transport={transport}
          onClose={onClose} onSaved={onSaved} onSaving={setSaving} onReload={() => setGeneration((value) => value + 1)} />}
    </DialogContent>
  </Dialog>;
}

function SessionEditForm({ details, transport, onClose, onSaved, onSaving, onReload }: {
  readonly details: SessionEditingDetails;
  readonly transport: SessionEditingTransport;
  readonly onClose: () => void;
  readonly onSaved: (details: SessionEditingDetails) => void;
  readonly onSaving: (saving: boolean) => void;
  readonly onReload: () => void;
}) {
  const prefix = useId();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reload: boolean } | null>(null);
  const [capacity, setCapacity] = useState(details.totalSlots);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = details.bookingLocked || !details.canEdit;
  const full = capacity <= details.minimumSlots;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !details.canEdit) return;
    const values = new FormData(event.currentTarget);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    let booking = details.booking;
    if (!locked) {
      const startValue = text("startAt"); const endValue = text("endAt");
      const startAt = startValue === singaporeInput(booking.startAt) ? booking.startAt : singaporeTimestamp(startValue.slice(0, 10), startValue.slice(11));
      const endAt = endValue === singaporeInput(booking.endAt) ? booking.endAt : singaporeTimestamp(endValue.slice(0, 10), endValue.slice(11));
      const totalCostCents = parseSgdCents(text("cost")); const pricePerSlotCents = parseSgdCents(text("price"));
      if (!startAt || !endAt || new Date(endAt) <= new Date(startAt)) { setFailure({ message: "Choose an end time after the start time.", reload: false }); return; }
      if (!totalCostCents || !pricePerSlotCents) { setFailure({ message: "Enter positive SGD amounts with up to two decimal places.", reload: false }); return; }
      booking = { venueName: text("venueName"), region: text("region"), sport: text("sport"), startAt, endAt, totalCostCents, pricePerSlotCents };
    }
    const input: SessionEditRequest = { version: details.version, booking, totalSlots: Number(text("totalSlots")),
      visibility: full ? details.visibility : text("visibility") === "PRIVATE" ? "PRIVATE" : "PUBLIC" };
    setPending(true); onSaving(true); setFailure(null);
    try {
      const result = await transport.save(details.sessionId, input);
      if (mounted.current) onSaved(result);
    } catch (error) {
      if (mounted.current) setFailure(error instanceof SessionEditingError ? error
        : { message: "We couldn't confirm the save. Reload the latest details to check the result.", reload: true });
    } finally {
      if (mounted.current) setPending(false);
      onSaving(false);
    }
  }

  function field(label: string, name: string, value: string, options: React.InputHTMLAttributes<HTMLInputElement> = {}) {
    return <label className={styles.field} htmlFor={`${prefix}-${name}`}><span>{label}</span>
      <input id={`${prefix}-${name}`} name={name} defaultValue={value} required {...options} /></label>;
  }

  return <form onSubmit={(event) => void save(event)} className={styles.form} aria-busy={pending}>
    <div className={styles.body} tabIndex={0} role="region" aria-label="Session fields">
      {!details.canEdit && <p className={styles.notice}>This session has started or closed and can no longer be edited.</p>}
      {details.bookingLocked && details.canEdit && <p className={styles.notice}><LockKeyhole size={17} aria-hidden="true" />
        <span>Players have already joined. Booking details and price are locked; you can still update capacity and visibility.</span></p>}
      <fieldset disabled={locked || pending} className={styles.section}>
        <legend>Booking details</legend>
        {field("Venue name", "venueName", details.booking.venueName, { maxLength: 300 })}
        <div className={styles.grid}>
          {field("Sport", "sport", details.booking.sport, { maxLength: 100 })}
          {field("Region", "region", details.booking.region, { maxLength: 100 })}
          {field("Starts (SGT)", "startAt", singaporeInput(details.booking.startAt), { type: "datetime-local" })}
          {field("Ends (SGT)", "endAt", singaporeInput(details.booking.endAt), { type: "datetime-local" })}
          {field("Venue booking cost (SGD)", "cost", decimalCents(details.booking.totalCostCents), { inputMode: "decimal" })}
          {field("Price per player (SGD)", "price", decimalCents(details.booking.pricePerSlotCents), { inputMode: "decimal" })}
        </div>
        <p className={styles.hint}>All times are in Singapore time. Updating this session does not change your booking with the venue.</p>
      </fieldset>
      <fieldset disabled={!details.canEdit || pending} className={styles.section}>
        <legend>Players & visibility</legend>
        <div className={styles.grid}>
          <label className={styles.field} htmlFor={`${prefix}-capacity`}><span>Capacity</span>
            <input id={`${prefix}-capacity`} name="totalSlots" type="number" min={details.minimumSlots} max={Math.max(30, details.totalSlots)}
              required value={Number.isNaN(capacity) ? "" : capacity} onChange={(event) => setCapacity(event.currentTarget.valueAsNumber)} aria-describedby={`${prefix}-capacity-hint`} />
          </label>
          <label className={styles.field} htmlFor={`${prefix}-visibility`}><span>Visibility</span>
            <select id={`${prefix}-visibility`} name="visibility" defaultValue={details.visibility} disabled={full} aria-describedby={`${prefix}-visibility-hint`}>
              <option value="PUBLIC">Public</option><option value="PRIVATE">Private</option>
            </select>
          </label>
        </div>
        <div className={styles.grid}>
          <p id={`${prefix}-capacity-hint`} className={styles.hint}>Includes your place. Minimum {details.minimumSlots} {details.minimumSlots === 1 ? "player" : "players"} to keep occupied and reserved places.</p>
          <p id={`${prefix}-visibility-hint`} className={styles.hint}>{full ? "Visibility is locked while the session is full." : "Public sessions appear in Discover. Private sessions are shared by invitation."}</p>
        </div>
      </fieldset>
      {failure && <div className={styles.error}><p role="alert">{failure.message}</p>
        {failure.reload && <Button type="button" variant="outline" disabled={pending} onClick={onReload}>Reload latest details</Button>}</div>}
    </div>
    <footer className={styles.footer}><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
      <Button type="submit" disabled={pending || !details.canEdit}>{pending ? "Saving…" : "Save changes"}</Button></footer>
  </form>;
}
