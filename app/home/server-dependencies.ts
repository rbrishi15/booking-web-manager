import { createHomeDependencies } from "@/use-case-config/home";
import type { HomeDependencies } from "./dependencies";

let initialization: Promise<HomeDependencies> | undefined;

/** Shares infrastructure, never a user's bookings or screen result. */
export async function getHomeDependencies(): Promise<HomeDependencies> {
  initialization ??= Promise.resolve().then(createHomeDependencies).catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}
