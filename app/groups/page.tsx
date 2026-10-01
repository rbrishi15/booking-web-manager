import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { createManageGroup } from "@/use-case-config/groups";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { CreateGroupForm } from "./_components/group-controls";

/** UC1-06 Manage Group: the groups you belong to, and a form to create one. */
export default async function GroupsPage() {
  const user = await getCurrentUser();
  if (user === null) redirect("/login");

    const groups = await createManageGroup().listMine({ actorId: user.id });
  return (
    <>
      <PageHeader breadcrumb="Groups" title="My groups" />
      <div className="grid grid-cols-1 gap-8 p-4 md:p-8 lg:grid-cols-[1fr_22rem]">
        <section className="min-w-0 space-y-3" aria-labelledby="my-groups">
          <h2 id="my-groups" className="text-xl font-semibold">
            Regular groups
          </h2>
          {groups.length === 0 ? (
            <EmptyState
              title="No groups yet"
              description="Create a group for the people you play with, then share its invitation link."
            />
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {groups.map((group) => (
                <li key={group.groupId}>
                  <Link
                    href={`/groups/${group.groupId}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{group.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {group.memberships.length} {group.memberships.length === 1 ? "member" : "members"}
                      </span>
                    </span>
                    {group.ownerId === user.id && <StatusBadge tone="info">Owner</StatusBadge>}
                    {group.status === "ARCHIVED" && <StatusBadge tone="neutral">Archived</StatusBadge>}
                    <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="h-fit space-y-3 rounded-lg border bg-card p-6" aria-labelledby="create-group">
          <h2 id="create-group" className="text-xl font-semibold">
            Create a group
          </h2>
          <p className="text-sm text-muted-foreground">
            You become the owner. Invite players with the group&apos;s link, then invite the whole group to a session.
          </p>
          <CreateGroupForm />
        </section>
      </div>
    </>
  );
}