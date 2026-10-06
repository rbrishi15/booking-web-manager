import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { CreateSessionController } from "../../create/create-session-controller";

export const dynamic = "force-dynamic";

export default async function CreateSessionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fsessions%2Fcreate");
  return <CreateSessionController userId={user.id} />;
}
