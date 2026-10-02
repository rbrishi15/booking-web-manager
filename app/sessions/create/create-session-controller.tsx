"use client";

import { useRouter } from "next/navigation";
import { CreateSessionWizard } from "./create-session-wizard";
import { createSession, searchVenues } from "./transport";

export function CreateSessionController({ userId }: { readonly userId: string }) {
  const router = useRouter();
  return <CreateSessionWizard userId={userId} create={createSession} search={searchVenues} onCreated={() => {
    router.replace("/sessions?created=1"); router.refresh();
  }} />;
}
