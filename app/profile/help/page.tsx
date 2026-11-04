import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { InfoSection } from "@/app/(auth)/_components/info-page";

export const metadata: Metadata = { title: "Help | Booking Web Manager" };

interface Question {
  readonly question: string;
  readonly answer: React.ReactNode;
}

const sessions: readonly Question[] = [
  {
    question: "How do I join a session?",
    answer: <>Find one in <Link href="/discover">Discover</Link> and choose Join. You see the share that will be held from your wallet before you confirm. If the session is full, you join the waitlist instead and nothing is held.</>,
  },
  {
    question: "What happens if I can't make it?",
    answer: <>Withdraw as early as you can. At least 30 hours before the start, your full share comes back to your wallet, and you can open your place to the waitlist or invite one person. With less than 30 hours left, you can only invite one person or forfeit your share. If you invite someone, your share stays held until they accept; if they do not accept before the start, it goes to the booker. If you forfeit, your share goes to the booker and your place closes. You always see what you'll get back before you confirm.</>,
  },
  {
    question: "How does the waitlist work?",
    answer: <>When a place opens, it goes to the person who joined the waitlist first, if they are still eligible and can pay their share. Nothing is held while you wait.</>,
  },
  {
    question: "Someone invited me to take their place. What now?",
    answer: <>The place is reserved for you until you accept it or the session starts. Accepting holds your share from your wallet, just like joining.</>,
  },
  {
    question: "When does the booker get paid?",
    answer: <>After attendance is confirmed. The booker confirms who came; if they don&apos;t, it is confirmed automatically 72 hours after the session ends. The booker then withdraws the money from <Link href="/payouts">Payouts</Link>. If a booker cancels a session or removes you, your share is refunded to your wallet.</>,
  },
  {
    question: "What is my reliability score?",
    answer: <>A score worked out from your past sessions. Some sessions only accept players above a minimum score.</>,
  },
];

const account: readonly Question[] = [
  {
    question: "How do I add money to my wallet?",
    answer: <>Open your <Link href="/wallet">wallet</Link> and choose Pay with PayNow. Enter between S$1.00 and S$1,000.00, then scan the QR code with your banking app. Your balance updates a few seconds after you pay.</>,
  },
  {
    question: "How do I turn notifications on or off?",
    answer: <>Use Push notifications in <Link href="/profile">Settings</Link>. It applies to this browser only.</>,
  },
  {
    question: "How do I add or confirm my email address?",
    answer: <>Go to <Link href="/profile/email">Email</Link>. Add one there if your account has none, or resend the confirmation link and check its status. Changing an address you have already added isn&apos;t available yet.</>,
  },
  {
    question: "How do I delete my account?",
    answer: <>Go to <Link href="/profile/delete">Delete account</Link>. It shows anything you need to finish first, such as active sessions or remaining funds.</>,
  },
];

/** Answers to common questions (UC1-03 Settings). Static: it shows nothing about the signed-in user. */
export default function HelpPage() {
  return (
    <>
      <PageHeader breadcrumb="Settings" title="Help and support" />
      <div className="space-y-6 p-4 md:p-8">
        <Link href="/profile" className="text-sm font-medium text-muted-foreground hover:text-foreground">← Back to settings</Link>
        <div className="max-w-3xl space-y-8">
          <Questions id="help-sessions" title="Sessions and payments" questions={sessions} />
          <Questions id="help-account" title="Your wallet and account" questions={account} />
          <InfoSection id="help-more" title="Still need help?">
            <p>
              Read the <Link href="/terms">Terms and conditions</Link> and the <Link href="/privacy">Privacy policy</Link> for
              the full rules. Booking. is an NTU SC2006 student project, so there is no live support line.
            </p>
          </InfoSection>
        </div>
      </div>
    </>
  );
}

function Questions({ id, title, questions }: { readonly id: string; readonly title: string; readonly questions: readonly Question[] }) {
  return (
    <InfoSection id={id} title={title}>
      <div className="divide-y overflow-hidden rounded-lg border bg-card text-foreground">
        {questions.map(({ question, answer }) => (
          <details key={question} className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              {question}
              <span aria-hidden className="shrink-0 text-muted-foreground transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="px-4 pb-4 text-muted-foreground">{answer}</p>
          </details>
        ))}
      </div>
    </InfoSection>
  );
}
