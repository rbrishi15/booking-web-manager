import { redirect } from "next/navigation";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { DiscoveryController } from "./_components/discovery-controller";
import type { DiscoveryOutcome } from "./_components/discovery-state";
import { toDiscoveryPage } from "./contracts";
import { DiscoveryApiUnavailableError } from "./discovery-api-unavailable";
import { parseDiscoveryQuery } from "./query";
import { getDiscoveryDependencies } from "./server-dependencies";

export const dynamic = "force-dynamic";

/** Cookie identity is verified afresh before the server-only discovery capability is invoked. */
export default async function DiscoveryPage({ searchParams }: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user === null) redirect("/login?next=%2Fdiscover");
  const account = await getAccountStatus(await createClient(), user.id);
  if (account.kind === "inactive" || account.kind === "missing-profile") redirect("/login");

  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(name, item));
    else if (value !== undefined) params.append(name, value);
  }
  const parsed = parseDiscoveryQuery(params);
  let outcome: DiscoveryOutcome;
  if (account.kind === "lookup-failed") {
    outcome = { status: "error", kind: "unexpected" };
  } else if (parsed.status === "invalid") {
    outcome = { status: "invalid", fieldErrors: parsed.fieldErrors };
  } else {
    try {
      const { discoverSessions } = await getDiscoveryDependencies();
      outcome = { status: "ready", page: toDiscoveryPage(await discoverSessions.search(parsed.input)) };
    } catch (error) {
      outcome = {
        status: "error",
        kind: error instanceof DiscoveryApiUnavailableError ? "unavailable" : "unexpected",
      };
    }
  }

  return <DiscoveryController key={parsed.queryKey} queryKey={parsed.queryKey} filters={parsed.filters} outcome={outcome} />;
}
