import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

/** Renders the groups placeholder and its create-group button. */
export default function GroupsPage() {
  return (
    <>
      <PageHeader breadcrumb="Groups" title="My groups" actions={<Button>+ Create group</Button>} />
      <div className="p-4 md:p-8">
        <p className="text-muted-foreground">Groups will appear here (UC1-06).</p>
      </div>
    </>
  );
}