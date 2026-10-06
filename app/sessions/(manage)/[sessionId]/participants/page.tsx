import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { SessionParticipantsController } from "@/app/sessions/_components/session-participants-controller";
import { listSessionParticipants } from "@/app/sessions/removal-actions";

export const dynamic = "force-dynamic";

/** The authenticated list action checks active ownership before returning participant names. */
export default async function SessionParticipantsPage({ params }: { readonly params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const user = await getCurrentUser();
  if (user === null) redirect(`/login?next=${encodeURIComponent(`/sessions/${sessionId}/participants`)}`);
  return <SessionParticipantsController sessionId={sessionId} userId={user.id} outcome={await listSessionParticipants(sessionId)} />;
}
