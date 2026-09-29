import { parseCreateSessionInput } from "@/app/sessions/create-session-input";
import type { CreateSessionRequest } from "@/use-cases/sessions/CreateSession";
import { describe, expect, test } from "vitest";
import { ZodError } from "zod";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const invitedGroupId = "33333333-3333-4333-8333-333333333333";

// Owner: Neoh (liang799) — /app/sessions
describe("UC2-02 Create Session input", () => {
  test("returns the separately supplied actor and a validated request", () => {
    // Arrange
    const request = creationRequest();

    // Act
    const input = parseCreateSessionInput(actorUserId, request);

    // Assert
    expect(input).toEqual({ actorUserId, request });
    expect(input.request).not.toHaveProperty("visibility");
    expect(input.request).not.toHaveProperty("minimumReliability");
    expect(input.request).not.toHaveProperty("invitedGroupId");
  });

  test("preserves optional settings and the untrimmed idempotency key", () => {
    // Arrange
    const request = {
      ...creationRequest(),
      idempotencyKey: "  create-session  ",
      visibility: "PUBLIC",
      minimumReliability: 75,
      invitedGroupId,
    };

    // Act
    const input = parseCreateSessionInput(actorUserId, request);

    // Assert
    expect(input).toEqual({ actorUserId, request });
  });

  test("strips client-supplied identities, shares, and unknown nested fields", () => {
    // Arrange
    const request = creationRequest();
    const untrustedRequest = {
      ...request,
      actorUserId: otherUserId,
      bookerId: otherUserId,
      sessionId: otherUserId,
      roomToken: "client-token",
      holdingAccountId: otherUserId,
      bookingShareCents: 1,
      bookingShare: 1,
      share: 1,
      status: "SETTLED",
      participations: [{ userId: otherUserId }],
      now: new Date("2000-01-01T00:00:00Z"),
      booking: {
        ...request.booking,
        totalCost: { cents: 1 },
        bookingShareCents: 1,
        unexpected: { value: true },
      },
    };

    // Act
    const input = parseCreateSessionInput(actorUserId, untrustedRequest);

    // Assert
    expect(input).toEqual({ actorUserId, request });
    expect(untrustedRequest.actorUserId).toBe(otherUserId);
    expect(untrustedRequest.booking).toHaveProperty("unexpected");
  });

  test("rejects a malformed actor even when the body supplies a valid actor", () => {
    // Arrange
    const request = { ...creationRequest(), actorUserId };

    // Act & Assert
    expect(() => parseCreateSessionInput("not-a-uuid", request)).toThrow(ZodError);
  });

  test("rejects an actor that is not a string", () => {
    // Arrange
    const request = creationRequest();

    // Act & Assert
    expect(() => parseCreateSessionInput(undefined, request)).toThrow(ZodError);
  });

  test("rejects a malformed invited-group UUID", () => {
    // Arrange
    const request = { ...creationRequest(), invitedGroupId: "not-a-uuid" };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects a blank idempotency key", () => {
    // Arrange
    const request = { ...creationRequest(), idempotencyKey: " \t\n " };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(
      "An idempotency key is required",
    );
  });

  test("rejects fractional booking cents", () => {
    // Arrange
    const request = creationRequest();
    request.booking.totalCostCents = 1001.5;

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects booking cents outside the safe integer range", () => {
    // Arrange
    const request = creationRequest();
    request.booking.totalCostCents = Number.MAX_SAFE_INTEGER + 1;

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects an invalid start date", () => {
    // Arrange
    const request = creationRequest();
    request.booking.startAt = new Date("invalid");

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects an invalid end date", () => {
    // Arrange
    const request = creationRequest();
    request.booking.endAt = new Date("invalid");

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects timestamp strings without coercing them to dates", () => {
    // Arrange
    const request = creationRequest();
    const input = {
      ...request,
      booking: { ...request.booking, startAt: "2026-10-01T10:00:00Z" },
    };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, input)).toThrow(ZodError);
  });

  test("rejects numeric timestamps without coercing them to dates", () => {
    // Arrange
    const request = creationRequest();
    const input = {
      ...request,
      booking: { ...request.booking, endAt: request.booking.endAt.getTime() },
    };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, input)).toThrow(ZodError);
  });

  test("rejects a request that is not an object", () => {
    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, null)).toThrow(ZodError);
  });

  test("rejects missing required booking details", () => {
    // Arrange
    const request = { ...creationRequest(), booking: {} };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects a booking field with the wrong type", () => {
    // Arrange
    const request = creationRequest();
    const input = {
      ...request,
      booking: { ...request.booking, venueName: 123 },
    };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, input)).toThrow(ZodError);
  });

  test("rejects a numeric string instead of coercing capacity", () => {
    // Arrange
    const request = { ...creationRequest(), totalSlots: "3" };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects non-finite capacity", () => {
    // Arrange
    const request = { ...creationRequest(), totalSlots: Infinity };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects non-finite minimum headcount", () => {
    // Arrange
    const request = { ...creationRequest(), minimumHeadcount: NaN };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects non-finite minimum reliability", () => {
    // Arrange
    const request = { ...creationRequest(), minimumReliability: Infinity };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects unsupported visibility values", () => {
    // Arrange
    const request = { ...creationRequest(), visibility: "UNLISTED" };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("leaves business validation to the domain", () => {
    // Arrange
    const request = creationRequest();
    request.booking.venueName = " ";
    request.booking.totalCostCents = 0;
    request.booking.endAt = request.booking.startAt;
    request.totalSlots = 9.5;
    request.minimumHeadcount = -1;
    request.minimumReliability = 101;

    // Act
    const input = parseCreateSessionInput(actorUserId, request);

    // Assert
    expect(input).toEqual({ actorUserId, request });
  });
});

function creationRequest(): CreateSessionRequest {
  return {
    idempotencyKey: "create-session",
    booking: {
      venueName: "Jurong East Sports Hall",
      region: "West",
      sport: "Badminton",
      startAt: new Date("2026-10-01T10:00:00Z"),
      endAt: new Date("2026-10-01T12:00:00Z"),
      totalCostCents: 1001,
    },
    totalSlots: 3,
    minimumHeadcount: 2,
  };
}
