/** React Query keys for the UC2-05 screens. */
export const joinedSessionsQueryKey = ["sessions", "joined"] as const;
export const withdrawalPreviewQueryKey = (sessionId: string) => ["sessions", "withdrawal-preview", sessionId] as const;
/** Every wallet query; a withdrawal changes the player's balances. */
export const walletQueryKey = ["wallet"] as const;
