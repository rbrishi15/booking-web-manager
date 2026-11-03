"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DomainError } from "@/domain";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createManageSessionInvitations } from "@/use-case-config/session-invitations";
import type { SendSessionInvitationsResult, SessionInvitationOptions } from "./session-invitation-contract";

const uuid = z.string().uuid();
const userIds = z.array(z.string().min(1).max(33)).min(1).max(50);
const memberIds = z.array(uuid).min(1).max(50);

function invitationError(error: unknown): SendSessionInvitationsResult {
  if (error instanceof DomainError) return { status: "error", message: error.message };
  console.error("Session invitation failed:", error);
  return { status: "error", message: "Could not send session invitations. Try again." };
}

export async function sendDirectSessionInvitations(sessionId: string, handles: readonly string[]): Promise<SendSessionInvitationsResult> {
  const parsedSession = uuid.safeParse(sessionId);
  const parsedPlayers = userIds.safeParse(handles);
  if (!parsedSession.success || !parsedPlayers.success) return { status: "error", message: "Select 1 to 50 valid players." };
  try {
    const user = await getCurrentUser();
    if (!user) return { status: "error", message: "Log in again to invite players." };
    const outcome = await createManageSessionInvitations().inviteByHandles(user.id, parsedSession.data, parsedPlayers.data);
    revalidatePath(`/sessions/${parsedSession.data}/participants`);
    return { status: "sent", ...outcome };
  } catch (error) { return invitationError(error); }
}

export async function sendGroupSessionInvitations(
  sessionId: string, groupId: string, selectedUserIds: readonly string[],
): Promise<SendSessionInvitationsResult> {
  const parsedSession = uuid.safeParse(sessionId);
  const parsedGroup = uuid.safeParse(groupId);
  const parsedMembers = memberIds.safeParse(selectedUserIds);
  if (!parsedSession.success || !parsedGroup.success || !parsedMembers.success)
    return { status: "error", message: "Select 1 to 50 valid group members." };
  try {
    const user = await getCurrentUser();
    if (!user) return { status: "error", message: "Log in again to invite members." };
    const outcome = await createManageSessionInvitations().inviteFromGroup(
      user.id, parsedSession.data, parsedGroup.data, parsedMembers.data,
    );
    revalidatePath(`/sessions/${parsedSession.data}/participants`);
    return { status: "sent", ...outcome };
  } catch (error) { return invitationError(error); }
}

export async function loadSessionInvitationOptions(sessionId: string): Promise<SessionInvitationOptions> {
  const parsedSession = uuid.safeParse(sessionId);
  if (!parsedSession.success) return { status: "error", message: "Invalid session." };
  try {
    const user = await getCurrentUser();
    if (!user) return { status: "error", message: "Log in again to manage invitations." };
    const options = await createManageSessionInvitations().optionsForBooker(user.id, parsedSession.data);
    return { status: "ready", groups: options.groups,
      invitations: options.invitations.map((invitation) => ({ ...invitation, invitedAt: invitation.invitedAt.toISOString() })) };
  } catch (error) {
    if (error instanceof DomainError) return { status: "error", message: error.message };
    console.error("Session invitation options failed:", error);
    return { status: "error", message: "Could not load invitations and groups. Try again." };
  }
}
