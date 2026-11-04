import { createSessionInvitationManagementDependencies } from "@/use-case-config/session-invitations";

let initialization: Promise<ReturnType<typeof createSessionInvitationManagementDependencies>> | undefined;

export function getSessionInvitationManagementDependencies() {
  initialization ??= Promise.resolve().then(createSessionInvitationManagementDependencies).catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}
