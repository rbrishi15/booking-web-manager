"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { bookingDates, durationMinutes, singaporeTimestamp, validateDates, type SessionDraft } from "./model";

const day = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric" });
const weekday = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", weekday: "long" });
const time = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit" });
const durations = [
  { minutes: 60, label: "1 hour", short: "1h" },
  { minutes: 90, label: "1 hour 30 minutes", short: "1h 30m" },
  { minutes: 120, label: "2 hours", short: "2h" },
  { minutes: 180, label: "3 hours", short: "3h" },
];
function scheduleInput(draft: SessionDraft) {
  return { startDate: draft.startDate, startTime: draft.startTime, duration: String(durationMinutes(draft) ?? 60) };
}
type ScheduleField = keyof ReturnType<typeof scheduleInput>;

export function DateTimeEditor({ draft, disabled, error, onChange }: {
  readonly draft: SessionDraft; readonly disabled: boolean; readonly error?: string;
  readonly onChange: (patch: Partial<SessionDraft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(() => scheduleInput(draft));
  const [dialogError, setDialogError] = useState<{ field: ScheduleField; message: string }>();
  const start = singaporeTimestamp(draft.startDate, draft.startTime);
  const end = singaporeTimestamp(draft.endDate, draft.endTime);
  const dates = bookingDates(editing.startDate, editing.startTime, editing.duration);
  const previewEnd = dates && singaporeTimestamp(dates.endDate, dates.endTime);
  const nextDay = dates && new Date(dates.endDate).getTime() - new Date(dates.startDate).getTime() === 86_400_000;
  const update = (field: ScheduleField, value: string) => {
    setEditing((current) => ({ ...current, [field]: value }));
    setDialogError(undefined);
  };
  const showError = (field: ScheduleField, message: string) => {
    setDialogError({ field, message });
    document.getElementById(`booking-${field}`)?.focus();
  };
  const save = () => {
    if (!singaporeTimestamp(editing.startDate, "00:00")) {
      showError("startDate", "Choose a valid start date.");
      return;
    }
    if (!singaporeTimestamp(editing.startDate, editing.startTime)) {
      showError("startTime", "Choose a valid start time.");
      return;
    }
    if (!dates) {
      showError("duration", "Enter a valid duration of at least 1 minute.");
      return;
    }
    const errors = validateDates({ ...draft, ...dates });
    if (errors.dateTime) {
      showError("startDate", errors.dateTime);
      return;
    }
    onChange(dates);
    setOpen(false);
  };
  return <div className="space-y-2">
    <label htmlFor="dateTime" className="text-xs font-semibold">Date &amp; Time</label>
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (value) { setEditing(scheduleInput(draft)); setDialogError(undefined); } }}>
      <DialogTrigger asChild>
        <Button id="dateTime" type="button" variant="outline" disabled={disabled} aria-label="Edit booking schedule"
          aria-invalid={!!error} aria-describedby="dateTime-error" className="h-auto min-h-20 w-full justify-start whitespace-normal p-0 text-left">
          <div className="flex min-h-20 w-full items-stretch">
            <div className="flex flex-1 items-center gap-3 border-r p-3"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{start ? <><span className="block font-semibold">{day.format(new Date(start))}</span><span className="mt-1 block text-xs font-normal">{weekday.format(new Date(start))}</span></> : "Choose a date"}</span></div>
            <span className="flex flex-1 flex-col justify-center gap-1 p-3 text-sm font-semibold">{start && end ? <>{time.format(new Date(start))} – {time.format(new Date(end))}
              {draft.endDate !== draft.startDate && <span className="text-xs font-normal">Ends {day.format(new Date(end))}</span>}<span className="text-xs font-normal">Singapore time</span></> : "Set time & duration"}</span>
          </div>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto rounded-lg">
        <DialogHeader><DialogTitle>Booking schedule</DialogTitle><DialogDescription>Choose when you’re playing and for how long. All times are in Singapore (SGT).</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {([ ["startDate", "Start date", "date"], ["startTime", "Start time", "time"] ] as const).map(([key, label, type]) => <div key={key} className="min-w-0 space-y-2">
            <label htmlFor={`booking-${key}`} className="text-sm font-medium">{label}</label>
            <Input id={`booking-${key}`} type={type} value={editing[key]} className="min-h-11 min-w-0" aria-invalid={dialogError?.field === key}
              aria-describedby={dialogError?.field === key ? "booking-schedule-error" : undefined}
              onChange={(event) => update(key, event.target.value)} />
          </div>)}
        </div>
        <div className="space-y-2">
          <label htmlFor="booking-duration" className="text-sm font-medium">Duration (minutes)</label>
          <Input id="booking-duration" type="number" inputMode="numeric" min={1} step={1} value={editing.duration}
            className="min-h-11" aria-invalid={dialogError?.field === "duration"}
            aria-describedby={dialogError?.field === "duration" ? "booking-schedule-error" : undefined}
            onChange={(event) => update("duration", event.target.value)} />
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Common durations">
            {durations.map(({ minutes, label, short }) => <Button key={minutes} type="button" variant={Number(editing.duration) === minutes ? "default" : "outline"}
              className="min-h-11 px-2" aria-label={label} aria-pressed={Number(editing.duration) === minutes}
              onClick={() => update("duration", String(minutes))}>{short}</Button>)}
          </div>
        </div>
        <p className="rounded-md bg-muted p-3 text-sm" aria-live="polite" aria-atomic="true">
          {previewEnd ? <>Ends {day.format(new Date(previewEnd))} at {time.format(new Date(previewEnd))}{nextDay && " (next day)"}</>
            : "Your finish time will appear here."}
        </p>
        {dialogError && <p id="booking-schedule-error" role="alert" className="text-sm text-destructive">{dialogError.message}</p>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" className="min-h-11" onClick={save}>Save schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <p id="dateTime-error" role={error ? "alert" : undefined} className="text-xs text-destructive">{error}</p>
  </div>;
}
