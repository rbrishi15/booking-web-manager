import type { UUID } from "@/domain";
import type { PreviewWithdrawal } from "@/use-cases/sessions/WithdrawalPreview";

/** App-owned capabilities for the UC2-05 withdrawal preview route. */
export interface WithdrawalPreviewDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly previewWithdrawal: Pick<PreviewWithdrawal, "forParticipant">;
}
