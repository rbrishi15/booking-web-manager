import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

const eslint = new ESLint();

async function persistenceMessages(source: string, filePath = "use-case-config/example.ts") {
  const [result] = await eslint.lintText(source, { filePath });
  return result!.messages.filter((message) => message.ruleId === "architecture/no-config-persistence");
}

describe("dependency assembly excludes persistence operations", () => {
  test.each([
    'const sql = { query: async (text, values) => (await getPool().query(text, values)).rows };',
    'async function readHolds() { return sql.query("select * from hold_balances"); }',
    'const search = () => client.from("sessions").select("*");',
    'const save = () => client.rpc("update_profile", input);',
    'const read = () => pool["query"]("select 1");',
    'const save = () => client?.rpc("update_profile", input);',
  ])("rejects persistence hidden in configuration: %s", async (source) => {
    expect(await persistenceMessages(source)).toHaveLength(1);
  });

  test.each([
    'const settings = readSessionServerSettings(); const reader = new PostgresWalletReader(createPostgresExecutor(settings.databaseUrl));',
    'const authenticate = createAuthenticator(settings.url, settings.key);',
    'const unavailable = async () => { throw new UnavailableError(); };',
    'const createForSubmission = (submission) => new CreateSessions(new Transaction(getPool, submission));',
    'const clock = { now: () => new Date() };',
    'const secrets = Array.from(settings.secrets);',
    'const bytes = Buffer.from(settings.value);',
  ])("allows dependency construction: %s", async (source) => {
    expect(await persistenceMessages(source)).toHaveLength(0);
  });

  test("allows persistence in its infrastructure implementation", async () => {
    expect(await persistenceMessages('const read = () => pool.query("select 1");', "lib/wallet/example.ts")).toHaveLength(0);
  });
});
