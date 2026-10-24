import { ArrowDown, ArrowRight, ArrowUpRight } from "lucide-react";
import { BookingLogo } from "@/components/ui/booking-logo";
import Image from "next/image";
import Link from "next/link";
import { LandingMobileMenu, LandingPage } from "./landing-navigation";
import { LandingHostSection } from "./landing-host-section";
import styles from "./landing-view.module.css";

const sports = [
  { name: "Tennis", image: "tennis", caption: "Make time for a rally." },
  { name: "Badminton", image: "badminton", caption: "A good match starts here." },
  { name: "Basketball", image: "basketball", caption: "Meet you on the court." },
] as const;

/** Public and synchronous: content and navigation never depend on authentication or services. */
export function LandingView() {
  return (
    <LandingPage>
      <a className={styles.skipLink} href="#landing-content">Skip to content</a>
      <section className={styles.hero} aria-labelledby="landing-title" id="play" tabIndex={-1}>
        <picture className={styles.backdrop} aria-hidden="true">
          <source media="(max-width: 700px)" srcSet="/images/landing-court-mobile.webp" />
          {/* Art direction uses a different composition on mobile, not a crop of the desktop court. */}
          <img src="/images/landing-court.webp" alt="" width="1536" height="1024" fetchPriority="high" />
        </picture>
        <div className={styles.wash} aria-hidden="true" />
        <svg className={styles.wallCaption} viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Same sport. Different people.">
          <g transform="translate(1327 377) skewY(-5) scale(.7 1)">
            <text>
              <tspan x="0" dy="0">Same</tspan>
              <tspan x="0" dy="25">Sport</tspan>
              <tspan x="0" dy="25">Different</tspan>
              <tspan x="0" dy="25">People</tspan>
            </text>
            <path d="M0 110h29" />
          </g>
        </svg>
        <header className={styles.header}>
          <Link href="/" className={styles.logo} aria-label="Booking home"><BookingLogo tone="inherit" /></Link>
          <nav className={styles.desktopNav} aria-label="Main navigation">
            <a href="#play">Play</a>
            <a href="#sports">Discover</a>
            <Link href="/sessions/create" prefetch={false}>Host</Link>
            <a href="#how-it-works">How it works</a>
          </nav>
          <Link href="/login" prefetch={false} className={styles.login}>Log in<ArrowUpRight size={15} aria-hidden="true" /></Link>
          <LandingMobileMenu />
        </header>

        <div className={styles.heroCopy} id="landing-content" tabIndex={-1}>
          <p className={styles.eyebrow}>Courts bring<br className={styles.mobileBreak} /> people together</p>
          <h1 id="landing-title">Find your<br />next game.</h1>
          <p className={styles.intro}>Share the court. Meet players.<br />Make time for play.</p>
          <Link className={styles.primaryLink} href="/register" prefetch={false}>Sign up<ArrowRight aria-hidden="true" /></Link>
        </div>

        <div className={styles.sectionIndex}>
          <nav aria-label="Page sections">
            <a href="#play" aria-label="01 — Play" className={styles.currentSection}>01</a>
            <a href="#sports" aria-label="02 — Find your sport">02</a>
            <a href="#how-it-works" aria-label="03 — How it works">03</a>
            <a href="#host" aria-label="04 — Host a session">04</a>
          </nav>
          <span aria-hidden="true" />
          <p>Same<br />sport<br />different<br />people</p>
        </div>

        <ul className={styles.facts} aria-label="What you can do with Booking">
          <li><strong>Your sport</strong><span>From tennis to futsal</span></li>
          <li><strong>Your time</strong><span>Filter to fit your day</span></li>
          <li><strong>Your share</strong><span>See the price per player</span></li>
        </ul>
        <a href="#sports" className={styles.scrollCue}><span>Play more.<br />Live brighter.</span><ArrowDown size={18} aria-hidden="true" /></a>
      </section>

      <section className={styles.sportsSection} id="sports" aria-labelledby="sports-title" tabIndex={-1}>
        <div className={styles.sectionHeading}>
          <div><p className={styles.eyebrow}>01 / Find your people</p><h2 id="sports-title">A game for your kind of day.</h2></div>
          <Link href="/discover" className={styles.textLink}>Explore all sessions<ArrowUpRight size={20} aria-hidden="true" /></Link>
        </div>
        <div className={styles.sportsGrid}>
          {sports.map((sport) => (
            <Link key={sport.name} href={`/discover?sport=${sport.name}`} className={styles.sportCard}>
              <div className={styles.sportImage}><Image src={`/images/sports/${sport.image}.jpg`} alt="" fill sizes="(max-width: 700px) 90vw, 30vw" /></div>
              <div className={styles.sportTitle}><h3>{sport.name}</h3><ArrowUpRight size={23} strokeWidth={1.3} aria-hidden="true" /></div>
              <p>{sport.caption}</p>
            </Link>
          ))}
        </div>
        <div className={styles.moreSports}><span>More your thing?</span>{["Football", "Futsal", "Volleyball"].map((sport) => <Link key={sport} href={`/discover?sport=${sport}`}>{sport}<ArrowUpRight size={14} aria-hidden="true" /></Link>)}</div>
      </section>

      <section className={styles.howSection} id="how-it-works" aria-labelledby="how-title" tabIndex={-1}>
        <div><p className={styles.eyebrow}>02 / Less planning. More playing.</p><h2 id="how-title">Good company.<br />A shared court.<br /><span>Your next game.</span></h2><Link href="/register" prefetch={false} className={styles.textLink}>Create account<ArrowRight size={20} aria-hidden="true" /></Link></div>
        <ol className={styles.steps}>
          <li><span>01</span><div><h3>See what’s on.</h3><p>Create an account to browse sports sessions. Start with a sport you love or try something different.</p></div></li>
          <li><span>02</span><div><h3>Find a time that fits.</h3><p>Narrow your search by sport, region, date and time. Make room for a game in your day.</p></div></li>
          <li><span>03</span><div><h3>Know the details.</h3><p>See the venue, session time and price per player up front, so you can plan before making a commitment.</p></div></li>
        </ol>
      </section>

      <LandingHostSection>
        <p className={styles.eyebrow}>03 / Bring people together</p>
        <h2 id="host-title">Got a court?<br />Make it a game.</h2>
        <p>Already booked a venue? Create a session, set your places and price, and give people a reason to play.</p>
        <Link href="/sessions/create" prefetch={false} className={styles.primaryLink}>Host a session<ArrowUpRight aria-hidden="true" /></Link>
      </LandingHostSection>

      <footer className={styles.footer}>
        <div><Link href="/" className={styles.logo}><BookingLogo tone="inherit" /></Link><p>A better game, together.</p></div>
        <nav aria-label="Project resources"><span>Explore the project</span><Link href="/api-docs" prefetch={false}>API docs<ArrowUpRight size={14} aria-hidden="true" /></Link><Link href="/api/openapi" prefetch={false}>OpenAPI<ArrowUpRight size={14} aria-hidden="true" /></Link><Link href="/storybook" prefetch={false}>Storybook<ArrowUpRight size={14} aria-hidden="true" /></Link></nav>
        <p className={styles.credit}>Made for the love of the game.<br />NTU SC2006 · Group 3</p>
      </footer>
    </LandingPage>
  );
}
