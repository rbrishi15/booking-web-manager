import { z } from "zod";
import { REGIONS, SPORTS } from "@/app/(auth)/schemas";
import { createSessionRequestSchema } from "../create-session-input";
import { sessionPricing } from "@/domain/sessions/pricing";
import type { VenueCandidate } from "@/lib/venues/contracts";

export type CreateSessionPayload = z.infer<typeof createSessionRequestSchema>;
export interface SessionDraft {
  sport: string; venueName: string; region: string;
  startDate: string; startTime: string; endDate: string; endTime: string;
  cost: string; totalSlots: number; minimumHeadcount: number;
  visibility: "PRIVATE" | "PUBLIC"; reliability: string; price: string;
  selectedVenue: VenueCandidate | null;
}
export const emptySessionDraft: SessionDraft = {
  sport: "Tennis", venueName: "", region: "", startDate: "", startTime: "", endDate: "", endTime: "",
  cost: "", totalSlots: 8, minimumHeadcount: 4, visibility: "PRIVATE", reliability: "90", price: "", selectedVenue: null,
};
export type FieldErrors = Partial<Record<keyof SessionDraft | "dateTime", string>>;

/** Parse decimal SGD directly into integer cents without floating-point rounding. */
export function parseSgdCents(value: string): number | undefined {
  const match = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const cents = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : undefined;
}
export function decimalCents(cents: number): string {
  const amount = BigInt(cents);
  return `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
}
/** A round trip rejects calendar overflow; the explicit offset is independent of the browser timezone. */
export function singaporeTimestamp(date: string, time: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  const instant = new Date(`${date}T${time}:00+08:00`);
  if (!Number.isFinite(instant.getTime())) return undefined;
  const local = new Date(instant.getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
  return local === `${date}T${time}` ? instant.toISOString() : undefined;
}
/** Keep the persisted start/end contract while the editor asks for a duration. */
export function bookingDates(startDate: string, startTime: string, duration: string): Pick<SessionDraft, "startDate" | "startTime" | "endDate" | "endTime"> | undefined {
  const start = singaporeTimestamp(startDate, startTime);
  const minutes = Number(duration);
  if (!start || !duration.trim() || !Number.isSafeInteger(minutes) || minutes <= 0) return undefined;
  const end = new Date(new Date(start).getTime() + minutes * 60_000 + 8 * 3_600_000);
  if (!Number.isFinite(end.getTime())) return undefined;
  const localEnd = end.toISOString();
  if (!/^\d{4}-/.test(localEnd)) return undefined;
  return { startDate, startTime, endDate: localEnd.slice(0, 10), endTime: localEnd.slice(11, 16) };
}
export function durationMinutes(draft: SessionDraft): number | undefined {
  const start = singaporeTimestamp(draft.startDate, draft.startTime);
  const end = singaporeTimestamp(draft.endDate, draft.endTime);
  if (!start || !end) return undefined;
  const minutes = (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : undefined;
}
export function draftPricing(draft: SessionDraft) {
  const cost = parseSgdCents(draft.cost);
  if (cost === undefined) return undefined;
  try { return sessionPricing(cost, draft.totalSlots); } catch { return undefined; }
}
export function updateDraft(draft: SessionDraft, patch: Partial<SessionDraft>): SessionDraft {
  const next = { ...draft, ...patch };
  if (patch.totalSlots !== undefined) next.minimumHeadcount = Math.min(next.minimumHeadcount, next.totalSlots);
  if (patch.cost !== undefined || patch.totalSlots !== undefined) {
    const pricing = draftPricing(next);
    next.price = pricing ? decimalCents(pricing.suggestedCents) : "";
  }
  return next;
}
export function validateDates(draft: SessionDraft, now = Date.now()): FieldErrors {
  const start = singaporeTimestamp(draft.startDate, draft.startTime);
  const end = singaporeTimestamp(draft.endDate, draft.endTime);
  if (!start || !end) return { dateTime: "Enter a valid start date, start time, and duration." };
  if (new Date(start).getTime() <= now) return { dateTime: "Choose a start time in the future." };
  if (end <= start) return { dateTime: "Choose a duration greater than zero." };
  return {};
}
export function validateStep(draft: SessionDraft, step: number, now = Date.now()): FieldErrors {
  if (step === 1) return {
    ...(!SPORTS.some((sport) => sport === draft.sport) && { sport: "Choose a sport." }),
    ...(!draft.venueName.trim() && { venueName: "Enter or select a venue." }),
    ...(!REGIONS.some((region) => region === draft.region) && { region: "Choose the venue's region." }),
    ...validateDates(draft, now),
    ...(!draftPricing(draft) && { cost: "Enter a valid booking cost, with at least one cent per slot." }),
  };
  if (step === 2) return {
    ...(!Number.isInteger(draft.totalSlots) || draft.totalSlots < 2 || draft.totalSlots > 8 ? { totalSlots: "Choose 2 to 8 slots." } : {}),
    ...(!Number.isInteger(draft.minimumHeadcount) || draft.minimumHeadcount < 2 || draft.minimumHeadcount > draft.totalSlots
      ? { minimumHeadcount: "Choose a minimum headcount between 2 and the number of slots." } : {}),
    ...(!["none", "60", "70", "80", "90", "100"].includes(draft.reliability) && { reliability: "Choose a reliability requirement." }),
  };
  const range = draftPricing(draft);
  const price = parseSgdCents(draft.price);
  return !range || price === undefined || price < range.minimumCents || price > range.maximumCents
    ? { price: "Choose a price within the displayed range." } : {};
}
export function submissionPayload(draft: SessionDraft, idempotencyKey: string): CreateSessionPayload {
  return createSessionRequestSchema.parse({
    idempotencyKey,
    booking: { sport: draft.sport, venueName: draft.venueName.trim(), region: draft.region,
      startAt: singaporeTimestamp(draft.startDate, draft.startTime), endAt: singaporeTimestamp(draft.endDate, draft.endTime),
      totalCostCents: parseSgdCents(draft.cost) },
    config: { totalSlots: draft.totalSlots, minimumHeadcount: draft.minimumHeadcount, visibility: draft.visibility,
      ...(draft.reliability !== "none" && { minimumReliability: Number(draft.reliability) }),
      pricePerSlotCents: parseSgdCents(draft.price) },
  });
}
export const pendingSubmissionSchema = z.object({ version: z.literal(1), payload: createSessionRequestSchema });
export type PendingSubmission = z.infer<typeof pendingSubmissionSchema>;
export const pendingStorageKey = (userId: string) => `booking:create-session:v1:${userId}`;
export function draftFromSubmission({ booking, config }: CreateSessionPayload): SessionDraft {
  const local = (value: string) => new Date(new Date(value).getTime() + 8 * 3_600_000).toISOString();
  const start = local(booking.startAt), end = local(booking.endAt);
  return { ...emptySessionDraft, sport: booking.sport, venueName: booking.venueName, region: booking.region,
    startDate: start.slice(0, 10), startTime: start.slice(11, 16), endDate: end.slice(0, 10), endTime: end.slice(11, 16),
    cost: decimalCents(booking.totalCostCents), totalSlots: config.totalSlots, minimumHeadcount: config.minimumHeadcount,
    visibility: config.visibility ?? "PRIVATE", reliability: config.minimumReliability === undefined ? "none" : String(config.minimumReliability),
    price: decimalCents(config.pricePerSlotCents ?? sessionPricing(booking.totalCostCents, config.totalSlots).suggestedCents) };
}
