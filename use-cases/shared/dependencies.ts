import type { Clock, IdGenerator, UnitOfWork } from "./contracts";

export interface UseCaseDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}
