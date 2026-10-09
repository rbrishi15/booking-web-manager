import type { UUID } from "@/domain";
import type { ListHostedSessions } from "@/use-cases/sessions/ListHostedSessions";
import type { ToggleSessionVisibility } from "@/use-cases/sessions/ToggleSessionVisibility";

/** Authentication establishes identity; each use case checks current account access. */
export interface SessionManagementDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly toggleVisibility: Pick<ToggleSessionVisibility, "forBooker">;
  readonly listHostedSessions: Pick<ListHostedSessions, "forBooker" | "attendanceDueForBooker">;
}
