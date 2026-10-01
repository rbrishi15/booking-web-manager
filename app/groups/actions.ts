"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createManageGroup } from "@/use-case-config/groups";
import { createClient } from "@/lib/supabase/server";
import { groupErrorMessage } from "./messages";
import { groupNameSchema } from "./schemas";

export interface GroupFormState {
  readonly status: "idle" | "error" | "saved";
  readonly message?: string;
}

/** What the buttons get back: nothing when it worked, or a message to show. */
export interface GroupActionResult {
  readonly error?: string;
}

/** The logged-in user's id, or null. Every action checks this on the server. */
async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Refreshes the group list and this group's page after a change. */
function refresh(groupId: string): void {
  revalidatePath("/groups");
  revalidatePath(`/groups/${groupId}`);
}

/** UC1-06: create a group. The creator becomes its owner and first member. */
export async function createGroup(_previous: GroupFormState, formData: FormData): Promise<GroupFormState> {
  const name = groupNameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success) return { status: "error", message: name.error.issues[0]?.message };

  const userId = await currentUserId();
  if (userId === null) return { status: "error", message: "Please log in again." };

  let groupId: string;
  try {
    const group = await createManageGroup().create({ ownerId: userId, name: name.data });
    groupId = group.groupId;
  } catch (error) {
    console.error("UC1-06 create group failed:", error);
    return { status: "error", message: groupErrorMessage(error) };
  }
  revalidatePath("/groups");
  redirect(`/groups/${groupId}`);
}

/** UC1-06: owner renames the group. */
export async function renameGroup(
  groupId: string,
  _previous: GroupFormState,
  formData: FormData,
): Promise<GroupFormState> {
  const name = groupNameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success) return { status: "error", message: name.error.issues[0]?.message };

  const userId = await currentUserId();
  if (userId === null) return { status: "error", message: "Please log in again." };

  try {
    await createManageGroup().rename({ actorId: userId, groupId, name: name.data });
  } catch (error) {
    return { status: "error", message: groupErrorMessage(error) };
  }
  refresh(groupId);
  return { status: "saved", message: "Group name saved." };
}

/** Runs one owner action and turns a refusal into a message. */
async function ownerAction(
  groupId: string,
  run: (userId: string) => Promise<unknown>,
): Promise<GroupActionResult> {
  const userId = await currentUserId();
  if (userId === null) return { error: "Please log in again." };
  try {
    await run(userId);
  } catch (error) {
    return { error: groupErrorMessage(error) };
  }
  refresh(groupId);
  return {};
}

/** UC1-06: owner removes a member. */
export async function removeMember(groupId: string, memberId: string): Promise<GroupActionResult> {
  return ownerAction(groupId, (userId) =>
    createManageGroup().removeMember({ actorId: userId, groupId, userId: memberId }),
  );
}

/** UC1-06: owner issues a new invitation link (the old one stops working). */
export async function rotateInvitation(groupId: string): Promise<GroupActionResult> {
  return ownerAction(groupId, (userId) => createManageGroup().rotateInvitation({ actorId: userId, groupId }));
}

/** UC1-06: owner turns the invitation link off. */
export async function revokeInvitation(groupId: string): Promise<GroupActionResult> {
  return ownerAction(groupId, (userId) => createManageGroup().revokeInvitation({ actorId: userId, groupId }));
}

/** UC1-06: owner archives the group (read-only afterwards). */
export async function archiveGroup(groupId: string): Promise<GroupActionResult> {
  return ownerAction(groupId, (userId) => createManageGroup().archive({ actorId: userId, groupId }));
}

/** UC1-06: join through an invitation link, then open the group. */
export async function joinGroup(invitationToken: string): Promise<GroupActionResult> {
  const userId = await currentUserId();
  if (userId === null) return { error: "Please log in again." };

  let groupId: string;
  try {
    const { group } = await createManageGroup().join({ userId, invitationToken });
    groupId = group.groupId;
  } catch (error) {
    return { error: groupErrorMessage(error) };
  }
  refresh(groupId);
  redirect(`/groups/${groupId}`);
}