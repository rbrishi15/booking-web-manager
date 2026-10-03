import { z } from "zod";

export function readVenueSettings(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return undefined;
  const supabaseUrl = z.string().url().refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || (parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
  }).parse(url);
  const email = environment.ONEMAP_API_EMAIL?.trim();
  const password = environment.ONEMAP_API_PASSWORD;
  const accessToken = environment.ONEMAP_API_TOKEN?.trim() || undefined;
  return { supabaseUrl, supabaseAnonKey: key, accessToken,
    credentials: email && password?.trim() ? { email: z.string().email().parse(email), password } : undefined };
}
