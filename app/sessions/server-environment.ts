import { z } from "zod";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const tlsModes = new Set(["require", "verify-ca", "verify-full"]);

const settingsSchema = z.object({
  DATABASE_URL: z
    .string()
    .trim()
    .url()
    .refine((value) => {
      const url = new URL(value);
      const host = url.searchParams.getAll("host").at(-1) ?? url.hostname;
      const sslmode = url.searchParams.getAll("sslmode").at(-1) ?? "";
      return (
        ["postgres:", "postgresql:"].includes(url.protocol) &&
        (loopbackHosts.has(host.toLowerCase()) || tlsModes.has(sslmode))
      );
    }),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .trim()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          loopbackHosts.has(url.hostname.toLowerCase()))
      );
    }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(1),
});

export interface SessionServerSettings {
  readonly databaseUrl: string;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
}

/** Missing configuration is deliberate unavailability; invalid configuration is a setup failure. */
export function readSessionServerSettings(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SessionServerSettings | undefined {
  const names = [
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];
  if (names.some((name) => !environment[name]?.trim())) return undefined;
  const settings = settingsSchema.parse(environment);
  return {
    databaseUrl: settings.DATABASE_URL,
    supabaseUrl: settings.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: settings.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}
