"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { TopUpPanel } from "./_components/top-up-panel";
import { WalletView } from "./_components/wallet-view";
import { createTopUpTransport, readPublishableKey } from "./top-up-transport";
import { walletTransport } from "./wallet-transport";
import { useWalletScreen, walletQueryKeys } from "./wallet-queries";

const publishableKey = readPublishableKey();

/** The webhook credits the wallet shortly after Stripe confirms; refresh a few times to show it. */
const REFRESH_AFTER_PAYMENT_MS = [0, 3_000, 8_000];

/**
 * UC1-05: the signed-in user's wallet. The page is the controller: it connects the wallet API
 * (through React Query) to the display-only WalletView. Middleware and the layout require a login.
 */
export default function WalletPage() {
  const queryClient = useQueryClient();
  const topUpTransport = useMemo(
    () => (publishableKey ? createTopUpTransport(publishableKey) : undefined),
    [],
  );
  const refreshAfterPayment = () => {
    for (const delay of REFRESH_AFTER_PAYMENT_MS)
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: walletQueryKeys.all }), delay);
  };
  return (
    <WalletView
      {...useWalletScreen(walletTransport)}
      topUp={topUpTransport && <TopUpPanel transport={topUpTransport} onPaid={refreshAfterPayment} />}
    />
  );
}
