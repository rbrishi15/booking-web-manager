import { z } from "zod";

export interface SessionServerSettings {
  readonly databaseUrl: string;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const tlsModes = new Set(["require", "verify-ca", "verify-full"]);

function isLoopback(hostname: string): boolean {
  return loopbackHosts.has(hostname.toLowerCase());
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

const environmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => /^postgres(?:ql)?:\/\//.test(value))
    .refine((value) => {
      const url = parseUrl(value);
      if (!url) return false;
      // pg applies the last query value and allows it to override the URI host.
      const hostname = url.searchParams.getAll("host").at(-1) ?? url.hostname;
      const sslmode = url.searchParams.getAll("sslmode").at(-1) ?? "";
      return isLoopback(hostname) || tlsModes.has(sslmode);
    }, { message: "Non-local database connections must use TLS" }),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value))
    .refine((value) => {
      const url = parseUrl(value);
      return url !== undefined && (url.protocol === "https:" || isLoopback(url.hostname));
    }, { message: "Non-local Supabase URLs must use HTTPS" }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(1),
});

/** Validate server configuration before the app assembles session dependencies. */
export function readSessionServerSettings(
  environment: NodeJS.ProcessEnv = process.env,
): SessionServerSettings {
  const parsed = environmentSchema.parse(environment);
  return {
    databaseUrl: parsed.DATABASE_URL,
    supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}
