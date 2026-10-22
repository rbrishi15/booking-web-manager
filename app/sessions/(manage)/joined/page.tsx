import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { QueryProvider } from "@/app/_components/query-provider";
import { JoinedSessionsPage } from "@/app/commit/_components/joined-sessions-page";
import { getCurrentUser } from "@/lib/supabase/current-user";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Joined sessions | Booking Web Manager" };

/**
 * UC2-05: the signed-in player's places and replacement invitations. Data loads in the browser
 * through GET /api/sessions/joined and GET /api/sessions/replacements.
 */
export default async function JoinedSessionsRoute() {
  const user = await getCurrentUser();
  if (user === null) redirect("/login?next=%2Fsessions%2Fjoined");
  return <QueryProvider><JoinedSessionsPage userId={user.id} /></QueryProvider>;
}
