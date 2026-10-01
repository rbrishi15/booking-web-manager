import { InfoNote } from "@/components/ui/info-note";
import { StatusBadge } from "@/components/ui/status-badge";
import { AuthFrame, AuthHeading, AuthPanel } from "../_components/auth-frame";
import { LoginForm } from "./login-form";

interface LoginPageProps {
  /** e.g. /login?next=/profile after being sent here from a locked page (Step 20). */
  readonly searchParams: Promise<{ next?: string | string[]; deleted?: string | string[] }>;
}

/** UC1-02 Authenticate User (mockup 03). */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, deleted } = await searchParams;

  return (
    <AuthFrame
      prompt="New to Booking.?"
      switchLabel="Create account"
      switchHref="/register"
      panel={
        <AuthPanel
          eyebrow="Welcome back"
          title="Your next session is waiting."
          description="Review commitments, manage held funds, and settle completed games from one place."
          footer={
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-card p-5">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Upcoming</p>
                <p className="mt-1 font-semibold">Tennis at Bukit Timah CC</p>
                <p className="text-sm text-muted-foreground">17 Jun 2025 / 7:00 AM</p>
              </div>
              <StatusBadge tone="success">Confirmed</StatusBadge>
            </div>
          }
        />
      }
    >
      <AuthHeading
        eyebrow="Account access"
        title="Log in"
        description="Use the email address linked to your wallet."
      />
      {deleted === "1" && (
        <InfoNote icon className="mb-5">
          <span role="status">Your account has been deleted.</span>
        </InfoNote>
      )}
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </AuthFrame>
  );
}