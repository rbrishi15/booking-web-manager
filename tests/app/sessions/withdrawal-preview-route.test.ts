import { beforeEach, describe, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { SessionManagementUnavailableError } from "@/app/sessions/session-management-unavailable";

const mocks = vi.hoisted(() => ({
  dependencies: vi.fn(),
  authenticate: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("@/app/commit/withdrawal-preview-server-dependencies", () => ({
  getWithdrawalPreviewDependencies: mocks.dependencies,
}));
import { GET } from "@/app/api/sessions/[sessionId]/withdrawal-preview/route";
import { openApiDocument } from "@/app/openapi";
import { createWithdrawalPreviewDependencies } from "@/use-case-config/withdrawal-preview";

const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const preview = {
  sessionId,
  participationId: "30000000-0000-4000-8000-000000000001",
  kind: "REFUNDED",
  refundCents: 500,
  heldCents: 500,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(userId);
  mocks.preview.mockResolvedValue(preview);
  mocks.dependencies.mockResolvedValue({
    authenticate: mocks.authenticate,
    previewWithdrawal: { forParticipant: mocks.preview },
  });
});

function get(id = sessionId) {
  return GET(
    new Request(`http://localhost/api/sessions/${id}/withdrawal-preview?userId=forged`, {
      headers: { Authorization: "Bearer trusted" },
    }),
    { params: Promise.resolve({ sessionId: id }) },
  );
}

describe("GET /api/sessions/{sessionId}/withdrawal-preview", () => {
  test("returns the preview for the authenticated participant, uncached", async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(preview);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(userId, sessionId);
  });

  test("requires authentication", async () => {
    mocks.authenticate.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(401);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  test("rejects a malformed session ID", async () => {
    const response = await get("not-a-uuid");

    expect(response.status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  test.each([
    ["NOT_FOUND", 404],
    ["UNAUTHORIZED", 403],
    ["INVALID_STATE", 409],
    ["SESSION_STARTED", 409],
    ["SESSION_CLOSED", 409],
  ] as const)("maps %s to %i", async (code, status) => {
    mocks.preview.mockRejectedValue(new DomainError(code, "domain message"));

    const response = await get();

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: "domain message" },
    });
  });

  test("keeps infrastructure failures opaque", async () => {
    mocks.preview.mockRejectedValue(new Error("connection refused at 10.0.0.1"));

    const response = await get();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  test("reports unavailable server settings as 503", async () => {
    mocks.authenticate.mockRejectedValue(new SessionManagementUnavailableError());

    const response = await get();

    expect(response.status).toBe(503);
  });

  test("without server settings, configuration reports 503 rather than failing", async () => {
    const original = { ...process.env };
    delete process.env.DATABASE_URL;
    try {
      mocks.dependencies.mockResolvedValue(createWithdrawalPreviewDependencies());

      const response = await get();

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "SESSION_MANAGEMENT_UNAVAILABLE" },
      });
    } finally {
      process.env = original;
    }
  });

  test("is published in the API documentation", () => {
    const operation =
      openApiDocument.paths["/api/sessions/{sessionId}/withdrawal-preview"]?.get;

    expect(operation?.operationId).toBe("previewWithdrawal");
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([
      "200", "400", "401", "404", "409", "500", "503",
    ]);
  });
});
