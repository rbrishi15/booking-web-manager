import { AppShell } from "@/components/ui/app-shell";

// Placeholder user until log-in is built on Day 2.
const PLACEHOLDER_USER = { name: "Marcus Lim", reliabilityScore: 96 };

export default function GroupsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell user={PLACEHOLDER_USER}>{children}</AppShell>;
}