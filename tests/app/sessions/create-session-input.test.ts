import { parseCreateSessionInput } from "@/app/sessions/create-session-input";
import type { SessionConfig } from "@/use-cases/sessions/CreateSessions";
import { describe, expect, test } from "vitest";
import { ZodError } from "zod";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const invitedGroupId = "33333333-3333-4333-8333-333333333333";

// Owner: Neoh (liang799) — /app/sessions
describe("UC2-02 Create Session input", () => {
  test("separates submission metadata from input with the authenticated booker", () => {
    // Arrange
    const request = creationRequest();

    // Act
    const parsed = parseCreateSessionInput(actorUserId, request);

    // Assert
    expect(parsed).toEqual({
      input: {
        bookerId: actorUserId,
        booking: {
          ...request.booking,
          startAt: new Date(request.booking.startAt),
          endAt: new Date(request.booking.endAt),
        },
        config: request.config,
      },
      submission: { idempotencyKey: request.idempotencyKey },
    });
    expect(parsed.input).not.toHaveProperty("idempotencyKey");
    expect(parsed.input.config).not.toHaveProperty("visibility");
    expect(parsed.input.config).not.toHaveProperty("minimumReliability");
    expect(parsed.input.config).not.toHaveProperty("invitedGroupId");
  });

  test("preserves optional settings and the untrimmed idempotency key", () => {
    // Arrange
    const baseRequest = creationRequest();
    const request = {
      ...baseRequest,
      idempotencyKey: "  create-session  ",
      config: {
        ...baseRequest.config,
        visibility: "PUBLIC",
        minimumReliability: 75,
        invitedGroupId,
      },
    };

    // Act
    const parsed = parseCreateSessionInput(actorUserId, request);

    // Assert
    expect(parsed.input.config).toEqual(request.config);
    expect(parsed.submission).toEqual({ idempotencyKey: "  create-session  " });
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
      config: {
        ...request.config,
        bookerId: otherUserId,
        bookingShareCents: 1,
        idempotencyKey: "forged-submission",
        unexpected: { value: true },
      },
      submission: { idempotencyKey: "forged-submission" },
    };

    // Act
    const parsed = parseCreateSessionInput(actorUserId, untrustedRequest);

    // Assert
    expect(parsed).toEqual({
      input: {
        bookerId: actorUserId,
        booking: {
          ...request.booking,
          startAt: new Date(request.booking.startAt),
          endAt: new Date(request.booking.endAt),
        },
        config: request.config,
      },
      submission: { idempotencyKey: request.idempotencyKey },
    });
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
    const request = creationRequest();
    request.config.invitedGroupId = "not-a-uuid";

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
    request.booking.startAt = "invalid";

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects an invalid end date", () => {
    // Arrange
    const request = creationRequest();
    request.booking.endAt = "invalid";

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("converts timezone offsets into the correct Date instants", () => {
    // Arrange
    const request = creationRequest();
    request.booking.startAt = "2026-10-01T18:00:00+08:00";
    request.booking.endAt = "2026-10-01T20:00:00+08:00";

    // Act
    const parsed = parseCreateSessionInput(actorUserId, request);

    // Assert
    expect(parsed.input.booking.startAt).toEqual(new Date("2026-10-01T10:00:00Z"));
    expect(parsed.input.booking.endAt).toEqual(new Date("2026-10-01T12:00:00Z"));
  });

  test("rejects Date objects instead of accepting non-JSON timestamp inputs", () => {
    // Arrange
    const request = creationRequest();
    const input = {
      ...request,
      booking: { ...request.booking, startAt: new Date(request.booking.startAt) },
    };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, input)).toThrow(ZodError);
  });

  test("rejects numeric timestamps without coercing them to dates", () => {
    // Arrange
    const request = creationRequest();
    const input = {
      ...request,
      booking: {
        ...request.booking,
        endAt: new Date(request.booking.endAt).getTime(),
      },
    };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, input)).toThrow(ZodError);
  });

  test.each([
    "2026-10-01T10:00:00",
    "2026-10-01",
    "2026-02-29T10:00:00Z",
    "2026-02-30T10:00:00+08:00",
    "2026-04-31T10:00:00Z",
    "2026-13-01T10:00:00Z",
    "2026-10-01T24:00:00Z",
    "2026-10-01T10:00:00+99:99",
  ])("rejects invalid or unzoned timestamp %s", (startAt) => {
    // Arrange
    const request = creationRequest();
    request.booking.startAt = startAt;

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("accepts a real leap-day timestamp", () => {
    // Arrange
    const request = creationRequest();
    request.booking.startAt = "2028-02-29T10:00:00Z";
    request.booking.endAt = "2028-02-29T12:00:00Z";

    // Act
    const parsed = parseCreateSessionInput(actorUserId, request);

    // Assert
    expect(parsed.input.booking.startAt).toEqual(new Date("2028-02-29T10:00:00Z"));
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

  test("requires grouped config instead of top-level capacity fields", () => {
    // Arrange
    const request = creationRequest();
    const ungroupedRequest = {
      idempotencyKey: request.idempotencyKey,
      booking: request.booking,
      totalSlots: 3,
      minimumHeadcount: 2,
    };

    // Act & Assert
    expect(() =>
      parseCreateSessionInput(actorUserId, ungroupedRequest),
    ).toThrow(ZodError);
  });

  test("rejects config without required capacity fields", () => {
    // Arrange
    const request = { ...creationRequest(), config: {} };

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
    const baseRequest = creationRequest();
    const request = {
      ...baseRequest,
      config: { ...baseRequest.config, totalSlots: "3" },
    };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects non-finite capacity", () => {
    // Arrange
    const request = creationRequest();
    request.config.totalSlots = Infinity;

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects non-finite minimum headcount", () => {
    // Arrange
    const request = creationRequest();
    request.config.minimumHeadcount = NaN;

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects non-finite minimum reliability", () => {
    // Arrange
    const request = creationRequest();
    request.config.minimumReliability = Infinity;

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("rejects unsupported visibility values", () => {
    // Arrange
    const baseRequest = creationRequest();
    const request = {
      ...baseRequest,
      config: { ...baseRequest.config, visibility: "UNLISTED" },
    };

    // Act & Assert
    expect(() => parseCreateSessionInput(actorUserId, request)).toThrow(ZodError);
  });

  test("leaves business validation to the domain", () => {
    // Arrange
    const request = creationRequest();
    request.booking.venueName = " ";
    request.booking.totalCostCents = 0;
    request.booking.endAt = request.booking.startAt;
    request.config.totalSlots = 9.5;
    request.config.minimumHeadcount = -1;
    request.config.minimumReliability = 101;

    // Act
    const parsed = parseCreateSessionInput(actorUserId, request);

    // Assert
    expect(parsed.input.booking).toEqual({
      ...request.booking,
      startAt: new Date(request.booking.startAt),
      endAt: new Date(request.booking.endAt),
    });
    expect(parsed.input.config).toEqual(request.config);
  });
});

function creationRequest() {
  const config: SessionConfig = { totalSlots: 3, minimumHeadcount: 2 };
  return {
    idempotencyKey: "create-session",
    booking: {
      venueName: "Jurong East Sports Hall",
      region: "West",
      sport: "Badminton",
      startAt: "2026-10-01T10:00:00Z",
      endAt: "2026-10-01T12:00:00Z",
      totalCostCents: 1001,
    },
    config,
  };
}
