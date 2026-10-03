"use client";

import { useRouter } from "next/navigation";
import { CreateSessionWizard } from "./create-session-wizard";
import { createSession, searchVenues } from "./transport";
import type { SubmitSessionAction } from "../session-actions";

export function CreateSessionController({ userId, action }: { readonly userId: string; readonly action: SubmitSessionAction }) {
  const router = useRouter();
  return <CreateSessionWizard userId={userId} create={(payload) => createSession(payload, action)} search={searchVenues} onCreated={() => {
    router.replace("/sessions?created=1"); router.refresh();
  }} />;
}
