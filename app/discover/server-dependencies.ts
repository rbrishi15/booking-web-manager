import { createDiscoveryDependencies } from "@/use-case-config/discovery";
import type { DiscoveryDependencies } from "./dependencies";

let initialization: Promise<DiscoveryDependencies> | undefined;

export async function getDiscoveryDependencies(): Promise<DiscoveryDependencies> {
  initialization ??= Promise.resolve()
    .then(() => createDiscoveryDependencies())
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}
