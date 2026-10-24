import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { headers } from "next/headers";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { safeRedirectPath } from "@/app/(auth)/redirect-path";
import { registerUser } from "@/app/(auth)/register/actions";
import { DomainError } from "@/domain";
import { prepareProfileUpdate, type ProfileChanges } from "@/domain/accounts/profile";
import { createClient } from "@/lib/supabase/server";
import { fakeSupabase, formDataOf, RedirectCalled } from "../use-cases/support/fake-supabase-auth";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
// User IDs (ADR-0021) came after these basis paths; every path here uses a free one.
vi.mock("@/app/users/user-handle-server-dependencies", () => ({
  getUserHandleDependencies: async () => ({ checkUserHandle: { availability: async () => "AVAILABLE" } }),
}));
vi.mock("next/navigation", async () => {
  const { RedirectCalled } = await import("../use-cases/support/fake-supabase-auth");
  return { redirect: (target: string) => { throw new RedirectCalled(target); } };
});

const observations: object[] = [];

function observe(id: string, input: string, predictedPath: string, expected: object, actual: object) {
  observations.push({ id, input, predictedPath, expected, actual });
  expect(actual).toEqual(expected);
}

// ---------- UC1-01: registerUser ----------

const registration = { displayName: "Marcus Lim", email: "marcus@example.com", password: "password123", region: "West", sport: "Tennis", handle: "marcus_lim" };

/** The action's outcome: its returned state, or where it redirected. */
async function registerOutcome(fields: Record<string, string>) {
  try {
    const state = await registerUser({ status: "idle" }, formDataOf(fields));
    return { status: state.status, message: state.message, emailTaken: state.emailTaken ?? false };
  } catch (error) {
    if (error instanceof RedirectCalled) return { redirect: error.path };
    throw error;
  }
}

function signUpReturns(result: unknown) {
  const supabase = fakeSupabase({ signUp: result });
  vi.mocked(createClient).mockResolvedValue(supabase as never);
  return supabase;
}

describe("registerUser", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
    vi.mocked(headers).mockResolvedValue(new Headers({ origin: "https://booking-web-manager.vercel.app" }) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  test("registerUser_WhenG1FieldsInvalid_AsksToFixThemWithoutSigningUp", async () => {
    // Arrange
    const supabase = signUpReturns(undefined);

    // Act
    const outcome = await registerOutcome({ ...registration, password: "short" });

    // Assert
    observe("WB-G1", "Password of 5 characters", "G0 G1 G2 G14",
      { status: "error", message: "Please fix the highlighted fields.", emailTaken: false, signUpCalls: 0 },
      { ...outcome, signUpCalls: supabase.auth.signUp.mock.calls.length });
  });

  test("registerUser_WhenG2ConfirmationLinkUnavailable_StopsWithoutSigningUp", async () => {
    // Arrange
    const supabase = signUpReturns(undefined);
    vi.mocked(headers).mockResolvedValue(new Headers() as never);

    // Act
    const outcome = await registerOutcome(registration);

    // Assert
    observe("WB-G2", "Valid fields; request has no Origin header", "G0 G1 G3 G4 G14",
      { status: "error", message: "We couldn't prepare your confirmation link. Reload this page and try again.", emailTaken: false, signUpCalls: 0 },
      { ...outcome, signUpCalls: supabase.auth.signUp.mock.calls.length });
  });

  test("registerUser_WhenG3ProviderReportsExistingUser_OffersLogin", async () => {
    // Arrange
    signUpReturns({ data: { user: null, session: null }, error: { code: "user_already_exists", message: "exists" } });

    // Act
    const outcome = await registerOutcome(registration);

    // Assert
    observe("WB-G3", "Sign-up error code user_already_exists", "G0 G1 G3 G5 G6 G8 G14",
      { status: "error", message: "An account with this email already exists.", emailTaken: true },
      outcome);
  });

  test("registerUser_WhenG4ProviderHidesExistingUser_OffersLogin", async () => {
    // Arrange
    signUpReturns({ data: { user: { id: "x", identities: [] }, session: null }, error: null });

    // Act
    const outcome = await registerOutcome(registration);

    // Assert
    observe("WB-G4", "No error; user returned with no identities", "G0 G1 G3 G5 G6 G7 G8 G14",
      { status: "error", message: "An account with this email already exists.", emailTaken: true },
      outcome);
  });

  test("registerUser_WhenG5ProviderFails_ReportsGenericFailure", async () => {
    // Arrange
    signUpReturns({ data: { user: null, session: null }, error: { code: "over_email_send_rate_limit", message: "rate limited" } });

    // Act
    const outcome = await registerOutcome(registration);

    // Assert
    observe("WB-G5", "Sign-up error code over_email_send_rate_limit", "G0 G1 G3 G5 G6 G7 G9 G10 G14",
      { status: "error", message: "We couldn't create your account. Please try again.", emailTaken: false },
      outcome);
  });

  test("registerUser_WhenG6ConfirmationRequired_AsksToCheckEmail", async () => {
    // Arrange
    signUpReturns({ data: { user: { id: "marcus", identities: [{}] }, session: null }, error: null });

    // Act
    const outcome = await registerOutcome(registration);

    // Assert
    observe("WB-G6", "New user; no session (email confirmation on)", "G0 G1 G3 G5 G6 G7 G9 G11 G12 G14",
      { status: "check-email", message: "Account created. Check your email for a confirmation link, then log in.", emailTaken: false },
      outcome);
  });

  test("registerUser_WhenG7SignedInImmediately_RedirectsToTheSafeDestination", async () => {
    // Arrange
    signUpReturns({ data: { user: { id: "marcus", identities: [{}] }, session: {} }, error: null });

    // Act
    const outcome = await registerOutcome({ ...registration, next: "/groups/join/abc" });

    // Assert
    observe("WB-G7", "New user with a session; next=/groups/join/abc", "G0 G1 G3 G5 G6 G7 G9 G11 G13 G14",
      { redirect: "/groups/join/abc" }, outcome);
  });
});

// ---------- UC1-02: safeRedirectPath ----------

describe("safeRedirectPath", () => {
  const cases: readonly [string, string, unknown, string, string][] = [
    ["WB-S1", "Not a string (undefined)", undefined, "S0 S1 S9 S11", "/"],
    ["WB-S2", "Empty string", "", "S0 S1 S2 S9 S11", "/"],
    ["WB-S3", "\"/\\t/evil.example\" (tab character)", "/\t/evil.example", "S0 S1 S2 S3 S9 S11", "/"],
    ["WB-S4", "\"https://evil.example\" (another site)", "https://evil.example", "S0 S1 S2 S3 S4 S9 S11", "/"],
    ["WB-S5", "\"//evil.example\" (protocol-relative)", "//evil.example", "S0 S1 S2 S3 S4 S5 S9 S11", "/"],
    ["WB-S6", "\"/login?next=/wallet\" (login page)", "/login?next=/wallet", "S0 S1 S2 S3 S4 S5 S6 S7 S9 S11", "/"],
    ["WB-S7", "\"/auth/callback\" (callback route)", "/auth/callback", "S0 S1 S2 S3 S4 S5 S6 S7 S8 S9 S11", "/"],
    ["WB-S8", "\"/groups?tab=mine\" (page on this site)", "/groups?tab=mine", "S0 S1 S2 S3 S4 S5 S6 S7 S8 S10 S11", "/groups?tab=mine"],
  ];

  for (const [id, input, value, predicted, expected] of cases) {
    test(`safeRedirectPath_When${id.slice(3)}_${expected === "/" ? "ReturnsHome" : "KeepsThePath"}`, () => {
      // Act
      const destination = safeRedirectPath(value);

      // Assert
      observe(id, input, predicted, { destination: expected }, { destination });
    });
  }
});

// ---------- UC1-03: prepareProfileUpdate ----------

const valid: ProfileChanges = { displayName: "Marcus Lim", preferredSports: ["Tennis"], preferredRegions: ["West"] };

function profileOutcome(status: "ACTIVE" | "INACTIVE", changes: Partial<ProfileChanges>) {
  try {
    return { saved: prepareProfileUpdate(status, { ...valid, ...changes }) };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return { error: error.code, message: error.message };
  }
}

describe("prepareProfileUpdate", () => {
  const name = "A profile name must contain between 1 and 60 characters";
  const sport = "Choose at least one supported sport";
  const region = "Choose at least one supported region";
  const cases: readonly [string, string, "ACTIVE" | "INACTIVE", Partial<ProfileChanges>, string, object][] = [
    ["WB-P1", "Inactive account", "INACTIVE", {}, "P0 P1 P11 P13",
      { error: "INACTIVE_ACCOUNT", message: "The account is inactive" }],
    ["WB-P2", "Name of spaces only", "ACTIVE", { displayName: "   " }, "P0 P1 P2 P12 P13",
      { error: "INVALID_INPUT", message: name }],
    ["WB-P3", "Name of 61 characters", "ACTIVE", { displayName: "A".repeat(61) }, "P0 P1 P2 P3 P12 P13",
      { error: "INVALID_INPUT", message: name }],
    ["WB-P4", "Blank sport \" \"", "ACTIVE", { preferredSports: [" "] }, "P0 P1 P2 P3 P4 P12 P13",
      { error: "INVALID_INPUT", message: "preferredSports contains an empty value" }],
    ["WB-P5", "Blank region \" \"", "ACTIVE", { preferredRegions: [" "] }, "P0 P1 P2 P3 P4 P5 P12 P13",
      { error: "INVALID_INPUT", message: "preferredRegions contains an empty value" }],
    ["WB-P6", "No sports", "ACTIVE", { preferredSports: [] }, "P0 P1 P2 P3 P4 P5 P6 P12 P13",
      { error: "INVALID_INPUT", message: sport }],
    ["WB-P7", "Unsupported sport \"Golf\"", "ACTIVE", { preferredSports: ["Golf"] }, "P0 P1 P2 P3 P4 P5 P6 P7 P12 P13",
      { error: "INVALID_INPUT", message: sport }],
    ["WB-P8", "No regions", "ACTIVE", { preferredRegions: [] }, "P0 P1 P2 P3 P4 P5 P6 P7 P8 P12 P13",
      { error: "INVALID_INPUT", message: region }],
    ["WB-P9", "Unsupported region \"South\"", "ACTIVE", { preferredRegions: ["South"] }, "P0 P1 P2 P3 P4 P5 P6 P7 P8 P9 P12 P13",
      { error: "INVALID_INPUT", message: region }],
    ["WB-P10", "Valid; name with spaces, repeated sport", "ACTIVE", { displayName: "  Alex Tan  ", preferredSports: ["Tennis", "Tennis", "Futsal"] }, "P0 P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P13",
      { saved: { displayName: "Alex Tan", preferredSports: ["Tennis", "Futsal"], preferredRegions: ["West"] } }],
  ];

  for (const [id, input, status, changes, predicted, expected] of cases) {
    test(`prepareProfileUpdate_When${id.slice(3)}_${"saved" in expected ? "ReturnsCleanChanges" : "Rejects"}`, () => {
      // Act
      const outcome = profileOutcome(status, changes);

      // Assert
      observe(id, input, predicted, expected, outcome);
    });
  }
});

afterAll(() => {
  if (!process.env.LAB4_EVIDENCE_DIR) return;
  const directory = path.resolve(process.env.LAB4_EVIDENCE_DIR);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "auth-profile-basis-path-observations.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), observations }, null, 2) + "\n");
});
