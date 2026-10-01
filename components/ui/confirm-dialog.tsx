"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ErrorMessage } from "@/components/ui/error-message";
import { Money } from "@/components/ui/money";

interface ConfirmDialogProps {

  readonly trigger: React.ReactElement;
  readonly title: string;
  readonly description: React.ReactNode;
 
  readonly amountCents?: number;

  readonly amountLabel?: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;

  readonly destructive?: boolean;

  readonly onConfirm: () => Promise<void> | void;
}


/**
 * Requests confirmation with an optional amount in integer SGD cents.
 * The trigger must render a focusable element that accepts Radix trigger props and a ref.
 * Disables action buttons and prevents closing while confirmation is pending;
 * closes on success and displays an error on failure.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  amountCents,
  amountLabel = "Amount",
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Runs the confirmation callback, displays failures, and always clears pending state. */
  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return; // don't close while the action is running
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {amountCents !== undefined && (
          <div className="rounded-lg bg-secondary p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {amountLabel}
            </p>
            <Money cents={amountCents} className="text-3xl font-bold" />
          </div>
        )}

        {error !== null && <ErrorMessage>{error}</ErrorMessage>}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}