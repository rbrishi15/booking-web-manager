import type { SessionParticipants as CoreSessionParticipants } from "@/use-cases/sessions/ListSessionParticipants";

/** Serializable participant screen data; private account and hold details stay server-side. */
export type SessionParticipants = Omit<CoreSessionParticipants, "startAt" | "endAt"> & {
  readonly startAt: string;
  readonly endAt: string;
};

export function serializeSessionParticipants(session: CoreSessionParticipants): SessionParticipants {
  return { ...session, startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString() };
}
