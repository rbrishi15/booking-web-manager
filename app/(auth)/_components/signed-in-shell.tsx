import { redirect } from "next/navigation";
import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { logOut } from "../logout-action";

/** AppShell filled in with the logged-in user and a working Log out. Use it in each signed-in area's layout.tsx. */
export async function SignedInShell({ children }: { readonly children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (user === null) redirect("/login"); // normally the middleware has already done this

  return (
    <AppShell
      user={{ name: user.displayName, reliabilityScore: user.reliabilityScore }}
      logoutAction={logOut}
    >
      {children}
    </AppShell>
  );
}