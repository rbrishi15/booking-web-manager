import type { VenueApiDependencies } from "@/app/venues/dependencies";
import { readVenueSettings } from "@/app/venues/server-environment";
import { createSupabaseSessionAuthenticator } from "@/lib/supabase/bearer-auth";
import { OneMapVenueSearch } from "@/lib/venues/onemap";
import { VenueSearchUnavailableError } from "@/lib/venues/contracts";

export function createVenueDependencies(): VenueApiDependencies {
  const settings = readVenueSettings();
  const unavailable = async (): Promise<never> => { throw new VenueSearchUnavailableError(); };
  if (!settings) return { authenticate: unavailable, search: unavailable };
  const authentication = settings.credentials ?? (settings.accessToken ? { accessToken: settings.accessToken } : undefined);
  const provider = authentication ? new OneMapVenueSearch(authentication) : undefined;
  return { authenticate: createSupabaseSessionAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    search: provider ? (query, page) => provider.search(query, page) : unavailable };
}
