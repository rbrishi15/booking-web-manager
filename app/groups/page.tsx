import { redirect } from "next/navigation";
import { createManageGroup } from "@/use-case-config/groups";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { displayNames } from "@/lib/supabase/profile-names";
import { CreateGroupForm } from "./_components/group-controls";
import { GroupsView, type GroupSummary } from "./_components/groups-view";

interface GroupsPageProps {
  /** e.g. /groups?left=1 after leaving a group. */
  readonly searchParams: Promise<{ left?: string | string[] }>;
}

/** UC1-06: the signed-in member's groups, with display-only data for the directory. */
export default async function GroupsPage({ searchParams }: GroupsPageProps) {
  const user = await getCurrentUser();
  if (user === null) redirect("/login");
  const { left } = await searchParams;
  const groups = await createManageGroup().listMine({ actorId: user.id });
  const visibleMemberIds = [...new Set(groups.flatMap((group) => group.memberships.slice(0, 4).map((member) => member.userId)))];
  const names = visibleMemberIds.length > 0 ? await displayNames(visibleMemberIds) : new Map<string, string>();
  const summaries: GroupSummary[] = groups.map((group) => ({
    groupId: group.groupId,
    name: group.name,
    memberCount: group.memberships.length,
    memberNames: group.memberships.slice(0, 4).map((member) => names.get(member.userId) ?? "Unnamed player"),
    joinedAt: group.memberships.find((member) => member.userId === user.id)?.joinedAt.toISOString() ?? null,
    isOwner: group.ownerId === user.id,
    archived: group.status === "ARCHIVED",
    invitationActive: group.invitationActive,
  }));

  return <GroupsView groups={summaries} left={left === "1"} createForm={<CreateGroupForm />} />;
}
