"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { REGIONS } from "@/app/(auth)/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VenueCandidate } from "@/lib/venues/contracts";
import type { FieldErrors, SessionDraft } from "./model";
import type { SearchVenues } from "./transport";

interface Props {
  readonly draft: SessionDraft; readonly errors: FieldErrors; readonly disabled: boolean;
  readonly onChange: (patch: Partial<SessionDraft>) => void; readonly search: SearchVenues;
}
export function VenuePicker({ draft, errors, disabled, onChange, search }: Props) {
  const [manual, setManual] = useState(false);
  const [items, setItems] = useState<readonly VenueCandidate[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const generation = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const query = draft.venueName.trim();
  useEffect(() => {
    const current = ++generation.current;
    if (manual || disabled || draft.selectedVenue || query.length < 2) {
      setItems([]); setStatus("idle"); setNextPage(null); return;
    }
    const controller = new AbortController();
    setStatus("loading");
    const timer = setTimeout(() => {
      void search(query, page, controller.signal).then((result) => {
        if (controller.signal.aborted || current !== generation.current) return;
        setItems((previous) => page === 1 ? result.items : [...previous, ...result.items]);
        setNextPage(result.nextPage); setStatus("ready"); setActive(-1);
        // Pagination is an explicit request to show more candidates; its disabled button may lose focus while loading.
        setOpen(page > 1 || (picker.current?.contains(document.activeElement) ?? false));
      }).catch(() => {
        if (!controller.signal.aborted && current === generation.current) { setStatus("failed"); setItems([]); setNextPage(null); }
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [draft.venueName, query, page, manual, disabled, draft.selectedVenue, search]);
  useEffect(() => { if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" }); }, [active, open]);

  function choose(item: VenueCandidate) {
    generation.current++;
    onChange({ venueName: item.venueName, region: item.region ?? "", selectedVenue: item });
    setOpen(false); setActive(-1);
  }
  const expanded = open && items.length > 0 && !disabled;
  return <div ref={picker} className="space-y-2" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label htmlFor="venueName" className="text-xs font-semibold">Venue</label>
    <div className="relative">
      <Input id="venueName" role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={expanded}
        aria-controls={expanded ? "venue-options" : undefined} aria-activedescendant={expanded && active >= 0 ? `venue-option-${active}` : undefined}
        aria-invalid={!!errors.venueName} aria-describedby="venue-help venueName-error" disabled={disabled}
        placeholder="Search or enter a venue" value={draft.venueName} className="min-h-11 pr-10"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          generation.current++;
          setPage(1); setItems([]); setActive(-1); setOpen(true);
          onChange({ venueName: event.target.value, selectedVenue: null, ...(draft.selectedVenue && { region: "" }) });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
            event.preventDefault(); setOpen(true); setActive((previous) => event.key === "ArrowDown" ? (previous + 1) % items.length : (previous - 1 + items.length) % items.length);
          }
          if (event.key === "Enter" && expanded && active >= 0) { event.preventDefault(); choose(items[active]!); }
        }} />
      {draft.selectedVenue && <CheckCircle2 aria-label="Venue selected from OneMap" className="pointer-events-none absolute right-3 top-3 h-5 w-5 text-muted-foreground" />}
      {expanded && <ul ref={list} id="venue-options" role="listbox" aria-label="Venue search results" className="relative z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
        {items.map((item, index) => <li key={`${item.latitude}-${item.longitude}-${index}`} id={`venue-option-${index}`} role="option"
          aria-selected={active === index} className={`cursor-pointer px-3 py-3 text-sm ${active === index ? "bg-accent" : "hover:bg-accent"}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
          <span className="block font-medium">{item.venueName}</span><span className="block text-xs text-muted-foreground">{item.address}</span>
        </li>)}
      </ul>}
    </div>
    <p id="venueName-error" role={errors.venueName ? "alert" : undefined} className="text-xs text-destructive">{errors.venueName}</p>
    <p id="venue-help" role="status" className="text-xs leading-relaxed text-muted-foreground">
      {draft.selectedVenue ? draft.selectedVenue.region ? `${draft.selectedVenue.address} · ${draft.region}` : "Venue found. Choose a region below to continue."
        : status === "loading" ? "Searching OneMap…" : status === "failed" ? "Venue search is unavailable. Enter the venue and region manually."
          : status === "ready" && items.length === 0 ? "No venues found. Enter the venue and region manually."
            : manual ? "Enter the name of your booked venue and choose its region." : "Search OneMap or enter your booked venue manually."}
    </p>
    {!draft.selectedVenue && <Button type="button" variant="link" className="h-auto min-h-11 px-0 text-xs" disabled={disabled}
      onClick={() => { generation.current++; setManual((value) => !value); setPage(1); setOpen(false); }}>{manual ? "Search OneMap instead" : "Enter venue manually"}</Button>}
    {nextPage && !manual && !draft.selectedVenue && <Button type="button" variant="outline" className="min-h-11" disabled={disabled || status === "loading"}
      onClick={() => setPage(nextPage)}>More venues</Button>}
    {!draft.selectedVenue?.region && <div className="space-y-2">
      <label htmlFor="region" className="text-xs font-semibold">Region</label>
      <Select value={draft.region} disabled={disabled} onValueChange={(region) => onChange({ region })}>
        <SelectTrigger id="region" className="min-h-11" aria-invalid={!!errors.region} aria-describedby="region-error"><SelectValue placeholder="Choose a region" /></SelectTrigger>
        <SelectContent>{REGIONS.map((region) => <SelectItem key={region} value={region}>{region}</SelectItem>)}</SelectContent>
      </Select>
      <p id="region-error" role={errors.region ? "alert" : undefined} className="text-xs text-destructive">{errors.region}</p>
    </div>}
  </div>;
}
