import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { PageHeader } from "@/components/ui/page-header";
import { createManageGroup } from "@/lib/supabase/group-store";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { JoinGroupButton } from "../../_components/group-controls";
import { groupErrorMessage } from "../../messages";

interface JoinPageProps {
  readonly params: Promise<{ token: string }>;
}

/** UC1-06: the page an invitation link opens. Logged-out visitors log in first, then return here. */
export default async function JoinGroupPage({ params }: JoinPageProps) {
  const { token } = await params;
  const user = await getCurrentUser();
  if (user === null) redirect(`/login?next=/groups/join/${encodeURIComponent(token)}`);

  let group;
  try {
    group = await createManageGroup().previewInvitation(token);
  } catch (error) {
    return (
      <>
        <PageHeader breadcrumb="Groups" title="Join a group" />
        <div className="max-w-xl space-y-4 p-4 md:p-8">
          <ErrorMessage>{groupErrorMessage(error)}</ErrorMessage>
          <Button asChild variant="outline">
            <Link href="/groups">Go to my groups</Link>
          </Button>
        </div>
      </>
    );
  }

  const alreadyMember = group.memberships.some((member) => member.userId === user.id);

  return (
    <>
      <PageHeader breadcrumb="Groups" title="Join a group" />
      <div className="p-4 md:p-8">
        <div className="max-w-xl space-y-4 rounded-lg border bg-card p-6">
          <div>
            <p className="text-sm text-muted-foreground">You have been invited to</p>
            <h2 className="text-2xl font-semibold">{group.name}</h2>
            <p className="text-sm text-muted-foreground">
              {group.memberships.length} {group.memberships.length === 1 ? "member" : "members"}
            </p>
          </div>
          {alreadyMember ? (
            <div className="space-y-3">
              <p className="text-sm">You&apos;re already a member of this group.</p>
              <Button asChild>
                <Link href={`/groups/${group.groupId}`}>Open group</Link>
              </Button>
            </div>
          ) : (
            <JoinGroupButton token={token} groupName={group.name} />
          )}
        </div>
      </div>
    </>
  );
}