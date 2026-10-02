"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { singaporeTimestamp, validateDates, type SessionDraft } from "./model";

const day = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric" });
const weekday = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", weekday: "long" });
const time = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit" });
export function DateTimeEditor({ draft, disabled, error, onChange }: {
  readonly draft: SessionDraft; readonly disabled: boolean; readonly error?: string;
  readonly onChange: (patch: Partial<SessionDraft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(draft);
  const [dialogError, setDialogError] = useState<string>();
  const start = singaporeTimestamp(draft.startDate, draft.startTime);
  const end = singaporeTimestamp(draft.endDate, draft.endTime);
  return <div className="space-y-2">
    <label htmlFor="dateTime" className="text-xs font-semibold">Date &amp; Time</label>
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) { setEditing(draft); setDialogError(undefined); } }}>
      <DialogTrigger asChild>
        <Button id="dateTime" type="button" variant="outline" disabled={disabled} aria-label="Edit booking dates and times"
          aria-invalid={!!error} aria-describedby="dateTime-error" className="h-auto min-h-20 w-full justify-start whitespace-normal p-0 text-left">
          <div className="flex min-h-20 w-full items-stretch">
            <div className="flex flex-1 items-center gap-3 border-r p-3"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{start ? <><span className="block font-semibold">{day.format(new Date(start))}</span><span className="mt-1 block text-xs font-normal">{weekday.format(new Date(start))}</span></> : "Choose dates"}</span></div>
            <span className="flex flex-1 flex-col justify-center gap-1 p-3 text-sm font-semibold">{start && end ? <>{time.format(new Date(start))} – {time.format(new Date(end))}
              {draft.endDate !== draft.startDate && <span className="text-xs font-normal">Ends {day.format(new Date(end))}</span>}<span className="text-xs font-normal">Singapore time</span></> : "Choose times · SGT"}</span>
          </div>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto rounded-lg">
        <DialogHeader><DialogTitle>Booking dates and times</DialogTitle><DialogDescription>All times are in Singapore (SGT). Choose a separate end date for overnight bookings.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {([ ["startDate", "Start date", "date"], ["startTime", "Start time", "time"], ["endDate", "End date", "date"], ["endTime", "End time", "time"] ] as const).map(([key, label, type]) => <div key={key} className="min-w-0 space-y-2">
            <label htmlFor={`booking-${key}`} className="text-sm font-medium">{label}</label>
            <Input id={`booking-${key}`} type={type} value={editing[key]} className="min-h-11 min-w-0" aria-invalid={!!dialogError}
              onChange={(event) => { setEditing((value) => ({ ...value, [key]: event.target.value })); setDialogError(undefined); }} />
          </div>)}
        </div>
        {dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
        <DialogFooter><Button type="button" className="min-h-11" onClick={() => {
          const errors = validateDates(editing);
          if (errors.dateTime) { setDialogError(errors.dateTime); document.getElementById("booking-startDate")?.focus(); return; }
          onChange({ startDate: editing.startDate, startTime: editing.startTime, endDate: editing.endDate, endTime: editing.endTime }); setOpen(false);
        }}>Save dates and times</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <p id="dateTime-error" role={error ? "alert" : undefined} className="text-xs text-destructive">{error}</p>
  </div>;
}
