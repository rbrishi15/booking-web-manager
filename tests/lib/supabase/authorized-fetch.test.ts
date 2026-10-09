import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchAsSignedInUser, SignInUnavailableError } from "@/lib/supabase/authorized-fetch";
import { createClient } from "@/lib/supabase/client";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

const getSession = vi.fn();
const fetcher = vi.fn<typeof fetch>();

describe("fetchAsSignedInUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: "player-token" } }, error: null });
    vi.mocked(createClient).mockReturnValue({ auth: { getSession } } as unknown as ReturnType<typeof createClient>);
    fetcher.mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
  });

  afterEach(() => vi.unstubAllGlobals());

  test("attaches the current access token and keeps the caller's request options", async () => {
    // Arrange
    const signal = new AbortController().signal;

    // Act
    const response = await fetchAsSignedInUser("/api/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", signal });

    // Assert
    expect(response?.ok).toBe(true);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/wallet");
    expect(init).toMatchObject({ method: "POST", body: "{}", cache: "no-store", signal });
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer player-token");
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("returns null without calling the API when nobody is signed in", async () => {
    // Arrange
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null });

    // Act & Assert
    expect(await fetchAsSignedInUser("/api/wallet")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([
    ["returns an error", () => getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error("refresh failed") })],
    ["throws", () => getSession.mockRejectedValueOnce(new Error("storage unavailable"))],
  ])("reports a login that cannot be read when Supabase %s", async (_name, arrange) => {
    // Arrange
    arrange();

    // Act & Assert
    await expect(fetchAsSignedInUser("/api/wallet")).rejects.toBeInstanceOf(SignInUnavailableError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("lets network failures through unchanged so callers can treat them as unconfirmed", async () => {
    // Arrange
    const offline = new TypeError("Failed to fetch");
    fetcher.mockRejectedValueOnce(offline);

    // Act & Assert
    await expect(fetchAsSignedInUser("/api/wallet")).rejects.toBe(offline);
  });
});
