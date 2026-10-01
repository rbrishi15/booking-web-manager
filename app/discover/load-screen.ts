import { redirect } from "next/navigation";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { createClient } from "@/lib/supabase/server";
import type { DiscoveryOutcome } from "./_components/discovery-state";
import { toDiscoveryPage } from "./contracts";
import { DiscoveryApiUnavailableError } from "./discovery-api-unavailable";
import { parseDiscoveryQuery } from "./query";
import { getDiscoveryDependencies } from "./server-dependencies";

export type PageSearchParams = Record<string, string | string[] | undefined>;

/** An active account is required before acquiring session access for either screen. */
export async function loadDiscoveryScreen(userId: string, searchParams: PageSearchParams) {
  const account = await getAccountStatus(await createClient(), userId);
  if (account.kind === "inactive" || account.kind === "missing-profile") redirect("/login");
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (name === "returnTo") continue;
    if (Array.isArray(value)) value.forEach((item) => params.append(name, item));
    else if (value !== undefined) params.append(name, value);
  }
  const parsed = parseDiscoveryQuery(params);
  let outcome: DiscoveryOutcome;
  if (account.kind === "lookup-failed") outcome = { status: "error", kind: "unexpected" };
  else if (parsed.status === "invalid") outcome = { status: "invalid", fieldErrors: parsed.fieldErrors };
  else {
    try {
      const { discoverSessions } = await getDiscoveryDependencies();
      outcome = { status: "ready", page: toDiscoveryPage(await discoverSessions.search(parsed.input)) };
    } catch (error) {
      outcome = { status: "error", kind: error instanceof DiscoveryApiUnavailableError ? "unavailable" : "unexpected" };
    }
  }
  return { queryKey: parsed.queryKey, filters: parsed.filters, outcome };
}
