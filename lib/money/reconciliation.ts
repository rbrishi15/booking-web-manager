import type { UUID } from "@/domain";
import { LedgerError, rethrowDatabaseError } from "./errors";
import type { SqlExecutor, SqlRow } from "./sql";

/**
 * The hourly reconciliation job.
 *
 * Every check lives in SQL, in `reconcile_ledger()`. This module runs it and
 * turns the result into something a route handler or a scheduled job can read.
 * Keeping the arithmetic in the database means the same answer comes back
 * whether it is asked for by pg_cron, by a route, or by a person at a psql
 * prompt during a demo.
 *
 * Nothing here repairs anything. A ledger that quietly corrects itself cannot
 * be audited, and the whole point of the subsystem is that it can be.
 *
 * Nothing here calls Stripe either. The provider comparison reads the most
 * recent row of `provider_balance_snapshots`, which the payments role writes;
 * see CLAUDE.md rule 3.
 */

export interface ReconciliationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface ReconciliationReport {
  readonly runId: UUID;
  readonly ranAt: Date;
  readonly passed: boolean;
  readonly checks: readonly ReconciliationCheck[];
}

/** Raised by `assertReconciled` when the ledger does not balance. */
export class ReconciliationFailure extends Error {
  constructor(readonly report: ReconciliationReport) {
    super(
      `Ledger reconciliation ${report.runId} failed: ${report.checks
        .filter((check) => !check.passed)
        .map((check) => check.name)
        .join(", ")}`,
    );
    this.name = "ReconciliationFailure";
  }
}

/**
 * Runs every check without recording the outcome.
 *
 * Read-only, so it is safe to expose on an internal status page or to call
 * from a test between operations.
 */
export async function inspectLedger(
  sql: SqlExecutor,
): Promise<readonly ReconciliationCheck[]> {
  const rows = await query<CheckRow>(
    sql,
    "select check_name, passed, detail from reconcile_ledger()",
    [],
  );

  return rows.map((row) => ({
    name: String(row.check_name),
    passed: row.passed === true,
    detail: readDetail(row.detail),
  }));
}

/**
 * Runs every check and records the outcome in `reconciliation_runs`.
 *
 * This is what the hourly schedule calls. The run is stored whether or not it
 * passed, because a failure is the thing most worth having a record of.
 */
export async function runReconciliation(
  sql: SqlExecutor,
): Promise<ReconciliationReport> {
  const started = await query<{ run_id: unknown }>(
    sql,
    "select public.run_reconciliation() as run_id",
    [],
  );

  const runId = started[0]?.run_id;
  if (typeof runId !== "string" || runId.trim() === "") {
    throw new LedgerError(
      "INVARIANT_VIOLATED",
      "run_reconciliation() did not return a run identifier",
    );
  }

  const rows = await query<RunRow>(
    sql,
    `select run_id, ran_at, passed, checks
       from reconciliation_runs
      where run_id = $1`,
    [runId],
  );

  const row = rows[0];
  if (row === undefined) {
    throw new LedgerError(
      "INVARIANT_VIOLATED",
      `Reconciliation run ${runId} was not recorded`,
    );
  }

  return {
    runId,
    ranAt: row.ran_at instanceof Date ? row.ran_at : new Date(String(row.ran_at)),
    passed: row.passed === true,
    checks: readChecks(row.checks),
  };
}

/**
 * Runs reconciliation and throws unless every check passed.
 *
 * Useful at the end of an integration test, where a silent drift would
 * otherwise go unnoticed until the next hour.
 */
export async function assertReconciled(
  sql: SqlExecutor,
): Promise<ReconciliationReport> {
  const report = await runReconciliation(sql);
  if (!report.passed) throw new ReconciliationFailure(report);
  return report;
}

interface CheckRow extends SqlRow {
  readonly check_name: unknown;
  readonly passed: unknown;
  readonly detail: unknown;
}

interface RunRow extends SqlRow {
  readonly run_id: unknown;
  readonly ran_at: unknown;
  readonly passed: unknown;
  readonly checks: unknown;
}

function readChecks(value: unknown): readonly ReconciliationCheck[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;

  if (!Array.isArray(parsed)) {
    throw new LedgerError(
      "INVARIANT_VIOLATED",
      "reconciliation_runs.checks is not an array",
    );
  }

  return parsed.map((entry) => {
    const record = entry as Record<string, unknown>;
    return {
      name: String(record.check),
      passed: record.passed === true,
      detail: readDetail(record.detail),
    };
  });
}

function readDetail(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

async function query<TRow extends SqlRow>(
  sql: SqlExecutor,
  text: string,
  values: readonly unknown[],
): Promise<readonly TRow[]> {
  try {
    return await sql.query<TRow>(text, values);
  } catch (error) {
    rethrowDatabaseError(error);
  }
}
