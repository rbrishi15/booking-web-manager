import { DomainError, type FinancialInstruction, type UUID } from "@/domain";
import type { DomainTransaction } from "./contracts";

export async function requireAggregate<T>(
  repository: { get(id: UUID): Promise<T | null> },
  id: UUID,
  name: string,
): Promise<T> {
  const aggregate = await repository.get(id);
  if (aggregate === null)
    throw new DomainError("NOT_FOUND", `${name} was not found`);
  return aggregate;
}

export async function appendInstructions(
  transaction: Pick<DomainTransaction, "ledger">,
  instructions: readonly FinancialInstruction[],
): Promise<void> {
  if (instructions.length > 0) await transaction.ledger.append(instructions);
}
