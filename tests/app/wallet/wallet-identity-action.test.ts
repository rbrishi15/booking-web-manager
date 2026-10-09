import { beforeEach, expect, test, vi } from "vitest";
import { readWalletIdentity } from "@/app/wallet/wallet-identity-action";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const getUser = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser } } as never);
});

test("creates a request-cookie client for every identity check", async () => {
  getUser.mockResolvedValueOnce({ data: { user: { id: "A" } }, error: null })
    .mockResolvedValueOnce({ data: { user: { id: "B" } }, error: null });
  expect(await readWalletIdentity()).toBe("A");
  expect(await readWalletIdentity()).toBe("B");
  expect(createClient).toHaveBeenCalledTimes(2);
});

test("distinguishes expired cookies from provider outages", async () => {
  getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 401 } });
  expect(await readWalletIdentity()).toBeNull();
  const outage = { status: 503 };
  getUser.mockResolvedValueOnce({ data: { user: null }, error: outage });
  await expect(readWalletIdentity()).rejects.toBe(outage);
});
