import type { Metadata } from "next";
import Link from "next/link";
import { InfoNote } from "@/components/ui/info-note";
import { InfoPage, InfoSection } from "../_components/info-page";

export const metadata: Metadata = { title: "Terms | Booking Web Manager" };

/** The terms players agree to when they register (UC1-01). Public, so they can be read first. */
export default function TermsPage() {
  return (
    <InfoPage title="Terms and conditions" intro="How Booking. works, and what you agree to when you use it.">
      <InfoNote icon>
        Booking. is an NTU SC2006 student project. Payments run in Stripe test mode, so no real money moves.
      </InfoNote>

      <InfoSection id="terms-service" title="What Booking. does">
        <p>
          Booking. helps a group share the cost of a sports venue. One person, the booker, books and pays for the
          venue elsewhere. Everyone who joins pays their share into the app, where it is held until the session has
          happened.
        </p>
        <p>Booking. does not reserve venues and does not take a commission.</p>
      </InfoSection>

      <InfoSection id="terms-account" title="Your account">
        <ul>
          <li>Keep your login details to yourself. You are responsible for what happens in your account.</li>
          <li>Use an email address you can access; you need one to create or join sessions.</li>
          <li>Sessions can set a minimum reliability score, which is calculated from your past sessions.</li>
        </ul>
      </InfoSection>

      <InfoSection id="terms-joining" title="Joining a session">
        <ul>
          <li>The booker sets the price of each place, within limits the app checks.</li>
          <li>When you join, your share is held from your wallet. You see the amount before you confirm.</li>
          <li>If the session is full, you join the waitlist instead. Nothing is held while you wait; places are offered in the order people joined.</li>
        </ul>
      </InfoSection>

      <InfoSection id="terms-withdrawing" title="Withdrawing">
        <ul>
          <li>At least 30 hours before the start: your full share comes back to your wallet. Open your place to the waitlist or invite one person.</li>
          <li>
            Less than 30 hours before the start: invite one person or forfeit your share. If you invite someone,
            your share stays held until they accept; if they do not accept before the session starts, it goes to the
            booker. If you forfeit, your share goes to the booker and your place closes. You cannot open it to the waitlist.
          </li>
          <li>Someone you invite takes your place only if they accept.</li>
        </ul>
      </InfoSection>

      <InfoSection id="terms-after" title="After the session">
        <p>
          The booker confirms who attended. If they don&apos;t, attendance is confirmed automatically 72 hours after the
          session ends. Held shares are then released to the booker.
        </p>
        <p>
          If the booker cancels a session or removes you from it, your held share is refunded to your wallet.
        </p>
      </InfoSection>

      <InfoSection id="terms-closing" title="Closing your account">
        <p>
          You can delete your account once you have no active sessions or remaining funds and have archived any groups
          you own. Your personal details are removed; past session and wallet records are kept without your name.
          See the <Link href="/privacy">Privacy policy</Link> for details.
        </p>
      </InfoSection>

      <InfoSection id="terms-changes" title="Changes">
        <p>These terms describe how the app works today. They may change as the project develops.</p>
      </InfoSection>
    </InfoPage>
  );
}
