"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, Copy, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseTopUpAmount } from "../top-up-amount";
import type { PayNowSession, TopUpTransport } from "../top-up-transport";

export interface TopUpPanelProps {
  readonly transport: TopUpTransport;
  /** Stripe has confirmed receipt; refresh the webhook-backed wallet ledger. */
  readonly onPaid: () => void;
}

const PRESETS = ["10", "20", "50"] as const;
type Phase =
  | { readonly kind: "amount" }
  | { readonly kind: "creating" }
  | { readonly kind: "payment"; readonly session: PayNowSession }
  | { readonly kind: "success" }
  | { readonly kind: "expired" }
  | { readonly kind: "error"; readonly message: string };

const formatSgd = (cents: number) => `S$${(cents / 100).toFixed(2)}`;

/** Two stages: amount selection and a Stripe-generated QR, with no nested payment overlay. */
export function TopUpPanel({ transport, onPaid }: TopUpPanelProps) {
  const [amount, setAmount] = useState("20");
  const [phase, setPhase] = useState<Phase>({ kind: "amount" });
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [checkWarning, setCheckWarning] = useState("");
  const [copied, setCopied] = useState(false);
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
          setPhase({ kind: "success" });
          onPaid();
        } else if (outcome.status === "expired" || Date.now() >= paymentSession.qrCode.expiresAt) {
          completed = true;
          setPhase({ kind: "expired" });
        } else {
          setCheckWarning(outcome.status === "error" ? outcome.message : "");
        }
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
      setCopied(false);
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

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const amountStage = phase.kind === "amount" || phase.kind === "creating" || phase.kind === "error";
  const displayCents = phase.kind === "payment" ? phase.session.amountCents
    : parsed.status === "valid" ? parsed.cents : 0;

  return (
    <section aria-label="Add funds with PayNow" className="px-6 pb-7 pt-9 text-[#111714] dark:text-[#f6f7f5] sm:px-9 sm:pb-9 sm:pt-10">
      <p className="mb-7 text-[10px] font-medium uppercase tracking-[.18em] text-[#7e8981] dark:text-[#8794a5]">
        Wallet <span className="mx-2">/</span> {amountStage ? "01" : "02"} of 02
      </p>
      {amountStage ? (
        <>
          <h2 className="text-[32px] font-semibold leading-tight tracking-[-.05em] sm:text-[38px]">Add funds.</h2>
          <p className="mt-2 text-sm leading-6 text-[#6b746e] dark:text-[#9ba5b4]">Top up your wallet securely with PayNow.</p>
          <div className="mt-10">
            <Label htmlFor="top-up-amount" className="mb-2 block text-xs font-medium text-[#777f79] dark:text-[#9ba5b4]">Amount (S$)</Label>
            <div className="flex items-baseline border-b border-[#cbd1cb] pb-3 dark:border-[#394555]">
              <span className="mr-3 text-2xl font-medium">S$</span>
              <Input
                id="top-up-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => change(event.target.value)}
                disabled={phase.kind === "creating"}
                aria-invalid={amount !== "" && parsed.status === "invalid"}
                aria-describedby="top-up-help"
                className="h-14 border-0 bg-transparent px-0 text-[38px] font-semibold tracking-[-.055em] shadow-none focus-visible:ring-0 md:text-[44px]"
                placeholder="20.00"
              />
            </div>
            <p id="top-up-help" className="mt-2 min-h-5 text-xs text-[#7d877f] dark:text-[#9ba5b4]">
              {amount !== "" && parsed.status === "invalid" ? parsed.message : "Minimum S$1.00 · Maximum S$1,000.00"}
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {PRESETS.map((preset) => (
                <Button
                  key={preset}
                  variant="outline"
                  disabled={phase.kind === "creating"}
                  aria-pressed={amount === preset}
                  onClick={() => change(preset)}
                  className={`h-12 rounded-md border-[#d8ddd9] bg-transparent text-sm font-medium hover:bg-[#e8ece6] dark:border-[#303c4d] dark:hover:bg-[#202b3a] ${amount === preset ? "border-[#151a16] bg-[#e5eae3] text-[#101611] dark:border-[#d4dbe5] dark:bg-[#263243] dark:text-white" : ""}`}
                >
                  {`S${preset}`} 
                </Button>
              ))}
            </div>
          </div>
          {phase.kind === "error" && <ErrorMessage className="mt-6">{phase.message}</ErrorMessage>}
          <Button
            className="mt-10 flex h-12 min-h-12 w-full justify-between rounded-md bg-[#101613] px-5 text-sm font-medium text-white hover:bg-[#2c3730] dark:bg-[#f3f5f2] dark:text-[#101613] dark:hover:bg-white"
            disabled={parsed.status !== "valid" || phase.kind === "creating"}
            onClick={() => void continueToPayment()}
          >
            <span>{phase.kind === "creating" ? "Preparing PayNow…" : "Continue with PayNow"}</span>
            {phase.kind === "creating" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
          </Button>
          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-[#79827d] dark:text-[#8d9bab]">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Payments processed securely by Stripe
          </div>
        </>
      ) : phase.kind === "payment" ? (
        <>
          <h2 className="text-[32px] font-semibold leading-tight tracking-[-.05em] sm:text-[38px]">Scan to pay.</h2>
          <p className="mt-2 text-sm leading-6 text-[#6b746e] dark:text-[#9ba5b4]">Open your banking app and scan the PayNow QR code.</p>
          <div className="mt-8 text-center">
            <p className="text-[34px] font-semibold tracking-[-.055em]">{formatSgd(displayCents)}</p>
            <div className="mx-auto mt-5 w-fit rounded-xl border border-[#e3e8e3] bg-white p-5 shadow-[0_14px_28px_-22px_#0006]">
              <span className="mb-3 block text-center text-xs font-extrabold tracking-[.12em] text-[#93217d]">PAYNOW</span>
              <Image unoptimized src={phase.session.qrCode.imageUrlPng} width={224} height={224} className="h-[min(52vw,224px)] w-[min(52vw,224px)] object-contain" alt={`PayNow QR code for ${formatSgd(displayCents)}`} />
            </div>
          </div>
          <div role="status" aria-live="polite" className="mt-7 flex items-center justify-center gap-2 text-xs text-[#657367] dark:text-[#afbdca]">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            Waiting for payment confirmation
          </div>
          {checkWarning && <p role="alert" className="mt-2 text-center text-xs text-amber-700 dark:text-amber-300">{checkWarning}</p>}
          <p className="mt-3 text-center text-xs leading-5 text-[#79847c] dark:text-[#92a0b0]">QR codes expire after one hour. Closing this window does not cancel a payment.</p>
          {phase.session.qrCode.hostedInstructionsUrl && (
            <Button variant="outline" className="mt-6 h-12 w-full justify-between rounded-md border-[#d7ddd9] bg-transparent dark:border-[#334153]" onClick={() => void copyLink(phase.session.qrCode.hostedInstructionsUrl!)}>
              <span>{copied ? "Payment link copied" : "Copy payment link"}</span>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          )}
          <p className="mt-5 text-center text-xs text-[#79847c] dark:text-[#92a0b0]">Payment is verified automatically. No need to press a confirmation button.</p>
        </>
      ) : (
        <div className="py-8 text-center">
          {phase.kind === "success" ? <CheckCircle2 className="mx-auto h-11 w-11 text-emerald-600 dark:text-emerald-400" /> : <LoaderCircle className="mx-auto h-11 w-11 text-[#758374] dark:text-[#96a3b7]" />}
          <h2 className="mt-6 text-[32px] font-semibold tracking-[-.05em]">{phase.kind === "success" ? "Payment received." : "QR code expired."}</h2>
          <p className="mt-3 text-sm leading-6 text-[#6b746e] dark:text-[#9ba5b4]">
            {phase.kind === "success" ? "Your wallet balance will update when the verified payment is credited." : "This payment code is no longer valid. Start a new top-up to get a fresh QR code."}
          </p>
          <Button variant="outline" className="mt-8 h-12 w-full rounded-md dark:border-[#394555]" onClick={newPayment}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Start another top-up
          </Button>
        </div>
      )}
    </section>
  );
}
