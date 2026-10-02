import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2] ?? "db";
if (!["db", "http", "all"].includes(mode))
  throw new Error("Choose db, http or all");
const migrations = "supabase/migrations";
const groupMigration = join(migrations, "0005_regular_groups.sql");
const preview = process.env.SESSION_TEST_PREREQUISITE_SQL;
if (!existsSync(groupMigration) && (!preview || !existsSync(preview))) {
  throw new Error(
    "PR #34's 0005_regular_groups.sql must reach main first. For isolated preview testing only, set SESSION_TEST_PREREQUISITE_SQL to its external SQL file; see use-case-config/README.md.",
  );
}

const directory = mkdtempSync(join(tmpdir(), "bwm-session-tests-"));
const projectId = `bwm-session-tests-${randomUUID().slice(0, 8)}`;
const supabaseDirectory = join(directory, "supabase");
mkdirSync(supabaseDirectory);
cpSync(migrations, join(supabaseDirectory, "migrations"), { recursive: true });
if (!existsSync(groupMigration)) {
  const sql = readFileSync(preview);
  writeFileSync(
    join(supabaseDirectory, "migrations", "0005_regular_groups.sql"),
    sql,
  );
  console.log(
    `Preview dependency SHA256: ${createHash("sha256").update(sql).digest("hex")}. Final acceptance requires the merged migration.`,
  );
}
writeFileSync(
  join(supabaseDirectory, "config.toml"),
  `project_id = "${projectId}"
[api]
port = 55321
[db]
port = 55322
shadow_port = 55320
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
[realtime]
enabled = false
[storage]
enabled = false
[analytics]
enabled = false
[edge_runtime]
enabled = false
[local_smtp]
enabled = false
[auth]
site_url = "http://127.0.0.1:3100"
[auth.rate_limit]
sign_in_sign_ups = 200
token_verifications = 200
[auth.email]
enable_confirmations = false
`,
);

let exitCode = 1;
try {
  console.log(
    "Starting disposable session-test Supabase on ports 55321/55322...",
  );
  try {
    execFileSync(
      "supabase",
      [
        "start",
        "--workdir",
        directory,
        "--exclude",
        "studio,postgres-meta,mailpit,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,supavisor",
      ],
      { stdio: "pipe", maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (error) {
    const log = join(directory, "startup.log");
    writeFileSync(log, String(error.stderr ?? "Supabase could not start"), {
      mode: 0o600,
    });
    throw new Error(`Supabase startup failed; private diagnostic log: ${log}`);
  }
  const status = JSON.parse(
    execFileSync(
      "supabase",
      ["status", "--workdir", directory, "--output", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  const environment = {
    ...process.env,
    SESSION_TEST_STACK_ID: projectId,
    SESSION_TEST_DATABASE_URL: status.DB_URL,
    DATABASE_URL: status.DB_URL,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    // Lookup tests use fixtures/manual entry; never call the live provider from this stack.
    ONEMAP_API_EMAIL: "",
    ONEMAP_API_PASSWORD: "",
  };
  const commands = mode === "all" ? ["db", "http"] : [mode];
  exitCode = 0;
  for (const command of commands) {
    const args =
      command === "db"
        ? [
            "exec",
            "--",
            "vitest",
            "run",
            "--config",
            "vitest.integration.config.ts",
          ]
        : ["run", "test:e2e:authenticated"];
    const result = spawnSync("npm", args, {
      env: environment,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  console.log("Removing the disposable session-test stack...");
  const stopped = spawnSync(
    "supabase",
    ["stop", "--project-id", projectId, "--no-backup"],
    { stdio: "pipe" },
  );
  if (stopped.status !== 0) {
    console.error(
      `Could not stop ${projectId}; remove it with supabase stop --project-id ${projectId} --no-backup`,
    );
    exitCode = 1;
  } else if (!existsSync(join(directory, "startup.log"))) {
    rmSync(directory, { recursive: true, force: true });
  }
}
process.exitCode = exitCode;
