import { InfoNote } from "@/components/ui/info-note";
import { AuthFrame, AuthHeading } from "../_components/auth-frame";
import { LoginForm } from "./login-form";

interface LoginPageProps {
  /** e.g. /login?next=/profile after being sent here from a locked page (Step 20). */
  readonly searchParams: Promise<{ next?: string | string[]; deleted?: string | string[]; verification?: string | string[] }>;
}

/** UC1-02 Authenticate User (mockup 03). */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next, deleted, verification } = await searchParams;

  return (
    <AuthFrame
      prompt="New to Booking?"
      switchLabel="Create account"
      switchHref="/register"
    >
      <AuthHeading
        title="Log in"
        description="Welcome back. Your next game awaits."
      />
      {deleted === "1" && (
        <InfoNote icon className="mb-5">
          <span role="status">Your account has been deleted.</span>
        </InfoNote>
      )}
      {verification === "failed" && (
        <InfoNote icon className="mb-5">
          <span role="status">
            We couldn't finish signing you in from that email link. It may have expired or been opened
            in a different browser. Try logging in below; if your email still needs confirmation,
            you can request a new link.
          </span>
        </InfoNote>
      )}
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </AuthFrame>
  );
}
