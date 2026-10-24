import { z } from "zod";
import { USER_HANDLE_MAX_LENGTH, USER_HANDLE_MIN_LENGTH } from "@/domain/accounts/user-handle";

/** Strips spaces and one leading "@", then lower-cases, as the domain's UserHandle does. */
export function normalizeUserHandle(input: string): string {
  const trimmed = input.trim();
  return (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
}

/** The first rule a typed user ID breaks, in the order a person would fix them, or null. */
export function userHandleProblem(handle: string): string | null {
  if (handle === "") return "Choose a user ID";
  if (handle.length < USER_HANDLE_MIN_LENGTH) return `Use at least ${USER_HANDLE_MIN_LENGTH} characters`;
  if (handle.length > USER_HANDLE_MAX_LENGTH) return `Use ${USER_HANDLE_MAX_LENGTH} characters or fewer`;
  if (!/^[a-z0-9_]+$/u.test(handle)) return "Use only letters, numbers and underscores";
  if (!/^[a-z]/u.test(handle)) return "Start with a letter";
  if (handle.endsWith("_") || handle.includes("__")) return "Don't end with or repeat an underscore";
  return null;
}

/** A typed user ID (ADR-0021), returned in its stored form: lower case, without "@". */
export const userHandleSchema = z
  .string()
  .transform(normalizeUserHandle)
  .superRefine((handle, context) => {
    const problem = userHandleProblem(handle);
    if (problem !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
