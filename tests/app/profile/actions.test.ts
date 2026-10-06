import { beforeEach, describe, expect, test, vi } from "vitest";
import { updateProfile } from "@/app/profile/actions";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  revalidate: vi.fn(),
  getUser: vi.fn(),
  getStatus: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    // The legacy direct write has no active-account guard.
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.getStatus }) }),
      update: () => ({ eq: async () => ({ error: null, count: 1 }) }),
    }),
  }),
}));

describe("UC1-03 profile action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "alice" } } });
    mocks.getStatus.mockResolvedValue({ data: { account_status: "ACTIVE" }, error: null });
    mocks.rpc.mockResolvedValue({ error: null });
  });

  test("refuses a profile change when the account is inactive at the persistence seam", async () => {
    // Arrange
    mocks.rpc.mockResolvedValue({ error: { code: "PRF01", message: "Inactive account" } });

    // Act
    const result = await updateProfile({ status: "idle" }, validForm());

    // Assert
    expect(result.status).toBe("error");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  test("saves only the authenticated user's validated profile through the guarded writer", async () => {
    // Arrange
    const form = validForm();
    form.set("userId", "someone-else");

    // Act
    const result = await updateProfile({ status: "idle" }, form);

    // Assert
    expect(result.status).toBe("saved");
    expect(mocks.rpc).toHaveBeenCalledWith("update_profile", {
      p_user_id: "alice", p_display_name: "Alice", p_preferred_sports: ["Tennis"], p_preferred_regions: ["West"],
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });
});

function validForm(): FormData {
  const form = new FormData();
  form.set("displayName", " Alice ");
  form.append("preferredSports", "Tennis");
  form.append("preferredRegions", "West");
  return form;
}
