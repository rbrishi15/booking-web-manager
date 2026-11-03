"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowUpRight, Check, Info, LoaderCircle, ScanLine, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { ErrorMessage } from "@/components/ui/error-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseTopUpAmount } from "../top-up-amount";
import type { PayNowSession, TopUpTransport } from "../top-up-transport";
import styles from "./top-up-panel.module.css";

export interface TopUpPanelProps {
  readonly transport: TopUpTransport;
  /** Stripe has confirmed payment; refresh the webhook-backed ledger. */
  readonly onPaid: () => void;
}

const PRESETS = ["10", "20", "50"] as const;
type Phase =
  | { readonly kind: "amount" }
  | { readonly kind: "creating" }
  | { readonly kind: "payment"; readonly session: PayNowSession }
  | { readonly kind: "success"; readonly session: PayNowSession }
  | { readonly kind: "expired" }
  | { readonly kind: "error"; readonly message: string };

const formatSgd = (cents: number) => "S$" + (cents / 100).toFixed(2);

/** Single accessible dialog: amount, real Stripe QR/test payment, then verified confirmation. */
export function TopUpPanel({ transport, onPaid }: TopUpPanelProps) {
  const [amount, setAmount] = useState("20");
  const [phase, setPhase] = useState<Phase>({ kind: "amount" });
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [checkWarning, setCheckWarning] = useState("");
  const [qrExpanded, setQrExpanded] = useState(false);
  const parsed = parseTopUpAmount(amount);
  const paymentSession = phase.kind === "payment" ? phase.session : null;

  useEffect(() => {
    if (!paymentSession) return;
    let active = true;
    let checking = false;
    let completed = false;
    async function check() {
      if (!active || checking || !paymentSession) return;
      checking = true;
      try {
        const outcome = await transport.checkPayment(paymentSession);
        if (!active || completed) return;
        if (outcome.status === "paid") {
          completed = true;
          setPhase({ kind: "success", session: paymentSession });
          onPaid();
        } else if (outcome.status === "expired" || Date.now() >= paymentSession.qrCode.expiresAt) {
          completed = true;
          setPhase({ kind: "expired" });
        } else {
          setCheckWarning(outcome.status === "error" ? outcome.message : "");
        }
      } catch {
        if (active && !completed) setCheckWarning("Couldn't check payment status. We'll keep trying.");
      } finally {
        checking = false;
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [paymentSession, transport, onPaid]);

  function change(next: string) {
    setAmount(next);
    setAttemptKey(crypto.randomUUID());
    setPhase({ kind: "amount" });
  }

  async function continueToPayment() {
    if (parsed.status !== "valid" || phase.kind === "creating") return;
    setPhase({ kind: "creating" });
    const result = await transport.startPayNow(parsed.cents, attemptKey);
    if (result.status === "ready") {
      setCheckWarning("");
      setQrExpanded(false);
      setPhase({ kind: "payment", session: result.session });
    } else {
      setPhase({ kind: "error", message: result.message });
    }
  }

  function newPayment() {
    setAttemptKey(crypto.randomUUID());
    setPhase({ kind: "amount" });
    setCheckWarning("");
  }

  const amountStage = phase.kind === "amount" || phase.kind === "creating" || phase.kind === "error";

  return (
    <section className={styles.panel} aria-label="Add funds with PayNow" data-stage={amountStage ? "amount" : phase.kind}>
      <p className={styles.breadcrumb}>WALLET <span aria-hidden="true">/</span> ADD FUNDS</p>
      {amountStage ? (
        <>
          <header className={styles.intro}>
            <h2 className={styles.heading}>Add funds.</h2>
            <p className={styles.description}>Top up your wallet securely with PayNow.</p>
          </header>
          <div className={styles.amountSection}>
            <Label htmlFor="top-up-amount" className={styles.label}>Amount (S$)</Label>
            <div className={styles.amountControl}>
              <span className={styles.currency} aria-hidden="true">S$</span>
              <Input
                id="top-up-amount"
                className={styles.amountInput}
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => change(event.target.value)}
                disabled={phase.kind === "creating"}
                aria-invalid={amount !== "" && parsed.status === "invalid"}
                aria-describedby="top-up-help"
                placeholder="20"
              />
            </div>
            <p id="top-up-help" className={styles.help}>
              {amount !== "" && parsed.status === "invalid" ? parsed.message : "Minimum S$1.00 · Maximum S$1,000.00."}
            </p>
            <div className={styles.presets} role="group" aria-label="Quick amounts">
              {PRESETS.map((preset) => (
                <Button
                  key={preset}
                  variant="outline"
                  className={styles.preset}
                  disabled={phase.kind === "creating"}
                  aria-pressed={amount === preset}
                  onClick={() => change(preset)}
                >
                  {"S$" + preset}
                </Button>
              ))}
            </div>
          </div>
          {phase.kind === "error" && <ErrorMessage className={styles.error}>{phase.message}</ErrorMessage>}
          <footer className={styles.footer}>
            <Button
              className={styles.primaryButton}
              disabled={parsed.status !== "valid" || phase.kind === "creating"}
              onClick={() => void continueToPayment()}
            >
              <span>{phase.kind === "creating" ? "Preparing PayNow…" : "Continue with PayNow"}</span>
              {phase.kind === "creating" ? <LoaderCircle className={styles.buttonIcon + " animate-spin"} aria-hidden="true" /> : <ArrowUpRight className={styles.buttonIcon} aria-hidden="true" />}
            </Button>
            <p className={styles.security}><ShieldCheck size={15} aria-hidden="true" /> Payments processed securely by Stripe</p>
          </footer>
        </>
      ) : phase.kind === "payment" ? (
        <>
          <header className={styles.paymentIntro}>
            <h2 className={styles.heading}>Scan to pay.</h2>
            <p className={styles.description}>Scan the PayNow QR or simulate a payment with Stripe&apos;s test environment.</p>
          </header>
          <div className={styles.qrArea}>
            <div className={styles.qrFrame + (qrExpanded ? " " + styles.qrExpanded : "")}>
              <div className={styles.qrSurface}>
                <Image
                  unoptimized
                  src={phase.session.qrCode.imageUrlPng}
                  width={170}
                  height={170}
                  alt={"PayNow QR code for " + formatSgd(phase.session.amountCents)}
                  className={styles.qrImage}
                />
              </div>
              <span className={styles.paynowBrand}>PAYN<span className={styles.paynowLogo}>◉</span>W</span>
            </div>
          </div>
          <div className={styles.paymentActions}>
            {phase.session.qrCode.testPaymentUrl ? (
              <a
                className={styles.simulateButton}
                href={phase.session.qrCode.testPaymentUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ScanLine size={19} aria-hidden="true" />
                <span>Simulate scan</span>
                <ArrowUpRight size={19} aria-hidden="true" />
                <span className="sr-only">(opens Stripe test payment page in a new tab)</span>
              </a>
            ) : (
              <div className={styles.noSimulator} role="status">
                <Info size={17} aria-hidden="true" />
                <span>Stripe did not provide a test scan link for this QR code.</span>
              </div>
            )}
            <div className={styles.orDivider}><span>OR</span></div>
            <Button
              variant="outline"
              className={styles.secondaryButton}
              onClick={() => setQrExpanded((previous) => !previous)}
              aria-expanded={qrExpanded}
            >
              <ScanLine size={17} aria-hidden="true" />
              <span>{qrExpanded ? "Reduce QR code" : "Show larger QR code"}</span>
            </Button>
            {phase.session.qrCode.hostedInstructionsUrl && (
              <a className={styles.instructionsLink} href={phase.session.qrCode.hostedInstructionsUrl} target="_blank" rel="noopener noreferrer">
                Open Stripe payment instructions <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            )}
            <p role="status" aria-live="polite" className={styles.waiting}>
              <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
              Waiting for payment confirmation · {formatSgd(phase.session.amountCents)}
            </p>
            {checkWarning && <p className={styles.warning} role="alert">{checkWarning}</p>}
          </div>
          <footer className={styles.paymentFootnote}>
            <Info size={15} aria-hidden="true" />
            <span>This is a test payment. No real money will be charged. QR expires after one hour.</span>
          </footer>
        </>
      ) : phase.kind === "success" ? (
        <>
          <div className={styles.successHero} role="status" aria-live="polite">
            <div className={styles.successIcon}><Check size={38} strokeWidth={1.8} aria-hidden="true" /></div>
            <h2 className={styles.successHeading}>Payment confirmed!</h2>
            <p className={styles.description}>Your wallet balance will update once the payment is credited.</p>
          </div>
          <dl className={styles.receipt}>
            <div><dt>Amount</dt><dd>{formatSgd(phase.session.amountCents)}</dd></div>
            <div><dt>Payment method</dt><dd>PayNow (Test)</dd></div>
            <div><dt>Transaction ID</dt><dd className={styles.transactionId}>{phase.session.paymentIntentId}</dd></div>
          </dl>
          <footer className={styles.successFooter}>
            <DialogClose asChild>
              <Button className={styles.primaryButton}>Done</Button>
            </DialogClose>
          </footer>
        </>
      ) : (
        <div className={styles.expired}>
          <Info size={38} aria-hidden="true" />
          <h2 className={styles.heading}>QR code expired.</h2>
          <p className={styles.description}>This payment code is no longer valid. Start a new top-up for a fresh QR code.</p>
          <Button variant="outline" onClick={newPayment} className={styles.secondaryButton}>
            <ArrowLeft size={16} aria-hidden="true" /> Start another top-up
          </Button>
        </div>
      )}
    </section>
  );
}
