import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DomainError } from "@/domain";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { displayNames } from "@/lib/supabase/profile-names";
import { createManageGroup } from "@/lib/supabase/group-store";
import { getCurrentUser } from "@/lib/supabase/current-user";
import {
  ArchiveGroupButton,
  InvitationControls,
  InvitationLink,
  RemoveMemberButton,
  RenameGroupForm,
} from "../_components/group-controls";

const joinedDate = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric" });

interface GroupPageProps {
  readonly params: Promise<{ groupId: string }>;
}

/** UC1-06 Manage Group: one group's members and invitation link. Owners also get the controls. */
export default async function GroupPage({ params }: GroupPageProps) {
  const { groupId } = await params;
  const user = await getCurrentUser();
  if (user === null) redirect("/login");

  let group;
  try {
    group = await createManageGroup().viewAsMember({ actorId: user.id, groupId });
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const names = await displayNames(group.memberships.map((member) => member.userId));
  const isOwner = group.ownerId === user.id;
  const active = group.status === "ACTIVE";

  // The full link someone opens to join, e.g. http://localhost:3000/groups/join/abc…
  const requestHeaders = await headers();
  const origin = `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host") ?? "localhost:3000"}`;
  const invitationUrl = `${origin}/groups/join/${group.invitationToken}`;

  return (
    <>
      <PageHeader breadcrumb="Groups" title={group.name} />
      <div className="space-y-4 p-4 md:p-8">
        <Link href="/groups" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          ← Back to groups
        </Link>
        {!active && <StatusBadge tone="neutral">Archived</StatusBadge>}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section className="min-w-0 space-y-3" aria-labelledby="members">
            <h2 id="members" className="text-xl font-semibold">
              Members ({group.memberships.length})
            </h2>
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {group.memberships.map((member) => {
                const name = names.get(member.userId) ?? "Unnamed player";
                const memberIsOwner = member.userId === group.ownerId;
                return (
                  <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {name}
                        {member.userId === user.id && " (you)"}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        Joined {joinedDate.format(member.joinedAt)}
                      </span>
                    </span>
                    {memberIsOwner && <StatusBadge tone="info">Owner</StatusBadge>}
                    {isOwner && active && !memberIsOwner && (
                      <RemoveMemberButton groupId={group.groupId} memberId={member.userId} memberName={name} />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="min-w-0 space-y-8">
            {active && (
              <section className="space-y-3 rounded-lg border bg-card p-6" aria-labelledby="invite">
                <h2 id="invite" className="text-xl font-semibold">
                  Invitation link
                </h2>
                {group.invitationActive ? (
                  <>
                    <p className="text-sm text-muted-foreground">Anyone with this link can join the group.</p>
                    <InvitationLink url={invitationUrl} />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">The invitation link is turned off.</p>
                )}
                {isOwner && <InvitationControls groupId={group.groupId} active={group.invitationActive} />}
              </section>
            )}

            {isOwner && active && (
              <section className="space-y-4 rounded-lg border bg-card p-6" aria-labelledby="settings">
                <h2 id="settings" className="text-xl font-semibold">
                  Group settings
                </h2>
                <RenameGroupForm groupId={group.groupId} name={group.name} />
                <ArchiveGroupButton groupId={group.groupId} />
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}