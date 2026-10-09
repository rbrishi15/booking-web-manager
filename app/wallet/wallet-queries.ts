"use client";

import { useEffect, useRef, useState } from "react";
import { observeWalletIdentity, type WalletIdentityReader } from "./wallet-identity";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WalletLoadState, WalletViewProps } from "./_components/wallet-view";
import type { WalletLoad, WalletSummary, WalletTransactionsPage, WalletTransport } from "./wallet-transport";

/** A wallet API failure, carrying the API's error code so the screen can offer Log in when needed. */
export class WalletLoadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "WalletLoadError";
  }
}

const NETWORK_MESSAGE = "We couldn't load your wallet. Check your connection and try again.";

/** React Query treats a thrown error as failure, so turn the transport's error result into one. */
async function unwrap<T>(load: () => Promise<WalletLoad<T>>): Promise<T> {
  let result: WalletLoad<T>;
  try {
    result = await load();
  } catch {
    throw new WalletLoadError("NETWORK_ERROR", NETWORK_MESSAGE);
  }
  if (result.status === "error") throw new WalletLoadError(result.code, result.message);
  return result.data;
}

function failure(error: unknown): { readonly status: "error"; readonly message: string; readonly signIn: boolean } {
  return error instanceof WalletLoadError
    ? { status: "error", message: error.message, signIn: error.code === "UNAUTHENTICATED" }
    : { status: "error", message: NETWORK_MESSAGE, signIn: false };
}

export const walletQueryKeys = {
  all: ["wallet"] as const,
  summary: ["wallet", "summary"] as const,
  transactions: ["wallet", "transactions"] as const,
};

/**
 * UC1-05: the wallet screen's data from the wallet API, shaped for WalletView. React Query owns
 * loading, errors and paging. Retry resets the wallet queries, which also cancels a Load more
 * still in flight, so an old page can never be appended to the fresh list.
 */
export function useWalletScreen(transport: WalletTransport, readIdentity: WalletIdentityReader): WalletViewProps {
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<{ userId: string | null; revision: number; failed?: boolean }>();
  const recheck = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    let previous: string | null | undefined;
    let revision = 0;
    const clear = () => {
      void queryClient.cancelQueries({ queryKey: walletQueryKeys.all });
      queryClient.removeQueries({ queryKey: walletQueryKeys.all });
    };
    const observer = observeWalletIdentity(readIdentity, (userId) => {
      if (previous === userId) return;
      previous = userId;
      clear();
      setIdentity({ userId, revision: ++revision });
    }, () => {
      previous = undefined;
      clear();
      setIdentity({ userId: null, revision: ++revision, failed: true });
    });
    recheck.current = observer.recheck;
    return () => { observer.dispose(); recheck.current = undefined; clear(); };
  }, [queryClient, readIdentity]);
  const enabled = identity?.userId != null;
  const summary = useQuery({
    queryKey: [...walletQueryKeys.summary, identity?.userId, identity?.revision],
    enabled,
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => unwrap(() => transport.loadSummary(signal)),
  });
  const transactions = useInfiniteQuery({
    queryKey: [...walletQueryKeys.transactions, identity?.userId, identity?.revision],
    enabled,
    refetchOnWindowFocus: false,
    queryFn: ({ pageParam, signal }) => unwrap(() => transport.loadTransactions(pageParam, signal)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: WalletTransactionsPage) => last.nextCursor ?? undefined,
  });

  const summaryState: WalletLoadState<WalletSummary> =
    summary.isPending ? { status: "loading" } : summary.isError ? failure(summary.error) : { status: "ready", data: summary.data };

  let history: WalletViewProps["history"];
  let moreError: string | null = null;
  if (transactions.isPending) history = { status: "loading" };
  else if (transactions.data === undefined) history = failure(transactions.error);
  else if (transactions.isError && failure(transactions.error).signIn) {
    // An expired login during Load more or a background refresh needs the same Log in action as
    // the first load, not the old transactions.
    history = failure(transactions.error);
  } else {
    // A timestamp cursor can repeat the boundary row; never show a transaction twice.
    const seen = new Set<string>();
    const items = transactions.data.pages.flatMap((page) => page.items).filter((item) =>
      seen.has(item.transactionId) ? false : (seen.add(item.transactionId), true));
    history = { status: "ready", data: { items, nextCursor: transactions.data.pages.at(-1)?.nextCursor ?? null } };
    if (transactions.isFetchNextPageError) moreError = failure(transactions.error).message;
  }

  if (!enabled) {
    const state: WalletLoadState<WalletSummary> = identity === undefined
      ? { status: "loading" }
      : { status: "error", message: identity.failed ? NETWORK_MESSAGE : "Log in again to see your wallet.", signIn: !identity.failed };
    return { summary: state, history: state, loadingMore: false, moreError: null,
      onRetry: () => recheck.current?.(), onLoadMore: () => {} };
  }

  return {
    summary: summaryState,
    history,
    loadingMore: transactions.isFetchingNextPage,
    moreError,
    onRetry: () => { void queryClient.resetQueries({ queryKey: walletQueryKeys.all }); },
    onLoadMore: () => { void transactions.fetchNextPage(); },
  };
}
