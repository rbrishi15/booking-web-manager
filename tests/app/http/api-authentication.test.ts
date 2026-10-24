import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { AuthApiError, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createBearerAuthenticator } from "@/lib/supabase/bearer-auth";
import { bearerOrLoginCookie } from "@/lib/supabase/request-authenticator";
import { createStripeEventVerifier } from "@/app/api/webhooks/stripe-webhook";

// Replace only dependency assembly: every route, action, input parser, and
// authentication boundary below is the production implementation.
const mocks = vi.hoisted(() => ({
  protectedDependencies: vi.fn(),
  discoveryDependencies: vi.fn(),
  cronDependencies: vi.fn(),
  webhookDependencies: vi.fn(),
  businessAccess: vi.fn(),
}));
vi.mock("@/app/sessions/server-dependencies", () => ({ getSessionDependencies: mocks.protectedDependencies }));
vi.mock("@/app/sessions/management-server-dependencies", () => ({ getSessionManagementDependencies: mocks.protectedDependencies }));
vi.mock("@/app/sessions/cancellation-server-dependencies", () => ({ getSessionCancellationDependencies: mocks.protectedDependencies }));
vi.mock("@/app/sessions/invitation-server-dependencies", () => ({ getSessionInvitationDependencies: mocks.protectedDependencies }));
vi.mock("@/app/sessions/removal-server-dependencies", () => ({ getSessionRemovalDependencies: mocks.protectedDependencies }));
vi.mock("@/app/sessions/session-feed-server-dependencies", () => ({ getSessionFeedDependencies: mocks.protectedDependencies }));
vi.mock("@/app/commit/commitment-server-dependencies", () => ({ getCommitmentDependencies: mocks.protectedDependencies }));
vi.mock("@/app/commit/player-sessions-server-dependencies", () => ({ getPlayerSessionsDependencies: mocks.protectedDependencies }));
vi.mock("@/app/commit/withdrawal-preview-server-dependencies", () => ({ getWithdrawalPreviewDependencies: mocks.protectedDependencies }));
vi.mock("@/app/commit/push-subscription-server-dependencies", () => ({ getPushSubscriptionDependencies: mocks.protectedDependencies }));
vi.mock("@/app/wallet/server-dependencies", () => ({ getWalletDependencies: mocks.protectedDependencies }));
vi.mock("@/app/payouts/payout-server-dependencies", () => ({ getPayoutDependencies: mocks.protectedDependencies }));
vi.mock("@/app/users/user-handle-server-dependencies", () => ({ getUserHandleDependencies: mocks.protectedDependencies }));
vi.mock("@/app/venues/server-dependencies", () => ({ getVenueDependencies: mocks.protectedDependencies }));
vi.mock("@/app/discover/server-dependencies", () => ({ getDiscoveryDependencies: mocks.discoveryDependencies }));
vi.mock("@/app/commit/scheduled-jobs-server-dependencies", () => ({ getScheduledJobsDependencies: mocks.cronDependencies }));
vi.mock("@/app/api/webhooks/stripe-webhook-server-dependencies", () => ({ getStripeWebhookDependencies: mocks.webhookDependencies }));

import * as sessions from "@/app/api/sessions/route";
import * as sessionMine from "@/app/api/sessions/mine/route";
import * as sessionHosted from "@/app/api/sessions/hosted/route";
import * as sessionJoined from "@/app/api/sessions/joined/route";
import * as sessionReplacements from "@/app/api/sessions/replacements/route";
import * as sessionCommit from "@/app/api/sessions/commit/route";
import * as sessionAttendance from "@/app/api/sessions/attendance/route";
import * as sessionWithdraw from "@/app/api/sessions/withdraw/route";
import * as waitlistLeave from "@/app/api/sessions/waitlist/leave/route";
import * as replacementAccept from "@/app/api/sessions/replacements/accept/route";
import * as cancellation from "@/app/api/sessions/[sessionId]/cancel/route";
import * as cancellationPreview from "@/app/api/sessions/[sessionId]/cancellation-preview/route";
import * as invitation from "@/app/api/sessions/[sessionId]/invitation/route";
import * as participants from "@/app/api/sessions/[sessionId]/participants/route";
import * as removal from "@/app/api/sessions/[sessionId]/participants/[participationId]/remove/route";
import * as removalPreview from "@/app/api/sessions/[sessionId]/participants/[participationId]/removal-preview/route";
import * as visibility from "@/app/api/sessions/[sessionId]/visibility/route";
import * as withdrawalPreview from "@/app/api/sessions/[sessionId]/withdrawal-preview/route";
import * as wallet from "@/app/api/wallet/route";
import * as walletTransactions from "@/app/api/wallet/transactions/route";
import * as walletTopUp from "@/app/api/wallet/top-up/route";
import * as payoutAccount from "@/app/api/payouts/account/route";
import * as payoutSessions from "@/app/api/payouts/sessions/route";
import * as payoutWithdraw from "@/app/api/payouts/withdraw/route";
import * as userByHandle from "@/app/api/users/by-handle/[handle]/route";
import * as venues from "@/app/api/venues/route";
import * as pushSubscriptions from "@/app/api/push/subscriptions/route";
import * as cron from "@/app/api/cron/commitments/route";
import * as webhook from "@/app/api/webhooks/stripe/route";
import * as openapi from "@/app/api/openapi/route";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type Method = typeof methods[number];
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Response | Promise<Response>;
type Route = { path: string; handlers: Partial<Record<Method, Handler>> };

const routes: Route[] = [
  { path: "/api/sessions", handlers: sessions },
  { path: "/api/sessions/mine", handlers: sessionMine },
  { path: "/api/sessions/hosted", handlers: sessionHosted },
  { path: "/api/sessions/joined", handlers: sessionJoined },
  { path: "/api/sessions/replacements", handlers: sessionReplacements },
  { path: "/api/sessions/commit", handlers: sessionCommit },
  { path: "/api/sessions/attendance", handlers: sessionAttendance },
  { path: "/api/sessions/withdraw", handlers: sessionWithdraw },
  { path: "/api/sessions/waitlist/leave", handlers: waitlistLeave },
  { path: "/api/sessions/replacements/accept", handlers: replacementAccept },
  { path: "/api/sessions/[sessionId]/cancel", handlers: cancellation },
  { path: "/api/sessions/[sessionId]/cancellation-preview", handlers: cancellationPreview },
  { path: "/api/sessions/[sessionId]/invitation", handlers: invitation },
  { path: "/api/sessions/[sessionId]/participants", handlers: participants },
  { path: "/api/sessions/[sessionId]/participants/[participationId]/remove", handlers: removal },
  { path: "/api/sessions/[sessionId]/participants/[participationId]/removal-preview", handlers: removalPreview },
  { path: "/api/sessions/[sessionId]/visibility", handlers: visibility },
  { path: "/api/sessions/[sessionId]/withdrawal-preview", handlers: withdrawalPreview },
  { path: "/api/wallet", handlers: wallet },
  { path: "/api/wallet/transactions", handlers: walletTransactions },
  { path: "/api/wallet/top-up", handlers: walletTopUp },
  { path: "/api/payouts/account", handlers: payoutAccount },
  { path: "/api/payouts/sessions", handlers: payoutSessions },
  { path: "/api/payouts/withdraw", handlers: payoutWithdraw },
  { path: "/api/users/by-handle/[handle]", handlers: userByHandle },
  { path: "/api/venues", handlers: venues },
  { path: "/api/push/subscriptions", handlers: pushSubscriptions },
  { path: "/api/cron/commitments", handlers: cron },
  { path: "/api/webhooks/stripe", handlers: webhook },
  { path: "/api/openapi", handlers: openapi },
];
const nonUserRoutes = new Set([
  "GET /api/sessions", "GET /api/openapi",
  "GET /api/cron/commitments", "POST /api/webhooks/stripe",
]);
const exportedMethods = routes.flatMap(({ path, handlers }) => methods.flatMap((method) => {
  const handler = handlers[method];
  return handler ? [{ path, method, handler, name: `${method} ${path}` }] : [];
}));

const getUser = vi.fn<SupabaseClient["auth"]["getUser"]>();
const accountStatus = vi.fn(async () => ({ kind: "active" as const }));
const loginCookie = vi.fn<() => Promise<string | null>>();
const authenticate = vi.fn(bearerOrLoginCookie(createBearerAuthenticator({ getUser }, accountStatus), loginCookie));

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("Rejected token", 401, undefined) });
  loginCookie.mockResolvedValue(null);
  mocks.protectedDependencies.mockResolvedValue(new Proxy({ authenticate }, {
    get(target, key) {
      if (key === "authenticate") return target.authenticate;
      if (key === "then") return undefined; // Promise resolution probes thenables.
      mocks.businessAccess(key);
      throw new Error(`Business capability accessed without authentication: ${String(key)}`);
    },
  }));
});

describe("API authentication inventory", () => {
  test("includes every route module, so adding a route requires authentication coverage", () => {
    const files = readdirSync(resolve("app/api"), { recursive: true, encoding: "utf8" });
    const paths = files.filter((file) => /(^|\/)route\.[jt]sx?$/.test(file))
      .map((file) => ["", "api", ...file.split("/").slice(0, -1)
        .filter((segment) => !/^\(.*\)$/.test(segment))].join("/"));
    expect(routes.map(({ path }) => path).sort()).toEqual(paths.sort());
    expect(exportedMethods.filter(({ name }) => nonUserRoutes.has(name)).map(({ name }) => name).sort())
      .toEqual([...nonUserRoutes].sort());
  });

  describe.each(exportedMethods.filter(({ name }) => !nonUserRoutes.has(name)))("$name", ({ path, method, handler }) => {
    test.each([
      { label: "missing identity", authorization: undefined },
      { label: "rejected bearer identity despite a valid cookie", authorization: "Bearer rejected" },
      { label: "malformed bearer despite a valid cookie", authorization: "Bearer" },
    ])("rejects $label before input parsing or business access", async ({ authorization }) => {
      if (authorization) loginCookie.mockResolvedValue("11111111-1111-4111-8111-111111111111");
      const request = new Request(`https://app.test${path}?userId=forged&limit=invalid&tab=invalid&q=`, {
        method,
        headers: authorization ? { authorization } : {},
        ...(method === "GET" || method === "HEAD" ? {} : { body: "{" }),
      });
      const json = vi.spyOn(request, "json");
      const readParams = vi.fn(() => Promise.resolve({ sessionId: "invalid", participationId: "invalid" }));

      const response = await handler(request, { get params() { return readParams(); } });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
      expect(authenticate).toHaveBeenCalledExactlyOnceWith(request);
      expect(mocks.businessAccess).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(readParams).not.toHaveBeenCalled();
      expect(accountStatus).not.toHaveBeenCalled();
      if (authorization) expect(loginCookie).not.toHaveBeenCalled();
      else expect(loginCookie).toHaveBeenCalledOnce();
      if (authorization === "Bearer rejected") expect(getUser).toHaveBeenCalledExactlyOnceWith("rejected");
      else expect(getUser).not.toHaveBeenCalled();
    });
  });
});

describe("explicit exceptions to user authentication", () => {
  test("discovery remains available without a user identity", async () => {
    const searchPublic = vi.fn().mockResolvedValue([]);
    mocks.discoveryDependencies.mockResolvedValue({ discoverSessions: { searchPublic } });

    const response = await sessions.GET(new Request("https://app.test/api/sessions"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], nextCursor: null });
    expect(searchPublic).toHaveBeenCalledExactlyOnceWith({});
    expect(authenticate).not.toHaveBeenCalled();
  });

  test("OpenAPI remains public", async () => {
    const response = openapi.GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ openapi: expect.stringMatching(/^3\./), paths: expect.any(Object) });
    expect(authenticate).not.toHaveBeenCalled();
  });

  test.each([undefined, "Bearer user-jwt", "Bearer incorrect-secret"])("cron rejects %s before starting a job", async (authorization) => {
    const run = vi.fn();
    const next = vi.fn();
    mocks.cronDependencies.mockResolvedValue({ cronSecret: "scheduler-secret", ids: { next }, runner: { run } });

    const response = await cron.GET(new Request("https://app.test/api/cron/commitments", {
      headers: authorization ? { authorization } : {},
    }));

    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  test.each([undefined, "invalid-signature"])("Stripe rejects signature %s before any financial handler", async (signature) => {
    const creditWallet = vi.fn();
    const updatePayoutAccount = vi.fn();
    mocks.webhookDependencies.mockResolvedValue({
      verify: createStripeEventVerifier(new Stripe("sk_test_unused"), ["whsec_expected"]),
      handlers: { "payment_intent.succeeded": creditWallet, "account.updated": updatePayoutAccount },
    });
    const request = new Request("https://app.test/api/webhooks/stripe", {
      method: "POST",
      headers: signature ? { "stripe-signature": signature } : {},
      body: JSON.stringify({ id: "evt_forged", type: "payment_intent.succeeded", data: { object: { amount: 10000 } } }),
    });

    const response = await webhook.POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: signature ? "INVALID_SIGNATURE" : "MISSING_SIGNATURE" } });
    expect(creditWallet).not.toHaveBeenCalled();
    expect(updatePayoutAccount).not.toHaveBeenCalled();
  });
});
