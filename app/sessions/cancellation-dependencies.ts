import type { UUID } from "@/domain";
import type { CancelSession } from "@/use-cases/sessions/CancelSession";
import type { PreviewSessionCancellation } from "@/use-cases/sessions/PreviewSessionCancellation";

export interface SessionCancellationDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly previewCancellation: Pick<PreviewSessionCancellation, "forBooker">;
  readonly createCancellation: (submission: { readonly idempotencyKey: string }) => Pick<CancelSession, "forBooker">;
}
