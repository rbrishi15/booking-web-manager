import { describe, expect, test, vi } from "vitest";
import { requireUserId } from "@/app/http/require-user-id";
import { isRequestFailure } from "@/app/http/request-failure";
import { DiscoveryApiUnavailableError } from "@/app/discover/discovery-api-unavailable";
import { SessionApiUnavailableError } from "@/app/sessions/session-api-unavailable";
import { DomainError, type UUID } from "@/domain";

const aliceId = "10000000-0000-4000-8000-000000000001";
const bobId = "10000000-0000-4000-8000-000000000002";
type Authenticate = (request: Request) => Promise<UUID | null>;

describe("requireUserId", () => {
  test("verifies each request afresh with its supplied authenticator", async () => {
    const authenticate = vi.fn<Authenticate>()
      .mockResolvedValueOnce(aliceId).mockResolvedValueOnce(bobId);
    const first = new Request("http://localhost/first");
    const second = new Request("http://localhost/second");

    expect(await requireUserId(first, authenticate)).toBe(aliceId);
    expect(await requireUserId(second, authenticate)).toBe(bobId);
    expect(authenticate.mock.calls).toEqual([[first], [second]]);
  });

  test("returns the known unauthenticated failure for missing identity", async () => {
    const authenticate = vi.fn<Authenticate>().mockResolvedValue(null);

    await expect(requireUserId(new Request("http://localhost/sessions"), authenticate))
      .rejects.toEqual({
        kind: "request-failure", status: 401, code: "UNAUTHENTICATED", message: "Authentication is required",
      });
    expect(authenticate).toHaveBeenCalledOnce();
  });

  test("keeps malformed provider identities separate from client input failures", async () => {
    const authenticate = vi.fn<Authenticate>().mockResolvedValue("invalid-uuid");

    const failure: unknown = await requireUserId(new Request("http://localhost/sessions"), authenticate)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(isRequestFailure(failure)).toBe(false);
  });

  describe.each(["synchronous", "asynchronous"])("%s authentication failures", (timing) => {
    test.each([
      { name: "account rejection", failure: new DomainError("INACTIVE_ACCOUNT", "Account denied") },
      { name: "missing account", failure: new DomainError("NOT_FOUND", "User was not found") },
      { name: "creation unavailable", failure: new SessionApiUnavailableError() },
      { name: "discovery unavailable", failure: new DiscoveryApiUnavailableError() },
      { name: "provider outage", failure: new Error("private provider details") },
    ])("preserves $name for the endpoint's response mapper", async ({ failure }) => {
      const authenticate = vi.fn<Authenticate>(() => {
        if (timing === "synchronous") throw failure;
        return Promise.reject(failure);
      });

      await expect(requireUserId(new Request("http://localhost/sessions"), authenticate)).rejects.toBe(failure);
      expect(authenticate).toHaveBeenCalledOnce();
    });
  });
});
