import type { UUID } from "@/domain";
import type { ListSessionParticipants } from "@/use-cases/sessions/ListSessionParticipants";
import type { PreviewParticipantRemoval } from "@/use-cases/sessions/PreviewParticipantRemoval";
import type { RemoveParticipant } from "@/use-cases/sessions/RemoveParticipant";

export interface SessionRemovalDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly listParticipants: Pick<ListSessionParticipants, "forBooker">;
  readonly previewRemoval: Pick<PreviewParticipantRemoval, "forBooker">;
  readonly createRemoval: (submission: { readonly idempotencyKey: string }) => Pick<RemoveParticipant, "forBooker">;
}
