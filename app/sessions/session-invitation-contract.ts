import type { SessionInvitationGroup, SessionInviteSummary } from "@/use-cases/sessions/ManageSessionInvitations";
import { z } from "zod";
import { userHandleSchema } from "@/app/users/schemas";

export const sessionInvitationsParamsSchema = z.object({ sessionId: z.string().uuid() });
export const sendSessionInvitationsSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("direct"), handles: z.array(z.string().max(64).pipe(userHandleSchema)).min(1).max(50) }).strict(),
  z.object({ source: z.literal("group"), groupId: z.string().uuid(), userIds: z.array(z.string().uuid()).min(1).max(50) }).strict(),
]);
export type SendSessionInvitationsRequest = z.infer<typeof sendSessionInvitationsSchema>;

export const sessionInviteSummarySchema = z.object({
  invited: z.number().int().nonnegative(), alreadyInvited: z.number().int().nonnegative(), alreadyParticipating: z.number().int().nonnegative(),
});
export const sessionInvitationOptionsSchema = z.object({
  groups: z.array(z.object({
    groupId: z.string().uuid(), name: z.string(), memberCount: z.number().int().nonnegative(),
    members: z.array(z.object({ userId: z.string().uuid(), handle: z.string().nullable(), displayName: z.string() })),
  })),
  invitations: z.array(z.object({
    inviteeId: z.string().uuid(), displayName: z.string(), handle: z.string().nullable(),
    status: z.enum(["PENDING", "ACCEPTED", "DECLINED"]), invitedAt: z.string().datetime(),
  })),
});

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
