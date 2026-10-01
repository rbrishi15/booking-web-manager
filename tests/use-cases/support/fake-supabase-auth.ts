import { vi } from "vitest";

/** What `profiles.select("account_status")...maybeSingle()` returns in a test. */
export type ProfileLookup =
  | { readonly data: { readonly account_status: string }; readonly error: null }
  | { readonly data: null; readonly error: null }
  | { readonly data: null; readonly error: { readonly code: string; readonly message: string } };

export const activeProfile: ProfileLookup = { data: { account_status: "ACTIVE" }, error: null };
export const inactiveProfile: ProfileLookup = { data: { account_status: "INACTIVE" }, error: null };
export const missingProfile: ProfileLookup = { data: null, error: null };
export const failedProfileLookup: ProfileLookup = {
  data: null,
  error: { code: "PGRST000", message: "connection lost" },
};

interface FakeSupabaseOptions {
  /** Result of signInWithPassword (login). */
  readonly signIn?: unknown;
  /** Result of signUp (registration). */
  readonly signUp?: unknown;
  /** The logged-in user getUser() reports (middleware); null = no valid login cookie. */
  readonly user?: { readonly id: string } | null;
  /** What the profiles lookup returns. */
  readonly profile?: ProfileLookup;
}

/**
 * A stand-in for the Supabase client with just the calls the auth code makes.
 * Every method is a spy, so tests can check what was called (e.g. signOut).
 */
export function fakeSupabase(options: FakeSupabaseOptions = {}) {
  const profile = options.profile ?? activeProfile;
  const maybeSingle = vi.fn(async () => profile);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));

  return {
    auth: {
      signInWithPassword: vi.fn(async () => options.signIn),
      signUp: vi.fn(async () => options.signUp),
      getUser: vi.fn(async () => ({ data: { user: options.user ?? null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn(() => ({ select })),
    /** The `.eq(column, value)` spy, to check which user's profile was looked up. */
    profileEq: eq,
  };
}

/** Thrown by the mocked `redirect()` so a test can see where the action tried to go. */
export class RedirectCalled extends Error {
  constructor(readonly path: string) {
    super(`redirect(${path})`);
  }
}

/** Builds the FormData a form would post. */
export function formDataOf(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
}
