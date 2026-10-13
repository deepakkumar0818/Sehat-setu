"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { VISIT_REASONS } from "@/data/pools";

const schema = z.object({
  name: z.string().min(2, "Enter your full name"),
  phone: z.string().min(7, "Enter a valid phone number"),
  email: z.string().email("Enter a valid email address"),
  reason: z.string().min(3, "Tell us briefly why you're booking"),
});

export type BookingDetails = z.infer<typeof schema>;

interface BookingDetailsStepProps {
  defaultValues: Partial<BookingDetails>;
  onSubmit: (values: BookingDetails) => void;
}

export function BookingDetailsStep({ defaultValues, onSubmit }: BookingDetailsStepProps) {
  const user = useCurrentUser();
  const isPatient = user?.role === "patient";

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<BookingDetails>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", phone: "", email: "", reason: "", ...defaultValues },
  });

  useEffect(() => {
    if (isPatient && user) {
      reset({ name: user.name, phone: "", email: user.email, reason: defaultValues.reason ?? "" });
    }
  }, [isPatient, user, reset, defaultValues.reason]);

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <h2 className="text-lg font-semibold text-foreground">Your details</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {isPatient ? "Confirm your details for this booking." : "We'll use this to confirm your appointment. You'll set up sign-in next."}
      </p>

      {isPatient && user && (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border bg-accent/40 p-3">
          <PersonAvatar name={user.name} color={user.avatarColor} size="sm" />
          <div>
            <p className="text-sm font-medium text-foreground">Booking as {user.name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {!isPatient && (
          <>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="booking-name">Full name</Label>
              <Input id="booking-name" placeholder="e.g. Rahul Sharma" {...register("name")} />
              {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-phone">Mobile number</Label>
              <Input id="booking-phone" placeholder="+91 9XXXXXXXXX" {...register("phone")} />
              {errors.phone && <p className="text-xs text-danger">{errors.phone.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-email">Email</Label>
              <Input id="booking-email" type="email" placeholder="you@example.com" {...register("email")} />
              {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
            </div>
          </>
        )}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="booking-reason">Reason for visit</Label>
          <Textarea id="booking-reason" rows={2} placeholder="e.g. Fever and cold, routine checkup..." {...register("reason")} />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {VISIT_REASONS.slice(0, 6).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setValue("reason", r, { shouldValidate: true })}
                className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {r}
              </button>
            ))}
          </div>
          {errors.reason && <p className="text-xs text-danger">{errors.reason.message}</p>}
        </div>
      </div>

      <Button type="submit" size="lg" className="mt-5 w-full sm:w-auto">
        Continue
      </Button>
    </form>
  );
}
