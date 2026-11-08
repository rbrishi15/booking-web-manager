import type { UUID } from "@/domain";
import type { EditSession } from "@/use-cases/sessions/EditSession";

export interface SessionEditingDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly editSession: Pick<EditSession, "detailsForBooker" | "forBooker">;
}
