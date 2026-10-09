import { redirect } from "next/navigation";
import { DomainError } from "@/domain";
import { getAccountStatus, type AccountStatus } from "@/lib/supabase/account-status";
import { createClient } from "@/lib/supabase/server";
import { getSessionManagementDependencies } from "./management-server-dependencies";
import { SessionManagementUnavailableError } from "./session-management-unavailable";
import type { HostedSessionsOutcome } from "./types";
import { toHostedSessionActions } from "./session-actions";

/** The signed-in app requires an active account; Booker retains its domain policy. */
export async function loadHostedSessionsScreen(userId: string): Promise<HostedSessionsOutcome> {
  let account: AccountStatus;
  try {
    account = await getAccountStatus(await createClient(), userId);
  } catch {
    return { status: "error", kind: "unexpected" };
  }
  if (account.kind === "inactive" || account.kind === "missing-profile") redirect("/login");
  if (account.kind === "lookup-failed") return { status: "error", kind: "unexpected" };
  try {
    const { listHostedSessions } = await getSessionManagementDependencies();
    const [sessions, attendanceDue] = await Promise.all([
      listHostedSessions.forBooker(userId),
      // The attendance reminder is secondary: if it fails, still show the hosted sessions.
      // Account problems keep their redirect below.
      listHostedSessions.attendanceDueForBooker(userId).catch((error: unknown) => {
        if (error instanceof DomainError && (error.code === "INACTIVE_ACCOUNT" || error.code === "NOT_FOUND")) throw error;
        console.error("UC2-06 attendance-due list failed:", error instanceof Error ? error.name : "unknown");
        return [];
      }),
    ]);
    return {
      status: "ready",
      awaitingAttendance: attendanceDue.map((session) => ({
        sessionId: session.sessionId, venueName: session.venueName, sport: session.sport,
        startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(), unverifiedCount: session.unverifiedCount,
      })),
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId, venueName: session.venueName, sport: session.sport,
        region: session.region, startAt: session.startAt.toISOString(), endAt: session.endAt.toISOString(),
        visibility: session.visibility, availableSlots: session.availableSlots,
        actions: toHostedSessionActions(session.sessionId, session.actions),
      })),
    };
  } catch (error) {
    if (error instanceof DomainError && (error.code === "INACTIVE_ACCOUNT" || error.code === "NOT_FOUND")) redirect("/login");
    return { status: "error", kind: error instanceof SessionManagementUnavailableError ? "unavailable" : "unexpected" };
  }
}
