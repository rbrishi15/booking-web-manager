"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Dialog map: Logout() / clearSession → Landing. */
export async function logOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}