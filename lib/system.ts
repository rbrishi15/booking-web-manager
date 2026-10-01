import { randomUUID } from "node:crypto";
import type { Clock, IdGenerator } from "@/use-cases/shared/contracts";

export const systemClock: Clock = { now: () => new Date() };
export const uuidGenerator: IdGenerator = { next: randomUUID };
