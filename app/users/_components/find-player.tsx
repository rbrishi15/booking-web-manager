"use client";

import { Search } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { initials } from "@/components/ui/initials";
import { Input } from "@/components/ui/input";
import { ReliabilityBadge } from "@/components/ui/reliability-badge";
import type { FindPlayerState } from "../find-player-action";
import { normalizeUserHandle, userHandleProblem } from "../schemas";

const initialState: FindPlayerState = { status: "idle" };

interface FindPlayerProps {
  /** The findPlayer server action; Storybook passes a stand-in. */
  readonly action: (previous: FindPlayerState, formData: FormData) => Promise<FindPlayerState>;
}

/** Search for one player by exact user ID (ADR-0021) and show their name, @id and reliability. */
export function FindPlayer({ action }: FindPlayerProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [handle, setHandle] = useState("");

  // Check the ID's form here, so a typo never waits for the server; keep the typed text after searching.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    const issue = userHandleProblem(normalizeUserHandle(String(formData.get("handle") ?? "")));
    setProblem(issue);
    if (issue === null) startTransition(() => formAction(formData));
  }

  const message = problem ?? (state.status === "error" ? state.message : null);

  return (
    <div className="space-y-3">
      <form method="post" onSubmit={handleSubmit} noValidate className="flex flex-wrap gap-2" role="search" aria-label="Find a player">
        <div className="relative min-w-0 flex-1 basis-56">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
          <Input
            name="handle"
            value={handle}
            // The "@" is already shown in front of the field.
            onChange={(event) => setHandle(event.target.value.replace(/^\s*@+/u, ""))}
            aria-label="User ID"
            placeholder="user_id"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={33}
            className="min-h-11 pl-8"
            aria-invalid={message !== null}
            aria-describedby={message !== null ? "find-player-message" : undefined}
          />
        </div>
        <Button type="submit" className="min-h-11 gap-2" disabled={pending}>
          <Search className="h-4 w-4" aria-hidden="true" />
          {pending ? "Searching…" : "Find"}
        </Button>
      </form>

      <div aria-live="polite">
        {message !== null && <p id="find-player-message" className="text-sm text-destructive">{message}</p>}
        {problem === null && state.status === "not-found" && (
          <p className="text-sm text-muted-foreground">No player has the user ID @{state.handle}.</p>
        )}
        {problem === null && state.status === "found" && (
          <div className="flex items-center gap-4 rounded-lg border bg-card p-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-lg text-white" aria-hidden="true">
              {initials(state.player.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words font-semibold">{state.player.displayName}</p>
              <p className="break-all text-sm text-muted-foreground">@{state.player.handle}</p>
              {state.player.reliabilityScore === null ? (
                <p className="mt-1 text-sm text-muted-foreground">Reliability score unavailable right now.</p>
              ) : (
                <ReliabilityBadge score={state.player.reliabilityScore} className="mt-2" />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
