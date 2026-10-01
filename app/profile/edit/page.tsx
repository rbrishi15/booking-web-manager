import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { EditProfileForm } from "./edit-profile-form";

/** UC1-03 Manage Profile: change name, preferred sports and preferred regions. */
export default async function EditProfilePage() {
  const user = await getCurrentUser();
  if (user === null) redirect("/login");

  return (
    <>
      <PageHeader breadcrumb="Settings" title="Edit profile" />
      <div className="space-y-4 p-4 md:p-8">
        <Link href="/profile" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          ← Back to settings
        </Link>
        <div className="max-w-2xl rounded-lg border bg-card p-6">
          <EditProfileForm
            initial={{
              displayName: user.profileName,
              preferredSports: user.preferredSports,
              preferredRegions: user.preferredRegions,
            }}
          />
        </div>
      </div>
    </>
  );
}