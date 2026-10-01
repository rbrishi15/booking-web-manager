import { afterEach, describe, expect, test, vi } from "vitest";
import { ZodError } from "zod";
import { readSessionServerSettings } from "@/app/sessions/server-environment";

afterEach(() => vi.unstubAllEnvs());

describe("session server environment", () => {
  test.each(["postgres", "postgresql"])(
    "maps valid %s settings into the plain server configuration",
    (protocol) => {
      // Arrange
      const environment = {
        ...validEnvironment(),
        DATABASE_URL: `${protocol}://user:password@localhost:54322/postgres`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "  public-anon-key  ",
        UNRELATED_SECRET: "must-not-be-forwarded",
      };

      // Act
      const settings = readSessionServerSettings(environment);

      // Assert
      expect(settings).toEqual({
        databaseUrl: environment.DATABASE_URL,
        supabaseUrl: "https://supabase.example.test",
        supabaseAnonKey: "public-anon-key",
      });
    },
  );

  test("reads process.env when no explicit environment is supplied", () => {
    // Arrange
    const environment = validEnvironment();
    for (const [name, value] of Object.entries(environment))
      vi.stubEnv(name, value);

    // Act
    const settings = readSessionServerSettings();

    // Assert
    expect(settings).toEqual({
      databaseUrl: environment.DATABASE_URL,
      supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  });

  test.each([
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ])("rejects missing %s", (name) => {
    // Arrange
    const environment = { ...validEnvironment(), [name]: undefined };

    // Act & Assert
    expect(() => readSessionServerSettings(environment)).toThrow(ZodError);
  });

  test.each([
    ["DATABASE_URL", "not-a-database-url"],
    ["DATABASE_URL", "https://database.example.test"],
    ["NEXT_PUBLIC_SUPABASE_URL", "not-a-supabase-url"],
    ["NEXT_PUBLIC_SUPABASE_URL", "postgres://database.example.test/postgres"],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "   "],
  ])("rejects invalid %s value %s", (name, value) => {
    // Arrange
    const environment = { ...validEnvironment(), [name]: value };

    // Act & Assert
    expect(() => readSessionServerSettings(environment)).toThrow(ZodError);
  });

  test.each(["localhost", "127.0.0.1", "[::1]"])(
    "accepts HTTP and non-TLS database connections on loopback host %s",
    (hostname) => {
      // Arrange
      const environment = {
        ...validEnvironment(),
        DATABASE_URL: `postgresql://user:password@${hostname}:54322/postgres`,
        NEXT_PUBLIC_SUPABASE_URL: `http://${hostname}:54321`,
      };

      // Act
      const settings = readSessionServerSettings(environment);

      // Assert
      expect(settings.databaseUrl).toBe(environment.DATABASE_URL);
      expect(settings.supabaseUrl).toBe(environment.NEXT_PUBLIC_SUPABASE_URL);
    },
  );

  test.each(["require", "verify-ca", "verify-full"])(
    "accepts hosted connections with HTTPS and database sslmode=%s",
    (sslmode) => {
      // Arrange
      const environment = {
        ...validEnvironment(),
        DATABASE_URL: `postgresql://user:password@database.example.test/postgres?sslmode=${sslmode}`,
      };

      // Act
      const settings = readSessionServerSettings(environment);

      // Assert
      expect(settings.databaseUrl).toBe(environment.DATABASE_URL);
      expect(settings.supabaseUrl).toBe("https://supabase.example.test");
    },
  );

  test.each([
    "http://supabase.example.test",
    "http://localhost.example.test:54321",
    "http://localhost@supabase.example.test",
    "http://192.168.1.2:54321",
  ])("rejects a non-loopback Supabase URL without HTTPS: %s", (url) => {
    // Arrange
    const environment = { ...validEnvironment(), NEXT_PUBLIC_SUPABASE_URL: url };

    // Act & Assert
    expect(() => readSessionServerSettings(environment)).toThrow(
      "Non-local Supabase URLs must use HTTPS",
    );
  });

  test.each([undefined, "", "disable", "allow", "prefer", "no-verify"])(
    "rejects a non-loopback database URL with sslmode=%s",
    (sslmode) => {
      // Arrange
      const query = sslmode === undefined ? "" : `?sslmode=${sslmode}`;
      const environment = {
        ...validEnvironment(),
        DATABASE_URL: `postgresql://user:password@database.example.test/postgres${query}`,
      };

      // Act & Assert
      expect(() => readSessionServerSettings(environment)).toThrow(
        "Non-local database connections must use TLS",
      );
    },
  );

  test.each([
    "postgresql://user:password@localhost/postgres?host=database.example.test",
    "postgresql://user:password@localhost/postgres?host=localhost&host=database.example.test",
    "postgresql://user:password@database.example.test/postgres?sslmode=require&sslmode=disable",
  ])("rejects query parameters that select a remote host without TLS: %s", (url) => {
    // Arrange
    const environment = { ...validEnvironment(), DATABASE_URL: url };

    // Act & Assert
    expect(() => readSessionServerSettings(environment)).toThrow(
      "Non-local database connections must use TLS",
    );
  });
});

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:password@localhost:54322/postgres",
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
  };
}
