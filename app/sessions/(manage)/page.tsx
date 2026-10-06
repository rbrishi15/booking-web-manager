import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { HostedSessionsController } from "../_components/hosted-sessions-controller";
import { loadHostedSessionsScreen } from "../load-screen";

export const dynamic = "force-dynamic";

/** Loads the current user's hosted sessions, redirecting anonymous visitors to login with a return path. */
export default async function SessionsPage() {
  const user = await getCurrentUser();
  if (user === null) redirect("/login?next=%2Fsessions");
  return <HostedSessionsController userId={user.id} outcome={await loadHostedSessionsScreen(user.id)} />;
}
