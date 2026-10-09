import type { WalletApiDependencies } from "@/app/wallet/dependencies";
import { beforeEach, describe, expect, test, vi } from "vitest";

const configuration = vi.hoisted(() => ({
  createWalletDependencies: vi.fn<() => WalletApiDependencies>(),
}));

vi.mock("@/use-case-config/wallet", () => configuration);

function assembledDependencies(): WalletApiDependencies {
  return {
    authenticate: async () => null,
    getWalletSummary: async () => {
      throw new Error("unimplemented");
    },
    listTransactions: async () => {
      throw new Error("unimplemented");
    },
    createTopUpIntent: async () => {
      throw new Error("unimplemented");
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  configuration.createWalletDependencies.mockReset();
  configuration.createWalletDependencies.mockImplementation(assembledDependencies);
});

describe("wallet server dependencies", () => {
  test("concurrent first callers receive the same assembled dependencies", async () => {
    const { getWalletDependencies } = await import(
      "@/app/wallet/server-dependencies"
    );

    const [first, concurrent] = await Promise.all([
      getWalletDependencies(),
      getWalletDependencies(),
    ]);

    expect(concurrent).toBe(first);
    expect(configuration.createWalletDependencies).toHaveBeenCalledOnce();
  });

  test("warm callers reuse successfully assembled dependencies", async () => {
    const { getWalletDependencies } = await import(
      "@/app/wallet/server-dependencies"
    );
    const first = await getWalletDependencies();
    const subsequent = await getWalletDependencies();

    expect(subsequent).toBe(first);
    expect(configuration.createWalletDependencies).toHaveBeenCalledOnce();
  });

  test("concurrent callers share an assembly failure and can retry setup", async () => {
    configuration.createWalletDependencies.mockImplementation(() => {
      throw new Error("wallet-assembly-failure");
    });
    const { getWalletDependencies } = await import(
      "@/app/wallet/server-dependencies"
    );

    const [first, concurrent] = await Promise.allSettled([
      getWalletDependencies(),
      getWalletDependencies(),
    ]);

    expect(first.status).toBe("rejected");
    expect(concurrent.status).toBe("rejected");
    if (first.status !== "rejected" || concurrent.status !== "rejected") {
      throw new Error("Both callers must observe the initialization failure");
    }
    expect(first.reason).toMatchObject({ message: "wallet-assembly-failure" });
    expect(concurrent.reason).toBe(first.reason);
    expect(configuration.createWalletDependencies).toHaveBeenCalledOnce();

    configuration.createWalletDependencies.mockImplementation(
      assembledDependencies,
    );
    const recovered = await getWalletDependencies();

    expect(await getWalletDependencies()).toBe(recovered);
    expect(configuration.createWalletDependencies).toHaveBeenCalledTimes(2);
  });
});
