import { DomainError, Email, User, type DeactivationInput, type UUID } from "@/domain";

/** Everything UC1-04 must check before an account may be deleted (SRS preconditions). */
export interface AccountStanding extends DeactivationInput {
  /** The user's wallet, or null if one was never created. */
  readonly walletId: UUID | null;
}

/** The personal details a profile had before deactivation, so a failed deletion can be undone. */
export interface ProfileSnapshot {
  readonly userId: UUID;
  readonly displayName: string;
  readonly preferredSports: readonly string[];
  readonly preferredRegions: readonly string[];
}

/** What the use case needs from the outside world. lib/supabase/account-admin.ts provides the real one. */
export interface DeleteAccountPorts {
  loadStanding(userId: UUID): Promise<AccountStanding>;
  /** Blank the personal details and mark the account INACTIVE. Returns what was there before. */
  deactivateProfile(userId: UUID): Promise<ProfileSnapshot>;
  /** Undo deactivateProfile: put the details back and mark the account ACTIVE again. */
  restoreProfile(snapshot: ProfileSnapshot): Promise<void>;
  /** Remove the login for good (the user row itself is kept for audit). */
  deleteLogin(userId: UUID): Promise<void>;
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

/**
 * UC1-04 Delete Account: check obligations (step 2, exception 2a), then soft-delete (step 5).
 * If anything fails after the profile is deactivated, the profile is put back so the user can try again.
 */
export async function deleteAccount(
  ports: DeleteAccountPorts,
  command: DeleteAccountCommand,
): Promise<DeleteAccountResult> {
  const standing = await ports.loadStanding(command.userId);
  if (!canDeactivate(command, standing)) return { status: "BLOCKED", standing };

  // 1. Deactivate first: an INACTIVE account can't log in or start anything new.
  const snapshot = await ports.deactivateProfile(command.userId);
  try {
    // 2. Check again, in case money, a commitment or a group arrived between the first check and now.
    const recheck = await ports.loadStanding(command.userId);
    if (!canDeactivate(command, recheck)) {
      await ports.restoreProfile(snapshot);
      return { status: "BLOCKED", standing: recheck };
    }

    // 3. Only now remove the login.
    await ports.deleteLogin(command.userId);
  } catch (error) {
    // Undo step 1 so the user isn't stuck with a blank, locked account.
    await ports.restoreProfile(snapshot).catch((restoreError: unknown) => {
      throw new AggregateError([error, restoreError], "UC1-04: deletion failed and the profile could not be restored");
    });
    throw error;
  }
  return { status: "DELETED" };
}