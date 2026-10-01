import { AppShell } from "@/components/ui/app-shell";

// Placeholder user until log-in is built on Day 2.
const PLACEHOLDER_USER = { name: "Marcus Lim", reliabilityScore: 96 };

/** Wraps profile routes in the app shell using a placeholder user until login is available. */
export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <AppShell user={PLACEHOLDER_USER}>{children}</AppShell>;
}