import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export default function ProfilePage() {
  return (
    <>
      <PageHeader breadcrumb="Account" title="Settings" actions={<Button variant="outline">View public profile</Button>} />
      <div className="p-4 md:p-8">
        <p className="text-muted-foreground">Settings will appear here (UC1-03).</p>
      </div>
    </>
  );
}