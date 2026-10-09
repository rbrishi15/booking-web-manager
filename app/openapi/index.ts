import { registerCommitmentApi } from "@/app/commit/openapi";
import { registerWithdrawalPreviewApi } from "@/app/commit/withdrawal-preview-openapi";
import { registerDiscoveryApi } from "@/app/discover/openapi";
import { registerSessionApi } from "@/app/sessions/openapi";
import { registerSessionManagementApi } from "@/app/sessions/management-openapi";
import { registerSessionCancellationApi } from "@/app/sessions/cancellation-openapi";
import { registerParticipantRemovalApi } from "@/app/sessions/removal-openapi";
import { registerVenueApi } from "@/app/venues/openapi";
import { registerWalletApi } from "@/app/wallet/openapi";
import { createOpenApiDocument } from "./document";

/** Add feature documentation here; the public route and Swagger UI stay generic. */
export const openApiDocument = createOpenApiDocument([
  registerSessionApi,
  registerDiscoveryApi,
  registerCommitmentApi,
  registerWithdrawalPreviewApi,
  registerSessionManagementApi,
  registerSessionCancellationApi,
  registerParticipantRemovalApi,
  registerVenueApi,
  registerWalletApi,
]);
