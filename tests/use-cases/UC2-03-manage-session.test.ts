import { describe, test } from "vitest";

// Owner: Neoh (liang799) — /app/sessions
describe("UC2-03 Manage Session", () => {
  describe("UC2-03a Toggle Public/Private", () => {
    test.todo(
      "toggles session visibility and it's reflected in discovery within 3s",
    );
  });

  describe("UC2-03b Remove Participant", () => {
    test.todo(
      "removes a participant and reverses their held funds appropriately",
    );
    test.todo("frees the vacated slot for waitlist promotion");
  });
});
