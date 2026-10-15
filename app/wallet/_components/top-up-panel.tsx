"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseTopUpAmount } from "../top-up-amount";
import type { TopUpTransport } from "../top-up-transport";

export interface TopUpPanelProps {
  readonly transport: TopUpTransport;
  /** Refreshes the wallet once Stripe reports the payment. */
  readonly onPaid: () => void;
}

const PRESETS = ["10", "20", "50"] as const;

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "paying" }
  | { readonly kind: "paid" }
  | { readonly kind: "error"; readonly message: string };

/**
 * UC1-05 top-up with PayNow. Stripe shows the QR code; the wallet is credited
 * only by the server's webhook (CLAUDE.md rule #2), never by this component,
 * so the balance updates a few seconds after the payment.
 */
export function TopUpPanel({ transport, onPaid }: TopUpPanelProps) {
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // One key per attempt: a retry of the same attempt reuses it (rule #6); a new amount gets a new one.
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const parsed = parseTopUpAmount(amount);

  async function pay() {
    if (parsed.status !== "valid") return;
    setPhase({ kind: "paying" });
    const outcome = await transport.payWithPayNow(parsed.cents, attemptKey);
    if (outcome.status === "paid") {
      setPhase({ kind: "paid" });
      setAttemptKey(crypto.randomUUID());
      onPaid();
    } else if (outcome.status === "cancelled") {
      setPhase({ kind: "idle" });
    } else {
      setPhase({ kind: "error", message: outcome.message });
    }
  }

  function change(next: string) {
    setAmount(next);
    setAttemptKey(crypto.randomUUID());
    if (phase.kind !== "paying") setPhase({ kind: "idle" });
  }

  return (
    <section aria-labelledby="top-up-heading" className="mt-3 rounded-lg border bg-card p-4">
      <h3 id="top-up-heading" className="font-semibold">Top up with PayNow</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button key={preset} variant="outline" className="min-h-11" disabled={phase.kind === "paying"} onClick={() => change(preset)}>
            S${preset}
          </Button>
        ))}
      </div>
      <div className="mt-3">
        <Label htmlFor="top-up-amount">Amount (S$)</Label>
        <Input
          id="top-up-amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="20.00"
          className="mt-1 min-h-11"
          value={amount}
          disabled={phase.kind === "paying"}
          onChange={(event) => change(event.target.value)}
          aria-invalid={amount !== "" && parsed.status === "invalid"}
          aria-describedby="top-up-help"
        />
        <p id="top-up-help" className="mt-1 text-xs text-muted-foreground">
          {amount !== "" && parsed.status === "invalid" ? parsed.message : "Between S$1.00 and S$1,000.00."}
        </p>
      </div>
      {phase.kind === "error" && <ErrorMessage className="mt-3">{phase.message}</ErrorMessage>}
      {phase.kind === "paid" && (
        <InfoNote icon className="mt-3">Payment received. Your balance updates in a few seconds.</InfoNote>
      )}
      <Button className="mt-3 min-h-11" disabled={parsed.status !== "valid" || phase.kind === "paying"} onClick={() => void pay()}>
        {phase.kind === "paying" ? "Waiting for PayNow…" : "Pay with PayNow"}
      </Button>
    </section>
  );
}
