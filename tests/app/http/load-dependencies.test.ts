import { describe, expect, test, vi } from "vitest";
import { loadDependencies } from "@/app/http/load-dependencies";
import { invalidRequest, isRequestFailure, unauthenticated } from "@/app/http/request-failure";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { SessionApiUnavailableError } from "@/app/sessions/session-api-unavailable";
import { DomainError } from "@/domain";

describe("loadDependencies", () => {
  test("calls the supplied loader once per invocation and leaves caching to the loader", async () => {
    const first = { name: "first" };
    const second = { name: "second" };
    const load = vi.fn<() => Promise<{ name: string }>>()
      .mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    expect(await loadDependencies(load)).toBe(first);
    expect(await loadDependencies(load)).toBe(second);
    expect(load).toHaveBeenCalledTimes(2);
  });

  describe.each(["synchronous", "asynchronous"])("%s setup failures", (timing) => {
    test.each([
      { name: "domain rejection", cause: new DomainError("INACTIVE_ACCOUNT", "private setup failure") },
      { name: "creation unavailable", cause: new SessionApiUnavailableError() },
      { name: "discovery unavailable", cause: new DiscoveryApiUnavailableError() },
      { name: "invalid request", cause: invalidRequest("private setup failure") },
      { name: "unauthenticated", cause: unauthenticated() },
    ])("normalizes $name into an ordinary error and retains its cause", async ({ cause }) => {
      const load = vi.fn<() => Promise<never>>(() => {
        if (timing === "synchronous") throw cause;
        return Promise.reject(cause);
      });

      const failure: unknown = await loadDependencies(load).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBe(cause);
      expect(failure).toMatchObject({ cause });
      expect(isRequestFailure(failure)).toBe(false);
      if (!(failure instanceof Error)) throw new Error("Expected an infrastructure error");
      expect(failure.constructor).toBe(Error);
      expect(load).toHaveBeenCalledOnce();
    });
  });
});
