import { randomUUID } from "node:crypto";
import type { CommitmentDependencies } from "@/app/commit/commitment-dependencies";
import { readPushSettings } from "@/app/commit/push-environment";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { NoDeliveryNotifier } from "@/lib/commit/no-delivery-notifier";
import { createWebPush } from "@/lib/commit/web-push";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresCommitmentUnitOfWork } from "@/lib/sessions/postgres-commitment-unit-of-work";
import { PostgresJoinedSessionsReader } from "@/lib/sessions/postgres-joined-sessions-reader";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import { AcceptReplacement } from "@/use-cases/sessions/AcceptReplacement";
import { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { LeaveWaitlist } from "@/use-cases/sessions/LeaveWaitlist";
import { ListJoinedSessions } from "@/use-cases/sessions/ListJoinedSessions";
import { PromoteFromWaitlist } from "@/use-cases/sessions/PromoteFromWaitlist";
import { VerifyAttendance } from "@/use-cases/sessions/VerifyAttendance";
import { WithdrawFromSession } from "@/use-cases/sessions/WithdrawFromSession";

/**
 * Assembles the UC2-04/05/06 commitment actions on one Postgres unit of work,
 * which claims each idempotency key and writes the session change and its
 * fund movements in one transaction. Authentication verifies identity only:
 * the unit of work loads the complete User, whose roles enforce account
 * status, email verification and reliability. Notifications go out by Web Push
 * when VAPID settings are present, and are accepted but not delivered
 * otherwise. Without server settings every call reports
 * SESSION_MANAGEMENT_UNAVAILABLE.
 */
export function createCommitmentDependencies(): CommitmentDependencies {
  const settings = readSessionServerSettings();
  if (!settings) {
    const unavailable = async (): Promise<never> => {
      throw new SessionManagementUnavailableError();
    };
    return {
      authenticate: unavailable,
      commitToSession: { forParticipant: unavailable },
      withdrawFromSession: { forParticipant: unavailable },
      acceptReplacement: { forInvitee: unavailable },
      leaveWaitlist: { forParticipant: unavailable },
      verifyAttendance: { forBooker: unavailable },
      listJoinedSessions: { forParticipant: unavailable },
    };
  }
  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  const clock = { now: () => new Date() };
  const ids = { next: randomUUID };
  const unitOfWork = new PostgresCommitmentUnitOfWork(getPool, clock);
  const push = readPushSettings();
  const notifier = push ? createWebPush(getPool, push).notifier : new NoDeliveryNotifier();
  const promote = new PromoteFromWaitlist({ unitOfWork, clock, ids, notifier });
  // The joined-sessions list is a plain read of the caller's own places; no unit of work.
  const sql: SqlExecutor = {
    query: async (statement, values) => (await getPool().query(statement, values ? [...values] : undefined)).rows,
  };
  return {
    authenticate: createSupabaseIdentityAuthenticator(
      settings.supabaseUrl,
      settings.supabaseAnonKey,
    ),
    commitToSession: new CommitToSession({ unitOfWork, clock, ids }),
    withdrawFromSession: new WithdrawFromSession({ unitOfWork, clock, promote, notifier }),
    acceptReplacement: new AcceptReplacement({ unitOfWork, clock, ids }),
    leaveWaitlist: new LeaveWaitlist({ unitOfWork, clock, promote }),
    verifyAttendance: new VerifyAttendance({ unitOfWork, clock }),
    listJoinedSessions: new ListJoinedSessions({ reader: new PostgresJoinedSessionsReader(sql), clock }),
  };
}
