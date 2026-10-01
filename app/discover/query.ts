import { z } from "zod";
import { REGIONS, SPORTS } from "@/app/(auth)/schemas";
import type {
  DiscoverSessionsInput,
  SessionDiscoveryCursor,
} from "@/use-cases/sessions/DiscoverSessions";

export interface DiscoveryFilters {
  sport: string;
  region: string;
  date: string;
  timeFrom: string;
  timeTo: string;
}

export type DiscoveryFieldErrors = Partial<Record<keyof DiscoveryFilters | "cursor", string[]>>;
const filterNames = ["sport", "region", "date", "timeFrom", "timeTo"] as const;
const queryNames = [...filterNames, "cursor"] as const;
const cursorSchema = z.object({
  startAt: z.string().datetime(),
  sessionId: z.string().uuid(),
}).strict();

export type ParsedDiscoveryQuery = {
  filters: DiscoveryFilters;
  cursor: string;
  queryKey: string;
} & (
  | { status: "valid"; input: DiscoverSessionsInput }
  | { status: "invalid"; fieldErrors: DiscoveryFieldErrors }
);

/** Portable URL contract shared by the API, server page, and form controller. */
export function parseDiscoveryQuery(params: URLSearchParams): ParsedDiscoveryQuery {
  const filters: DiscoveryFilters = {
    sport: params.get("sport")?.trim() ?? "",
    region: params.get("region")?.trim() ?? "",
    date: params.get("date")?.trim() ?? "",
    timeFrom: params.get("timeFrom")?.trim() ?? "",
    timeTo: params.get("timeTo")?.trim() ?? "",
  };
  const cursor = params.get("cursor")?.trim() ?? "";
  const fieldErrors: DiscoveryFieldErrors = {};
  const invalid = (field: keyof DiscoveryFieldErrors, message: string) => {
    (fieldErrors[field] ??= []).push(message);
  };
  for (const name of queryNames) {
    if (params.getAll(name).length > 1) invalid(name, "Provide this filter only once");
  }
  if (filters.sport && !SPORTS.some((sport) => sport === filters.sport))
    invalid("sport", "Choose a sport from the list");
  if (filters.region && !REGIONS.some((region) => region === filters.region))
    invalid("region", "Choose a region from the list");
  if (filters.date && !validCalendarDate(filters.date))
    invalid("date", "Enter a valid date (YYYY-MM-DD)");
  for (const field of ["timeFrom", "timeTo"] as const) {
    if (!filters[field]) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(filters[field]))
      invalid(field, "Enter a valid time (HH:mm)");
    if (!filters.date) invalid("date", "Choose a date when filtering by time");
  }
  if (filters.timeTo && (filters.timeFrom || "00:00") >= filters.timeTo)
    invalid("timeTo", "End time must be later than start time on the same day");

  let decodedCursor: SessionDiscoveryCursor | undefined;
  if (cursor) {
    try {
      if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("Invalid cursor");
      const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
      decodedCursor = cursorSchema.parse(JSON.parse(atob(base64)));
      if (!Number.isFinite(new Date(decodedCursor.startAt).getTime())) throw new Error("Invalid cursor timestamp");
    } catch {
      invalid("cursor", "Invalid page cursor; clear filters to start again");
    }
  }
  const queryKey = params.toString();
  if (Object.keys(fieldErrors).length > 0)
    return { status: "invalid", filters, cursor, queryKey, fieldErrors };

  let startAtFrom: Date | undefined;
  let startAtBefore: Date | undefined;
  if (filters.date) {
    startAtFrom = new Date(`${filters.date}T${filters.timeFrom || "00:00"}:00+08:00`);
    startAtBefore = filters.timeTo
      ? new Date(`${filters.date}T${filters.timeTo}:00+08:00`)
      : new Date(new Date(`${filters.date}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000);
  }
  return {
    status: "valid", filters, cursor, queryKey: buildDiscoveryQuery(filters, cursor),
    input: {
      ...(filters.sport ? { sport: filters.sport } : {}),
      ...(filters.region ? { region: filters.region } : {}),
      ...(startAtFrom ? { startAtFrom, startAtBefore } : {}),
      ...(decodedCursor ? { cursor: decodedCursor } : {}),
    },
  };
}

export function buildDiscoveryQuery(filters: DiscoveryFilters, cursor = ""): string {
  const params = new URLSearchParams();
  for (const name of filterNames) if (filters[name].trim()) params.set(name, filters[name].trim());
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function encodeDiscoveryCursor(cursor: SessionDiscoveryCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
