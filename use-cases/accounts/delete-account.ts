import { DomainError, Email, User, type DeactivationInput, type UUID } from "@/domain";

/** Everything UC1-04 must check before an account may be deleted (SRS preconditions). */
export interface AccountStanding extends DeactivationInput {
  /** The user's wallet, or null if one was never created. */
  readonly walletId: UUID | null;
}

/** What the use case needs from the outside world. lib/supabase/account-admin.ts provides the real one. */
export interface DeleteAccountPorts {
  loadStanding(userId: UUID): Promise<AccountStanding>;
  /** Soft delete: blank the personal details and mark the account INACTIVE. The row is kept for audit. */
  anonymiseAndDeactivate(userId: UUID): Promise<void>;
}

export interface DeleteAccountCommand {
  readonly userId: UUID;
  readonly email: string;
  readonly now: Date;
}

export type DeleteAccountResult =
  | { readonly status: "DELETED" }
  | { readonly status: "BLOCKED"; readonly standing: AccountStanding };

/**
 * Asks the domain (User.deactivate) whether this standing allows deletion.
 * False means exception 2a: money or commitments are still outstanding.
 */
export function canDeactivate(command: DeleteAccountCommand, standing: AccountStanding): boolean {
  const user = User.create({
    userId: command.userId,
    email: new Email(command.email),
    walletId: standing.walletId ?? command.userId, // no wallet yet: nothing to hold money
    now: command.now,
  });
  try {
    user.deactivate(standing);
    return true;
  } catch (error) {
    if (error instanceof DomainError && error.code === "ACTIVE_OBLIGATIONS") return false;
    throw error;
  }
}

/** UC1-04 Delete Account: check obligations (step 2, exception 2a), then soft-delete (step 5). */
export async function deleteAccount(
  ports: DeleteAccountPorts,
  command: DeleteAccountCommand,
): Promise<DeleteAccountResult> {
  const standing = await ports.loadStanding(command.userId);
  if (!canDeactivate(command, standing)) return { status: "BLOCKED", standing };

  await ports.anonymiseAndDeactivate(command.userId);
  return { status: "DELETED" };
}