import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BookingLogo } from "@/components/ui/booking-logo";
import styles from "./auth.module.css";

interface AuthFrameProps {
  readonly prompt: string;
  readonly switchLabel: string;
  readonly switchHref: string;
  readonly children: React.ReactNode;
}

/** Shared court backdrop and responsive form surface for UC1-01 and UC1-02. */
export function AuthFrame({ prompt, switchLabel, switchHref, children }: AuthFrameProps) {
  return (
    <div className={styles.frame}>
      <div className={styles.scene} aria-hidden="true">
        <picture>
          <source media="(max-width: 899px)" srcSet="/images/auth-court-mobile.webp" />
          <img src="/images/auth-court.webp" alt="" width={720} height={1024} className={styles.court} fetchPriority="high" />
        </picture>
        <div className={styles.sceneFade} />
        <p className={styles.sceneCaption}>Great games<br />start here<span /></p>
        <p className={styles.mobileCaption}>People<br />Courts<br />Community<span /></p>
        <div className={styles.sceneFooter}>
          <p>Booking.</p>
          <p>People courts community</p>
        </div>
      </div>

      <header className={styles.header}>
        <Link href="/" aria-label="Booking home" className={styles.homeLink}>
          <BookingLogo className={styles.logo} />
        </Link>
        <div className={styles.headerSwitch}>
          <span>{prompt}</span>
          <Button asChild variant="outline" className={styles.switchButton}>
            <Link href={switchHref}>{switchLabel}</Link>
          </Button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.card}>{children}</div>
      </main>
    </div>
  );
}

interface AuthHeadingProps {
  readonly title: string;
  readonly description: string;
}

export function AuthHeading({ title, description }: AuthHeadingProps) {
  return (
    <div className={styles.heading}>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
