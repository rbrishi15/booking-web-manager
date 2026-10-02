import { redirect } from "next/navigation";
import { DomainError } from "@/domain";
import type { DiscoveryOutcome } from "./_components/discovery-state";
import { toDiscoveryPage } from "./contracts";
import { DiscoveryApiUnavailableError } from "./discovery-api-unavailable";
import { parseDiscoveryQuery } from "./query";
import { getDiscoveryDependencies } from "./server-dependencies";

export type PageSearchParams = Record<string, string | string[] | undefined>;

/** The use case authorizes the verified participant before reading listings. */
export async function loadDiscoveryScreen(userId: string, searchParams: PageSearchParams) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (name === "returnTo") continue;
    if (Array.isArray(value)) value.forEach((item) => params.append(name, item));
    else if (value !== undefined) params.append(name, value);
  }
  const parsed = parseDiscoveryQuery(params);
  let outcome: DiscoveryOutcome;
  if (parsed.status === "invalid") outcome = { status: "invalid", fieldErrors: parsed.fieldErrors };
  else {
    try {
      const { discoverSessions } = await getDiscoveryDependencies();
      const sessions = await discoverSessions.forParticipant(userId, parsed.criteria);
      outcome = { status: "ready", page: toDiscoveryPage(sessions, parsed.after) };
    } catch (error) {
      if (error instanceof DomainError && (error.code === "INACTIVE_ACCOUNT" || error.code === "NOT_FOUND"))
        redirect("/login");
      outcome = { status: "error", kind: error instanceof DiscoveryApiUnavailableError ? "unavailable" : "unexpected" };
    }
  }
  return { queryKey: parsed.queryKey, filters: parsed.filters, outcome };
}
