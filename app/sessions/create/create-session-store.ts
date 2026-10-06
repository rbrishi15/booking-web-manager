import { createStore } from "zustand/vanilla";
import type { NamedSet } from "zustand/middleware";
import {
  draftFromSubmission, emptySessionDraft, pendingStorageKey, pendingSubmissionSchema,
  submissionPayload, updateDraft, validateStep,
  type FieldErrors, type PendingSubmission, type SessionDraft,
} from "./model";
import type { CreateSession, CreationOutcome } from "./transport";

export type CreationFailure = Extract<CreationOutcome, { status: "error" }>;
export type CreationStep = 1 | 2 | 3;
export type CreationWorkflow =
  | { status: "editing"; errors: FieldErrors; failure: CreationFailure | null }
  | { status: "submitting"; pending: PendingSubmission; replaying: boolean }
  | { status: "awaitingConfirmation"; pending: PendingSubmission; failure: CreationFailure }
  | { status: "recoveryRequired"; failure: CreationFailure }
  | { status: "completed" };

export interface CreateSessionState {
  draft: SessionDraft;
  step: CreationStep;
  workflow: CreationWorkflow;
}
export type SubmissionResult =
  | { status: "created" | "ignored" | "failed" }
  | { status: "invalid"; errors: FieldErrors };
export interface CreateSessionActions {
  change(patch: Partial<SessionDraft>): void;
  advance(): FieldErrors | undefined;
  back(): void;
  restartAfterRecovery(): void;
  submit(create: CreateSession): Promise<SubmissionResult>;
}
export type CreateSessionStoreState = CreateSessionState & CreateSessionActions;
export type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface CreateSessionStoreOptions {
  userId: string;
  initialDraft?: SessionDraft;
  initialStep?: CreationStep;
  getStorage: () => PendingStorage;
  now?: () => number;
  newId?: () => string;
}

const recoveryFailure: CreationFailure = {
  status: "error", code: "PENDING_RECOVERY_FAILED", ambiguous: true,
  message: "We couldn't read your pending submission. It may already have created a session. Check your hosted sessions before starting again.",
};
const unknownResult: CreationFailure = {
  status: "error", code: "UNKNOWN_RESULT", ambiguous: true,
  message: "We couldn't confirm the result. Retry this submission to check safely.",
};
const awaitingFailure: CreationFailure = {
  status: "error", code: "PENDING_SUBMISSION", ambiguous: true,
  message: "A submission is awaiting confirmation. Retry it to safely recover the result.",
};

function parsePending(value: string): PendingSubmission | undefined {
  try {
    const result = pendingSubmissionSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : undefined;
  } catch { return undefined; }
}

/** A separate store per mounted wizard keeps drafts and requests scoped to its user. */
export function createSessionStore({
  userId, initialDraft = emptySessionDraft, initialStep = 1, getStorage,
  now = Date.now, newId = () => crypto.randomUUID(),
}: CreateSessionStoreOptions) {
  const key = pendingStorageKey(userId);
  const freshState = (): CreateSessionState => ({
    draft: { ...initialDraft }, step: initialStep,
    workflow: { status: "editing", errors: {}, failure: null },
  });
  const restore = (value: string, fallback: CreateSessionState): CreateSessionState => {
    const pending = parsePending(value);
    try {
      if (pending) return {
        draft: draftFromSubmission(pending.payload), step: 3,
        workflow: { status: "awaitingConfirmation", pending, failure: awaitingFailure },
      };
    } catch { /* An unreadable draft must retain its original storage evidence. */ }
    return { ...fallback, workflow: { status: "recoveryRequired", failure: recoveryFailure } };
  };
  const initial = freshState();
  let restored = initial;
  try {
    const value = getStorage().getItem(key);
    if (value !== null) restored = restore(value, initial);
  } catch {
    restored = { ...initial, workflow: { status: "recoveryRequired", failure: recoveryFailure } };
  }

  // Another instance may have replaced this user's slot while the request was in flight.
  const clearPending = (pending: PendingSubmission) => {
    const storage = getStorage();
    const value = storage.getItem(key);
    const current = value === null ? undefined : parsePending(value);
    if (current && JSON.stringify(current) === JSON.stringify(pending)) storage.removeItem(key);
  };

  return createStore<CreateSessionStoreState>()((_set, get, api) => {
    // Read the current setter so mounted DevTools instrumentation can attach/detach.
    const transition = (state: CreateSessionState, action: string) => {
      const set: NamedSet<CreateSessionStoreState> = api.setState;
      set(state, undefined, action);
    };
    const snapshot = (): CreateSessionState => {
      const { draft, step, workflow } = get();
      return { draft, step, workflow };
    };
    return {
      ...restored,
      change(patch) {
        const current = snapshot();
        if (current.workflow.status !== "editing") return;
        transition({ ...current, draft: updateDraft(current.draft, patch), workflow: { status: "editing", errors: {}, failure: null } }, "session/change");
      },
      advance() {
        const current = snapshot();
        if (current.workflow.status !== "editing" || current.step === 3) return;
        const errors = validateStep(current.draft, current.step, now());
        if (Object.keys(errors).length) {
          transition({ ...current, workflow: { status: "editing", errors, failure: null } }, "session/stepInvalid");
          return errors;
        }
        transition({ ...current, step: current.step === 1 ? 2 : 3, workflow: { status: "editing", errors: {}, failure: null } }, "session/next");
      },
      back() {
        const current = snapshot();
        if (current.workflow.status !== "editing" || current.step === 1) return;
        transition({ ...current, step: current.step === 3 ? 2 : 1, workflow: { status: "editing", errors: {}, failure: null } }, "session/back");
      },
      restartAfterRecovery() {
        const current = snapshot();
        if (current.workflow.status !== "recoveryRequired") return;
        try {
          const storage = getStorage();
          const original = storage.getItem(key);
          if (original !== null) {
            // A newly readable pending request must be retried, not discarded as corrupt.
            const recovered = restore(original, current);
            if (recovered.workflow.status === "awaitingConfirmation") { transition(recovered, "session/recoveryRestored"); return; }
            storage.setItem(`${key}:unresolved:${newId()}`, original);
            const latest = storage.getItem(key);
            if (latest !== original) {
              transition(latest === null ? freshState() : restore(latest, current), "session/recoveryReconciled");
              return;
            }
            storage.removeItem(key);
          }
          transition(freshState(), "session/recoveryRestarted");
        } catch {
          transition({ ...current, workflow: { status: "recoveryRequired", failure: {
            status: "error", code: "PENDING_RECOVERY_FAILED", ambiguous: true,
            message: "We couldn't preserve your pending submission. Enable session storage or free up storage space, then try starting again.",
          } } }, "session/recoveryFailed");
        }
      },
      async submit(create) {
        const current = snapshot();
        if (current.workflow.status !== "editing" && current.workflow.status !== "awaitingConfirmation") return { status: "ignored" };
        const replaying = current.workflow.status === "awaitingConfirmation";
        let pending: PendingSubmission;
        if (current.workflow.status === "awaitingConfirmation") {
          pending = current.workflow.pending;
        } else {
          const instant = now();
          for (const step of [1, 2, 3] as const) {
            const errors = validateStep(current.draft, step, instant);
            if (Object.keys(errors).length) {
              transition({ ...current, step, workflow: { status: "editing", errors, failure: null } }, "session/submitInvalid");
              return { status: "invalid", errors };
            }
          }
          let storage: PendingStorage;
          try {
            storage = getStorage();
            const existing = storage.getItem(key);
            if (existing !== null) {
              const recovered = restore(existing, current);
              transition(recovered, "session/pendingDiscovered");
              return { status: recovered.workflow.status === "awaitingConfirmation" ? "ignored" : "failed" };
            }
          } catch {
            transition({ ...current, workflow: { status: "recoveryRequired", failure: recoveryFailure } }, "session/storageReadFailed");
            return { status: "failed" };
          }
          pending = { version: 1, payload: submissionPayload(current.draft, newId()) };
          try { storage.setItem(key, JSON.stringify(pending)); } catch {
            transition({ ...current, workflow: { status: "editing", errors: {}, failure: {
              status: "error", code: "STORAGE_UNAVAILABLE", ambiguous: false,
              message: "Enable session storage so your submission can be retried safely.",
            } } }, "session/storageWriteFailed");
            return { status: "failed" };
          }
        }

        const submitted = { draft: current.draft, step: 3 as const };
        transition({ ...submitted, workflow: { status: "submitting", pending, replaying } }, replaying ? "session/retryStarted" : "session/submitStarted");
        try {
          const result = await create(pending.payload);
          if (result.status === "created") {
            clearPending(pending);
            transition({ ...submitted, workflow: { status: "completed" } }, "session/submitSucceeded");
            return { status: "created" };
          }
          if (!result.ambiguous && !replaying) {
            clearPending(pending);
            transition({ ...submitted, workflow: { status: "editing", errors: {}, failure: result } }, "session/submitRejected");
          } else {
            transition({ ...submitted, workflow: { status: "awaitingConfirmation", pending, failure: result } }, "session/confirmationRequired");
          }
        } catch {
          transition({ ...submitted, workflow: { status: "awaitingConfirmation", pending, failure: unknownResult } }, "session/submitUnconfirmed");
        }
        return { status: "failed" };
      },
    };
  });
}
