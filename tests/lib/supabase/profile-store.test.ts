import { describe, expect, test, vi } from "vitest";
import { SupabaseProfileStore } from "@/lib/supabase/profile-store";

const changes = { displayName: "Marcus Lim", preferredSports: ["Tennis"], preferredRegions: ["West"] };

function storeAnswering(error: { code: string; message: string } | null) {
  const rpc = vi.fn(async () => ({ data: null, error }));
  return { rpc, store: new SupabaseProfileStore({ rpc, from: vi.fn() } as never) };
}

// Owner: Joseph (Jolingoes) — /lib/supabase (UC1-03, ADR-0021)
describe("SupabaseProfileStore.saveForActiveUser", () => {
  test("sends the user ID to the guarded update_profile write", async () => {
    // Arrange
    const { rpc, store } = storeAnswering(null);

    // Act
    await store.saveForActiveUser("marcus", { ...changes, handle: "marcus_lim" });

    // Assert
    expect(rpc).toHaveBeenCalledExactlyOnceWith("update_profile", {
      p_user_id: "marcus", p_display_name: "Marcus Lim", p_preferred_sports: ["Tennis"], p_preferred_regions: ["West"],
      p_handle: "marcus_lim",
    });
  });

  test("omits p_handle when the edit leaves the user ID unchanged", async () => {
    // Arrange
    const { rpc, store } = storeAnswering(null);

    // Act
    await store.saveForActiveUser("marcus", changes);

    // Assert
    expect(rpc).toHaveBeenCalledExactlyOnceWith("update_profile", {
      p_user_id: "marcus", p_display_name: "Marcus Lim", p_preferred_sports: ["Tennis"], p_preferred_regions: ["West"],
    });
  });

  test("reports a user ID held by another account as HANDLE_TAKEN", async () => {
    // Arrange
    const { store } = storeAnswering({ code: "PRF04", message: "The user ID is already taken" });

    // Act & Assert
    await expect(store.saveForActiveUser("marcus", { ...changes, handle: "taken_id" }))
      .rejects.toMatchObject({ name: "DomainError", code: "HANDLE_TAKEN" });
  });

  test("keeps an unexpected database failure as an infrastructure error", async () => {
    // Arrange
    const { store } = storeAnswering({ code: "08006", message: "connection failure" });

    // Act & Assert
    await expect(store.saveForActiveUser("marcus", changes)).rejects.toThrow("Profile changes could not be saved");
  });
});
