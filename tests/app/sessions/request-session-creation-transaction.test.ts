import { RequestSessionCreationTransaction } from "@/app/sessions/request-session-creation-transaction";
import { describe, expect, test } from "vitest";
import { CreateSessionUnitOfWork } from "../../use-cases/support/create-session-unit-of-work";

const bookerId = "11111111-1111-4111-8111-111111111111";

// Owner: Neoh (liang799) — /app/sessions
describe("UC2-02 request transaction", () => {
  test("does not replay a different use case with the same booker and submission", async () => {
    // Arrange
    const unitOfWork = new CreateSessionUnitOfWork([]);
    const submission = { idempotencyKey: "create-session" };
    await unitOfWork.execute(
      JSON.stringify(["UC2-04", bookerId, submission.idempotencyKey]),
      async () => "unrelated-result",
    );
    const transaction = new RequestSessionCreationTransaction(
      unitOfWork,
      submission,
    );

    // Act
    const result = await transaction.runForBooker(
      bookerId,
      async () => "created-session",
    );

    // Assert
    expect(result).toBe("created-session");
  });

  test("captures submission identity independently of later metadata changes", async () => {
    // Arrange
    const unitOfWork = new CreateSessionUnitOfWork([]);
    const submission = { idempotencyKey: "original-submission" };
    const transaction = new RequestSessionCreationTransaction(
      unitOfWork,
      submission,
    );
    submission.idempotencyKey = "changed-submission";

    // Act
    await transaction.runForBooker(bookerId, async () => "original-result");
    const retry = new RequestSessionCreationTransaction(unitOfWork, {
      idempotencyKey: "original-submission",
    });
    const replay = await retry.runForBooker(bookerId, async () => {
      throw new Error("An existing submission must not run again");
    });

    // Assert
    expect(replay).toBe("original-result");
  });

  test("exposes only user and session repositories to creation", async () => {
    // Arrange
    const transaction = new RequestSessionCreationTransaction(
      new CreateSessionUnitOfWork([]),
      { idempotencyKey: "create-session" },
    );

    // Act
    const repositories = await transaction.runForBooker(
      bookerId,
      async (available) => Object.keys(available),
    );

    // Assert
    expect(repositories.sort()).toEqual(["sessions", "users"]);
  });
});
