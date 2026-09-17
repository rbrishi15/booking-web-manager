/**
 * The wallet ledger.
 *
 * Owner: Harrison (harr008).
 *
 * `Money` itself stays in `/domain`, where the business rules that reason about
 * amounts can reach it without depending on infrastructure. What lives here is
 * everything between that type and the database: splitting money without losing
 * cents, the codec across the `bigint` boundary, the adapters behind the ledger
 * ports, idempotency, and reconciliation.
 *
 * The seam with the domain layer: the ledger interface and the rules that call
 * it are defined in `/domain` and `/use-cases`; the schema, the implementation
 * behind those interfaces, and the invariants are defined here.
 */

export {
  allocate,
  bookingShare,
  formatSgd,
  sumOf,
  type BookingShare,
} from "./allocation";

export {
  fromDatabaseCents,
  fromOptionalDatabaseCents,
  toDatabaseCents,
} from "./cents";

export { PLATFORM_HOLDING_ACCOUNT_ID } from "./constants";

export {
  LedgerError,
  isRetryable,
  rethrowDatabaseError,
  translateDatabaseError,
  type LedgerErrorCode,
} from "./errors";

export {
  PostgresIdempotencyStore,
  fingerprintOf,
  type IdempotencyClaim,
  type IdempotencyRequest,
} from "./idempotency";

export {
  PostgresLedgerReader,
  type SessionHeldTotal,
  type WalletHistoryQuery,
  type WalletHistoryReadPort,
} from "./ledger-read-adapter";

export {
  LedgerUnitOfWork,
  type LedgerUnitOfWorkOptions,
  type LedgerWorkContext,
  type LedgerWorkRequest,
} from "./ledger-unit-of-work";

export {
  PostgresLedgerWriter,
  type PayoutDebit,
  type TopUpCredit,
} from "./ledger-write-adapter";

export {
  ReconciliationFailure,
  assertReconciled,
  inspectLedger,
  runReconciliation,
  type ReconciliationCheck,
  type ReconciliationReport,
} from "./reconciliation";

export {
  isPostgresError,
  type PostgresErrorShape,
  type SqlExecutor,
  type SqlRow,
  type SqlTransactor,
} from "./sql";
