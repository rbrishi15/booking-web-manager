import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Never print the status payload: it contains local service credentials.
const status = JSON.parse(execFileSync("supabase", ["status", "--output", "json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
}));
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
for (const key of ["API_URL", "DB_URL"]) {
  if (!status[key] || !loopback.has(new URL(status[key]).hostname)) {
    throw new Error("This command only configures a local Supabase stack.");
  }
}
const values = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  DATABASE_URL: status.DB_URL,
  SESSION_TEST_DATABASE_URL: status.DB_URL,
};
for (const [key, value] of Object.entries(values)) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Local Supabase did not provide ${key}.`);
  }
}
for (const file of [".env.local", ".env.test.local"]) {
  let content = existsSync(file) ? readFileSync(file, "utf8") : "";
  // Preserve unrelated settings and refuse to replace an existing hosted setup.
  const existingUrl = content.match(/^NEXT_PUBLIC_SUPABASE_URL=["']?([^\s"']+)/m)?.[1];
  if (existingUrl && !loopback.has(new URL(existingUrl).hostname)) {
    throw new Error(`${file} points at a hosted project; move it aside before configuring local Supabase.`);
  }
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    content = pattern.test(content)
      ? content.replace(pattern, () => line)
      : `${content.trimEnd()}\n${line}\n`;
  }
  writeFileSync(file, content.trimStart(), { mode: 0o600 });
}
console.log("Configured .env.local and .env.test.local for local Supabase. Credentials were not printed.");
