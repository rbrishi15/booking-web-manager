"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import {
  verifyAttendance as defaultVerifyAttendance,
  type AttendanceMark,
  type VerifyAttendance,
  type VerifyAttendanceRequest,
} from "../verify-attendance-transport";

/** A committed player the booker can still mark. */
export interface UnverifiedPlayer {
  readonly participationId: string;
  readonly displayName: string;
}

type Choice = AttendanceMark["attendance"];

/**
 * UC2-06 Verify Attendance: the booker marks each unverified committed player as attended or
 * absent, confirms, and the marks are sent in one request. Marks cannot be changed afterwards.
 * After an unconfirmed result the same request (key and marks) is kept and the choices are
 * locked, so a retry can only replay it.
 */
export function AttendanceVerificationForm({ sessionId, players, onSaved, verifyAttendance = defaultVerifyAttendance }: {
  readonly sessionId: string;
  readonly players: readonly UnverifiedPlayer[];
  /** Called after the server accepts the marks, to reload the participant list. */
  readonly onSaved: () => void;
  /** Injected in stories and tests; production calls POST /api/sessions/attendance. */
  readonly verifyAttendance?: VerifyAttendance;
}) {
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const [unconfirmed, setUnconfirmed] = useState<VerifyAttendanceRequest | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const marks: readonly AttendanceMark[] = unconfirmed?.marks
    ?? players.flatMap((player) => choices[player.participationId] ? [{ participationId: player.participationId, attendance: choices[player.participationId]! }] : []);
  const attended = marks.filter((mark) => mark.attendance === "ATTENDED").length;
  const absent = marks.length - attended;

  async function save() {
    const request = unconfirmed ?? { sessionId, idempotencyKey: crypto.randomUUID(), marks };
    setError(null);
    setSaved(null);
    const outcome = await verifyAttendance(request);
    if (outcome.status === "saved") {
      setUnconfirmed(null);
      setChoices({});
      setSaved(outcome.allVerified ? "Attendance saved. Every player is now checked." : "Attendance saved.");
      onSaved();
      return;
    }
    setUnconfirmed(outcome.unconfirmed ? request : null);
    setError(outcome.message);
    throw new Error(outcome.message);
  }

  return (
    <section aria-labelledby="attendance-heading" className="mb-6 rounded-lg border bg-card p-4 md:p-6">
      <h2 id="attendance-heading" className="text-lg font-semibold">Check attendance</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Mark who came. The shares of players marked attended or absent are released to you when the session is paid out.
        Anyone you don&apos;t mark is marked attended automatically 72 hours after the session ends.
      </p>

      {saved && <p role="status" className="mt-3 text-sm">{saved}</p>}

      {players.length > 0 && (
        <ul aria-label="Players to check" className="mt-4 space-y-3">
          {players.map((player) => {
            const name = `attendance-${player.participationId}`;
            const current = unconfirmed?.marks.find((mark) => mark.participationId === player.participationId)?.attendance ?? choices[player.participationId];
            return (
              <li key={player.participationId}>
                <fieldset className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border p-3" disabled={unconfirmed !== null}>
                  <legend className="sr-only">{player.displayName}</legend>
                  <span aria-hidden="true" className="min-w-0 break-words font-medium">{player.displayName}</span>
                  <div className="flex gap-2">
                    {(["ATTENDED", "ABSENT"] as const).map((choice) => (
                      <label key={choice} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:cursor-not-allowed has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                        <input type="radio" name={name} value={choice} className="h-4 w-4" checked={current === choice}
                          onChange={() => setChoices((previous) => ({ ...previous, [player.participationId]: choice }))} />
                        {choice === "ATTENDED" ? "Attended" : "Absent"}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ul>
      )}

      {error && !saved && <div className="mt-3"><ErrorMessage>{error}</ErrorMessage></div>}

      {players.length > 0 && (
        <div className="mt-4">
          <ConfirmDialog
            trigger={<Button className="min-h-11" disabled={marks.length === 0}>{unconfirmed ? "Retry saving attendance" : `Save attendance (${marks.length})`}</Button>}
            title="Save attendance?"
            description={<>{attended} attended, {absent} absent. These marks can&apos;t be changed after saving.</>}
            confirmLabel={unconfirmed ? "Retry saving" : "Save attendance"}
            onConfirm={save}
          />
        </div>
      )}
      {unconfirmed && <InfoNote icon className="mt-3">Your choices are locked until this save is confirmed, so the same marks are sent again.</InfoNote>}
    </section>
  );
}
