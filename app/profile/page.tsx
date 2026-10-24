import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { PushNotificationsRow } from "@/app/commit/_components/push-notifications-row";
import { SettingsView } from "./_components/settings-view";
import { loadReliabilityScore } from "./reliability";

/** UC1-03 Manage Profile: supply authenticated data to the responsive Settings V4 view. */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (user === null) redirect("/login");
  const reliabilityScore = await loadReliabilityScore(user.id);

  return (
    <SettingsView
      user={{
        displayName: user.displayName,
        handle: user.handle ?? null,
        reliabilityScore,
        preferredSports: user.preferredSports,
        preferredRegions: user.preferredRegions,
      }}
      notifications={<PushNotificationsRow />}
    />
  );
}
