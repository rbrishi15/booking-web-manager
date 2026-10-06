import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { z } from "zod";
import data from "./data/singapore-regions.json";
import type { VenueCandidate } from "./contracts";

const regions = z.object({ features: z.array(z.object({
  properties: z.object({ REGION_N: z.string() }),
  geometry: z.object({ type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))),
  }),
})) }).parse(data).features;
const regionNames: Readonly<Record<string, VenueCandidate["region"]>> = {
  "CENTRAL REGION": "Central", "EAST REGION": "East", "NORTH REGION": "North",
  "NORTH-EAST REGION": "North-East", "WEST REGION": "West",
};

/** Unknown or shared-boundary coordinates require an explicit manual region choice. */
export function regionForCoordinates(latitude: number, longitude: number): VenueCandidate["region"] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const matches = regions.filter(({ geometry }) => booleanPointInPolygon([longitude, latitude], geometry));
  return matches.length === 1 ? regionNames[matches[0]!.properties.REGION_N] ?? null : null;
}
