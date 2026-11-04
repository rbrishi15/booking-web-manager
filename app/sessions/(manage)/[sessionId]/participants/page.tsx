import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { SessionParticipantsController } from "@/app/sessions/_components/session-participants-controller";
import { listSessionParticipants } from "@/app/sessions/removal-actions";
import { QueryProvider } from "@/app/_components/query-provider";

export const dynamic = "force-dynamic";

/** The authenticated list action checks active ownership before returning participant names. */
export default async function SessionParticipantsPage({ params }: { readonly params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const user = await getCurrentUser();
  if (user === null) redirect(`/login?next=${encodeURIComponent(`/sessions/${sessionId}/participants`)}`);
  const outcome = await listSessionParticipants(sessionId);
  return <QueryProvider key={user.id}><SessionParticipantsController sessionId={sessionId} userId={user.id} outcome={outcome} /></QueryProvider>;
}
