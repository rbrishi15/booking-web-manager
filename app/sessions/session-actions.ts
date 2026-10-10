import { bookingAccountIneligibility, type AccountStatus, type Visibility } from "@/domain";
import type { HostedSessionOperation } from "@/use-cases/sessions/ListHostedSessions";
import type { SessionCancellationPreview } from "@/use-cases/sessions/PreviewSessionCancellation";

interface Action<Name extends string, Method extends string, Inputs> {
  readonly name: Name;
  readonly href: string;
  readonly method: Method;
  readonly inputs: Inputs;
}

export type CreateSessionAction = Action<"create-session", "GET", Record<string, never>>;
export type AddEmailAction = Action<"add-email", "GET", Record<string, never>>;
export type SessionAccountAction = CreateSessionAction | AddEmailAction;
export type SubmitSessionAction = Action<"submit-session", "POST", Record<string, never>>;
export type SetSessionVisibilityAction = Action<"set-visibility", "PATCH", { readonly visibility: Visibility }>;
export type PreviewSessionCancellationAction = Action<"preview-cancellation", "GET", Record<string, never>>;
export type CancelSessionAction = Action<"cancel-session", "POST", { readonly previewVersion: string }>;
export type HostedSessionAction = SetSessionVisibilityAction | PreviewSessionCancellationAction;

export interface SessionAccountContext {
  readonly accountStatus: AccountStatus;
  readonly email: string | null;
  readonly emailVerified: boolean;
}

function accountIneligibility(account: SessionAccountContext) {
  return bookingAccountIneligibility({ accountStatus: account.accountStatus,
    hasEmail: account.email !== null && account.email.trim() !== "" });
}

/** Account permission to open creation; submitted booking and payout rules remain authoritative. */
export function getCreateSessionAction(account: SessionAccountContext): CreateSessionAction | undefined {
  if (accountIneligibility(account) !== undefined) return undefined;
  return { name: "create-session", href: "/sessions/create", method: "GET", inputs: {} };
}

export function getAddEmailAction(account: SessionAccountContext): AddEmailAction | undefined {
  if (accountIneligibility(account) !== "EMAIL_REQUIRED") return undefined;
  return { name: "add-email", href: "/profile/email", method: "GET", inputs: {} };
}

export function getSessionAccountActions(account: SessionAccountContext): readonly SessionAccountAction[] {
  const action = getCreateSessionAction(account) ?? getAddEmailAction(account);
  return action === undefined ? [] : [action];
}

export const createSessionSubmissionAction: SubmitSessionAction = { name: "submit-session", href: "/api/sessions", method: "POST", inputs: {} };

export function previewSessionCancellationAction(sessionId: string): PreviewSessionCancellationAction {
  return { name: "preview-cancellation", href: `/api/sessions/${encodeURIComponent(sessionId)}/cancellation-preview`, method: "GET", inputs: {} };
}

/** Maps domain-selected transitions into targets the existing browser transports can follow. */
export function toHostedSessionActions(sessionId: string, operations: readonly HostedSessionOperation[]): readonly HostedSessionAction[] {
  return operations.map((operation) => {
    switch (operation.name) {
      case "set-visibility":
        return { name: operation.name, href: `/api/sessions/${encodeURIComponent(sessionId)}/visibility`, method: "PATCH", inputs: { visibility: operation.visibility } };
      case "preview-cancellation":
        return previewSessionCancellationAction(sessionId);
      default: {
        const unsupported: never = operation;
        throw new Error(`Unsupported session action: ${String(unsupported)}`);
      }
    }
  });
}

export function cancelSessionAction(sessionId: string, previewVersion: string): CancelSessionAction {
  return { name: "cancel-session", href: `/api/sessions/${encodeURIComponent(sessionId)}/cancel`, method: "POST", inputs: { previewVersion } };
}

export type ActionableCancellationPreview = SessionCancellationPreview & { readonly actions: readonly CancelSessionAction[] };

export function withCancellationAction(preview: SessionCancellationPreview): ActionableCancellationPreview {
  return { ...preview, actions: [cancelSessionAction(preview.sessionId, preview.previewVersion)] };
}
