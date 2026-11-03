import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresSessionInvitationTransaction } from "@/lib/sessions/postgres-session-invitation-transaction";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";
import { createNotificationPublisher } from "./notification-publisher";
import { ManageSessionInvitations } from "@/use-cases/sessions/ManageSessionInvitations";

/** Composition root: the use case knows only its transaction and clock ports. */
export function createManageSessionInvitations(): ManageSessionInvitations {
  const settings = readSessionServerSettings();
  if (!settings) throw new SessionManagementUnavailableError();
  const clock = { now: () => new Date() };
  const transaction = new PostgresSessionInvitationTransaction(
    createPostgresPoolProvider(settings.databaseUrl), clock, createNotificationPublisher(),
  );
  return new ManageSessionInvitations({ transaction, clock });
}
