"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { CalendarCheckIcon, EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Logo } from "@/components/shared/logo";
import { useAuthStore } from "@/store/auth-store";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";
import { useRegisterPatient } from "@/hooks/use-patients";
import type { Gender } from "@/types";
import { LiveRegister } from "./live-register";

const registerSchema = z.object({
  name: z.string().min(2, "Enter your full name"),
  phone: z.string().min(7, "Enter a valid phone number"),
  email: z.string().email("Enter a valid email address"),
  dob: z.string().min(1, "Enter your date of birth"),
  gender: z.enum(["male", "female", "other"]),
  password: z.string().min(4, "Password must be at least 4 characters"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

const FEATURES = [
  "Book appointments with verified doctors near you",
  "Access prescriptions, reports, and bills in one place",
  "Chat with Sehat AI for guidance — always reviewed by a doctor",
];

export default function RegisterPage() {
  // With real authentication, patients register here (details + emailed OTP)
  // and /link-account connects or creates their record. The demo form below
  // only ever wrote to the local demo dataset.
  if (isSupabaseAuthEnabled()) return <LiveRegister />;
  return <DemoRegisterPage />;
}

function DemoRegisterPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const registerPatient = useRegisterPatient();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", phone: "", email: "", dob: "", gender: "male", password: "" },
  });

  useEffect(() => {
    if (hasHydrated && user) {
      router.replace(user.role === "patient" ? "/portal" : "/dashboard");
    }
  }, [hasHydrated, user, router]);

  const onSubmit = (values: RegisterFormValues) => {
    registerPatient.mutate(values, {
      onSuccess: () => {
        const ok = login(values.email, values.password);
        if (ok) {
          toast.success("Account created. Welcome to Sehat Setu!");
          router.push("/portal");
        }
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create your account."),
    });
  };

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.12),_transparent_45%)]" />
        <div className="relative">
          <Logo dark size="md" />
        </div>
        <div className="relative max-w-md space-y-6">
          <h1 className="text-3xl font-semibold leading-tight text-balance">Your health, connected in one place.</h1>
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
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2 text-center lg:text-left">
            <div className="mb-4 flex justify-center lg:hidden">
              <Logo size="md" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Create your account</h2>
            <p className="text-sm text-muted-foreground">Just a few details to get started as a patient.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" autoComplete="name" placeholder="e.g. Rahul Sharma" {...register("name")} />
              {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="phone">Mobile number</Label>
                <Input id="phone" autoComplete="tel" placeholder="+91 9XXXXXXXXX" {...register("phone")} />
                {errors.phone && <p className="text-xs text-danger">{errors.phone.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dob">Date of birth</Label>
                <Input id="dob" type="date" {...register("dob")} />
                {errors.dob && <p className="text-xs text-danger">{errors.dob.message}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" {...register("email")} />
              {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Select value={watch("gender")} onValueChange={(v) => setValue("gender", v as Gender)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Create a password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
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
            <Button type="submit" className="w-full" disabled={registerPatient.isPending}>
              {registerPatient.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
              Create account
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
