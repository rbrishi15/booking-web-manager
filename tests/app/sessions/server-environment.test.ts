import { describe, expect, test } from "vitest";
import { readSessionServerSettings } from "@/app/sessions/server-environment";

const environment = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-key",
};

describe("session server settings", () => {
  test.each([
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ])("retains deliberate unavailability without %s", (name) => {
    expect(
      readSessionServerSettings({ ...environment, [name]: undefined }),
    ).toBeUndefined();
    expect(
      readSessionServerSettings({ ...environment, [name]: "  " }),
    ).toBeUndefined();
  });

  test("accepts loopback configuration and remote TLS", () => {
    expect(readSessionServerSettings(environment)).toEqual({
      databaseUrl: environment.DATABASE_URL,
      supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: "local-key",
    });
    expect(
      readSessionServerSettings({
        ...environment,
        DATABASE_URL:
          "postgresql://user:password@db.example.test/postgres?sslmode=require",
        NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
      }),
    ).toBeDefined();
  });

  test.each([
    { DATABASE_URL: "malformed" },
    { DATABASE_URL: "https://db.example.test" },
    { DATABASE_URL: "postgresql://user:password@db.example.test/postgres" },
    { DATABASE_URL: "postgresql://localhost/postgres?host=db.example.test" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://supabase.example.test" },
  ])("rejects malformed or insecure configured endpoints %j", (override) => {
    expect(() =>
      readSessionServerSettings({ ...environment, ...override }),
    ).toThrow();
  });
});
