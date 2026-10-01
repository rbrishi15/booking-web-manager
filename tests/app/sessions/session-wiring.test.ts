import { afterEach, expect, test, vi } from "vitest";
import { CreateSessions } from "@/use-cases/sessions/CreateSessions";
import { createSessionDependencies } from "@/use-case-config/sessions";

afterEach(() => vi.unstubAllEnvs());

test("configured assembly creates separate real use cases for each submission", () => {
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "local-test-key");
  const dependencies = createSessionDependencies();
  const first = dependencies.createForSubmission({ idempotencyKey: "first" });
  const second = dependencies.createForSubmission({ idempotencyKey: "second" });
  expect(first).toBeInstanceOf(CreateSessions);
  expect(second).toBeInstanceOf(CreateSessions);
  expect(first).not.toBe(second);
});
