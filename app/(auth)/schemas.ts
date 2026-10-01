import { z } from "zod";

/**
 * Singapore regions shown in the region picker (REQ-4).
 * Agree this list with Neoh so Discover filters (UC2-01) use the same values.
 */
export const REGIONS = ["Central", "East", "North", "North-East", "West"] as const;

/** Sports shown in the sport picker (REQ-3). Agree this list with Neoh too. */
export const SPORTS = ["Badminton", "Basketball", "Football", "Futsal", "Tennis", "Volleyball"] as const;

export type Region = (typeof REGIONS)[number];
export type Sport = (typeof SPORTS)[number];

/** UC1-01 Register User: the register form (mockup 02). */
export const registerSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Enter your name")
    .max(60, "Keep your name under 60 characters"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Use at least 8 characters")
    .max(72, "Use 72 characters or fewer"),
  region: z.enum(REGIONS, { errorMap: () => ({ message: "Choose a region" }) }),
  sport: z.enum(SPORTS, { errorMap: () => ({ message: "Choose a sport" }) }),
});

/** UC1-02 Authenticate User: the login form (mockup 03). */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;