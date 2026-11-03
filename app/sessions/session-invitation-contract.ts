import type { SessionInvitationGroup, SessionInviteSummary } from "@/use-cases/sessions/ManageSessionInvitations";

export type ImportGroup = SessionInvitationGroup;

export type SendSessionInvitationsResult =
  | ({ readonly status: "sent" } & SessionInviteSummary)
  | { readonly status: "error"; readonly message: string };

export interface SessionInviteDisplay {
  readonly inviteeId: string;
  readonly displayName: string;
  readonly handle: string | null;
  readonly status: "PENDING" | "ACCEPTED" | "DECLINED";
  readonly invitedAt: string;
}

export type SessionInvitationOptions =
  | { readonly status: "ready"; readonly groups: readonly ImportGroup[]; readonly invitations: readonly SessionInviteDisplay[] }
  | { readonly status: "error"; readonly message: string };
