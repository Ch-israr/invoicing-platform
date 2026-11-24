"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { registerUserAccount } from "@/server/services/auth.service";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";

export type AuthActionState = { error?: string } | null;

/**
 * Auth endpoints are rate-limited by client IP (5 attempts/min) in
 * addition to the per-email limiter inside authorize() (lib/auth.ts):
 * the IP limiter stops distributed guessing across many accounts, the
 * email limiter stops guessing one account from many IPs.
 */
async function checkAuthRateLimit(kind: "login" | "register"): Promise<string | null> {
  const ip = await getClientIp();
  const result = checkRateLimit(`auth-${kind}:${ip}`, 5, 60_000);
  if (result.allowed) return null;
  return "Too many attempts. Please wait a minute and try again.";
}

export async function registerAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    businessName: formData.get("businessName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const limited = await checkAuthRateLimit("register");
  if (limited) return { error: limited };

  const result = await registerUserAccount(parsed.data);
  if (!result.ok) {
    return { error: result.error };
  }

  // Sign the new user in and go to the dashboard. signIn() redirects
  // on success (throws NEXT_REDIRECT) — rethrow so Next handles it.
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { error: "Account created, but sign-in failed. Please log in." };
  }
  return null;
}

export async function loginAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email address and password" };
  }

  const limited = await checkAuthRateLimit("login");
  if (limited) return { error: limited };

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (err instanceof AuthError) {
      return { error: "Invalid email or password" };
    }
    return { error: "Sign-in failed. Please try again." };
  }
  return null;
}
