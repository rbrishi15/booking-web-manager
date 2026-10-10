import { redirect } from "next/navigation";
import { QueryProvider } from "@/app/_components/query-provider";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { HostedSessionsController } from "../_components/hosted-sessions-controller";
import { getSessionAccountActions } from "../session-actions";

export const dynamic = "force-dynamic";

/** The signed-in booker's sessions. Session data loads in the browser through GET /api/sessions/hosted. */
export default async function SessionsPage() {
  const user = await getCurrentUser();
  if (user === null) redirect("/login?next=%2Fsessions");
  return <QueryProvider><HostedSessionsController userId={user.id} actions={getSessionAccountActions(user)} /></QueryProvider>;
}
