import { AuthFrame, AuthHeading, AuthPanel } from "../_components/auth-frame";
import { RegisterForm } from "./register-form";

const STEPS = [
  { title: "Join a session", text: "See the exact per-player share before committing." },
  { title: "Funds are held", text: "Nothing transfers to the booker yet." },
  { title: "Play and settle", text: "Verified attendance releases the held amount." },
] as const;

/** UC1-01 Register User (mockup 02). */
export default function RegisterPage() {
  return (
    <AuthFrame
      prompt="Already registered?"
      switchLabel="Log in"
      switchHref="/login"
      panel={
        <AuthPanel
          eyebrow="A simpler way to split the court"
          title="Commit once. Play with confidence."
          description="Your share stays in your in-app wallet until attendance is confirmed."
          footer={
            <ol className="space-y-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-card text-sm">
                    {index + 1}
                  </span>
                  <div>
                    <p className="font-medium">{step.title}</p>
                    <p className="text-sm text-muted-foreground">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          }
        />
      }
    >
      <AuthHeading
        eyebrow="Create your profile"
        title="Register"
        description="Set your location and preferred sport to find relevant sessions."
      />
      <RegisterForm />
    </AuthFrame>
  );
}