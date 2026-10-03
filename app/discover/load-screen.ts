import type { DiscoveryOutcome } from "./_components/discovery-state";
import { toDiscoveryPage } from "./contracts";
import { DiscoveryApiUnavailableError } from "./discovery-api-unavailable";
import { parseDiscoveryQuery } from "./query";
import { getDiscoveryDependencies } from "./server-dependencies";

export type PageSearchParams = Record<string, string | string[] | undefined>;

/** Public listing queries do not depend on viewer identity. */
export async function loadDiscoveryScreen(searchParams: PageSearchParams) {
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
      const sessions = await discoverSessions.searchPublic(parsed.criteria);
      outcome = { status: "ready", page: toDiscoveryPage(sessions, parsed.after) };
    } catch (error) {
      outcome = { status: "error", kind: error instanceof DiscoveryApiUnavailableError ? "unavailable" : "unexpected" };
    }
  }
  return { queryKey: parsed.queryKey, filters: parsed.filters, outcome };
}
