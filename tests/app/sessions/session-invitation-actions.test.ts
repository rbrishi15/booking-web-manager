import { beforeEach, expect, test, vi } from "vitest";
import { loadSessionInvitationOptions } from "@/app/sessions/session-invitation-actions";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createManageSessionInvitations } from "@/use-case-config/session-invitations";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/use-case-config/session-invitations", () => ({ createManageSessionInvitations: vi.fn() }));

const sessionId = "20000000-0000-4000-8000-000000000001";
beforeEach(() => vi.resetAllMocks());

test("unavailable invitation reads return an actionable failure instead of crashing the participant page", async () => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "host" } as Awaited<ReturnType<typeof getCurrentUser>>);
  vi.mocked(createManageSessionInvitations).mockImplementation(() => { throw new Error("Database unavailable"); });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await loadSessionInvitationOptions(sessionId)).toEqual({ status: "error", message: "Could not load invitations and groups. Try again." });
});

test("malformed sessions and signed-out visitors cannot read private invitation options", async () => {
  expect(await loadSessionInvitationOptions("invalid")).toMatchObject({ status: "error" });
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  expect(await loadSessionInvitationOptions(sessionId)).toMatchObject({ status: "error" });
  expect(createManageSessionInvitations).not.toHaveBeenCalled();
});
