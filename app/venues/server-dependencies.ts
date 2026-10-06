import { createVenueDependencies } from "@/use-case-config/venues";
import type { VenueApiDependencies } from "./dependencies";

let pending: Promise<VenueApiDependencies> | undefined;
export function getVenueDependencies(): Promise<VenueApiDependencies> {
  if (!pending) pending = Promise.resolve().then(createVenueDependencies).catch((cause) => { pending = undefined; throw cause; });
  return pending;
}
