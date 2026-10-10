/**
 * React Query keys for the UC2-05 screens. Joined sessions and previews belong to one account,
 * so their keys include the user ID: a cache that outlives an account change never shows one
 * user's data to another.
 */
export const joinedSessionsQueryKey = (userId: string) => ["sessions", "joined", userId] as const;
export const withdrawalPreviewQueryKey = (userId: string, sessionId: string) => ["sessions", "withdrawal-preview", userId, sessionId] as const;
/** Every wallet query; a withdrawal changes the player's balances. */
export const walletQueryKey = ["wallet"] as const;
