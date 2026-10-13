"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { CalendarCheckIcon, EyeIcon, EyeOffIcon, InfoIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/shared/logo";
import { useAuthStore } from "@/store/auth-store";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { safeNextPath } from "@/lib/auth/routes";
import { signInAction } from "./actions";

const REASON_MESSAGES: Record<string, string> = {
  signin: "Please sign in to continue.",
  expired: "Your session has expired. Please sign in again.",
  signed_out: "You've been signed out.",
  link_invalid: "That sign-in link is invalid or has expired. Ask your administrator for a new invitation.",
  link_unsupported: "That email link uses a format this app doesn't accept, so it couldn't sign you in. Ask your administrator to send a new link (password recovery works for accounts that were already invited).",
  password_set: "Your password has been set. Sign in to continue.",
};

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const FEATURES = [
  "Manage patients, appointments, and billing in one place",
  "AI-assisted consultation notes and prescription safety checks",
  "A connected portal for patients to manage their own care",
];

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authEnabled = isSupabaseAuthEnabled();
  const reasonMessage = REASON_MESSAGES[searchParams.get("reason") ?? ""];
  const nextPath = safeNextPath(searchParams.get("next"));
  const [formError, setFormError] = useState<string | null>(null);
  const login = useAuthStore((s) => s.login);
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    // Demo mode only — with Supabase Auth the server decides where a session belongs.
    if (!authEnabled && hasHydrated && user) {
      router.replace(user.role === "patient" ? "/portal" : "/dashboard");
    }
  }, [authEnabled, hasHydrated, user, router]);

  async function supabaseLogin(email: string, password: string) {
    setIsSubmitting(true);
    setFormError(null);
    try {
      // Server Action: signs in server-side (sets the session cookie) and audits the attempt.
      const result = await signInAction({ email, password });
      if (!result.ok) {
        setFormError(
          result.error === "invalid_credentials" || result.error === "invalid_input"
            ? "Invalid email or password."
            : result.error === "email_not_confirmed"
              ? "Please confirm your email address first — check your inbox for the invitation link."
              : result.error === "rate_limited"
                ? "Too many attempts. Please wait a moment and try again."
                : "Couldn't sign you in right now. Please try again."
        );
        return;
      }
      // Drop any demo persona left in localStorage; the server now decides who this is.
      useAuthStore.getState().logout();
      router.replace(nextPath);
      router.refresh();
    } catch {
      setFormError("Couldn't reach the sign-in service. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function completeLogin(email: string, password: string) {
    if (authEnabled) {
      void supabaseLogin(email, password);
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      const success = login(email, password);
      setIsSubmitting(false);
      if (!success) {
        toast.error("Invalid email or password.");
        return;
      }
      const loggedInRole = useAuthStore.getState().user?.role;
      router.push(loggedInRole === "patient" ? "/portal" : "/dashboard");
    }, 500);
  }

  const onSubmit = (values: LoginFormValues) => completeLogin(values.email, values.password);

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.12),_transparent_45%)]" />
        <div className="relative">
          <Logo dark size="md" />
        </div>
        <div className="relative max-w-md space-y-6">
          <h1 className="text-3xl font-semibold leading-tight text-balance">Connecting Care. Simplifying Healthcare.</h1>
          <ul className="space-y-3">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm text-white/85">
                <CalendarCheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
                {feature}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">© 2026 Sehat Setu. All demo data is fictional.</p>
      </div>

      <div className="flex flex-col items-center justify-center gap-8 px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2 text-center lg:text-left">
            <div className="mb-4 flex justify-center lg:hidden">
              <Logo size="md" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Welcome back</h2>
            <p className="text-sm text-muted-foreground">Sign in to your Sehat Setu workspace.</p>
          </div>

          {reasonMessage && (
            <p role="status" className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {reasonMessage}
            </p>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" placeholder={authEnabled ? "you@yourclinic.com" : "you@sehatsetu.demo"} {...register("email")} />
              {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder={authEnabled ? undefined : "Demo@123"}
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-danger">{errors.password.message}</p>}
            </div>
            {formError && (
              <p role="alert" className="text-sm text-danger">
                {formError}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2Icon className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          {authEnabled ? (
            <p className="text-center text-sm text-muted-foreground">
              Accounts are created by invitation from your clinic administrator.
            </p>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              New patient?{" "}
              <Link href="/register" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </p>
          )}

          {!authEnabled && process.env.NODE_ENV === "development" && (
            <p className="text-center text-xs text-muted-foreground">
              <Link href="/dev/demo-accounts" className="hover:text-foreground hover:underline">
                Looking for demo accounts? (development only)
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
