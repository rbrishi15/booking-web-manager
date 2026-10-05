import type { SessionRemovalDependencies } from "@/app/sessions/removal-dependencies";
import { SessionRemovalUnavailableError } from "@/app/sessions/removal-unavailable";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";
import { ParticipantRemovalVersioner } from "@/lib/sessions/removal-versioner";
import { PostgresSessionRemovalReadTransaction } from "@/lib/sessions/postgres-session-removal-read-transaction";
import { PostgresSessionRemovalTransaction } from "@/lib/sessions/postgres-session-removal-transaction";
import { ListSessionParticipants } from "@/use-cases/sessions/ListSessionParticipants";
import { PreviewParticipantRemoval } from "@/use-cases/sessions/PreviewParticipantRemoval";
import { RemoveParticipant } from "@/use-cases/sessions/RemoveParticipant";

/** Assembles shared read capabilities and a submission-scoped removal coordinator. */
export function createSessionRemovalDependencies(): SessionRemovalDependencies {
  const settings = readSessionServerSettings();
  if (!settings) {
    const unavailable = async (): Promise<never> => { throw new SessionRemovalUnavailableError(); };
    return { authenticate: unavailable, listParticipants: { forBooker: unavailable },
      previewRemoval: { forBooker: unavailable }, createRemoval: () => ({ forBooker: unavailable }) };
  }
  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  const clock = { now: () => new Date() };
  const versioner = new ParticipantRemovalVersioner();
  const transaction = new PostgresSessionRemovalReadTransaction(getPool, clock);
  return {
    authenticate: createSupabaseIdentityAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    listParticipants: new ListSessionParticipants({ transaction, clock }),
    previewRemoval: new PreviewParticipantRemoval({ transaction, clock, versioner }),
    createRemoval: ({ idempotencyKey }) => new RemoveParticipant({
      transaction: new PostgresSessionRemovalTransaction(getPool, clock, idempotencyKey), clock, versioner,
    }),
  };
}
