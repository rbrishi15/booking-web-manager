"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createSession, searchVenues } from "./transport";

// Pending submissions live in this browser tab. Mount the form only when it can
// initialize from that storage, rather than rendering an empty draft then repairing it.
const CreateSessionWizard = dynamic(() => import("./create-session-wizard").then((module) => module.CreateSessionWizard), {
  ssr: false,
  loading: () => <p role="status" className="p-6 text-center">Loading session form…</p>,
});

export function CreateSessionController({ userId }: { readonly userId: string }) {
  const router = useRouter();
  return <CreateSessionWizard userId={userId} create={(payload) => createSession(payload, userId)} search={searchVenues} onCreated={() => {
    router.replace("/sessions?created=1"); router.refresh();
  }} />;
}
