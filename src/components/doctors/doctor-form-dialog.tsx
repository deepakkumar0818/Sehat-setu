"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CredentialsDialog } from "@/components/shared/credentials-dialog";
import { useLiveData } from "@/lib/data-source";
import { useCreateDoctor } from "@/hooks/use-people";
import { useBranches } from "@/hooks/use-branches";
import { DOCTOR_QUALIFICATIONS, SPECIALIZATIONS } from "@/data/pools";

const doctorSchema = z.object({
  name: z.string().min(2, "Enter the doctor's full name"),
  gender: z.enum(["male", "female", "other"]),
  qualifications: z.string().min(2, "Select or enter qualifications"),
  specialization: z.string().min(2, "Select or enter a specialization"),
  registrationNumber: z.string().optional(),
  experienceYears: z.coerce.number().int().min(0, "Enter years of experience").max(60),
  consultationFee: z.coerce.number().min(0, "Enter a consultation fee"),
  branchId: z.string().min(1, "Select a branch"),
  phone: z.string().min(7, "Enter a valid phone number"),
  email: z.string().email("Enter a valid email address"),
  onlineConsultation: z.boolean(),
  bio: z.string().optional(),
});

type DoctorFormValues = z.infer<typeof doctorSchema>;

interface DoctorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (doctorId: string) => void;
}

/**
 * DEMO ONLY: creates a mock doctor and shows the shared demo password.
 * Renders nothing with live data — real doctors join through invitations.
 */
export function DoctorFormDialog(props: DoctorFormDialogProps) {
  const live = useLiveData();
  return live ? null : <DemoDoctorFormDialog {...props} />;
}

function DemoDoctorFormDialog({ open, onOpenChange, onCreated }: DoctorFormDialogProps) {
  const branches = useBranches();
  const createDoctor = useCreateDoctor();
  const [newAccount, setNewAccount] = useState<{ id: string; name: string; email: string; phone: string; branchId: string } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DoctorFormValues>({
    resolver: zodResolver(doctorSchema),
    defaultValues: {
      gender: "male",
      branchId: branches[0]?.id ?? "",
      qualifications: DOCTOR_QUALIFICATIONS[0],
      specialization: SPECIALIZATIONS[0],
      onlineConsultation: true,
      experienceYears: 5,
      consultationFee: 500,
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: "",
        gender: "male",
        branchId: branches[0]?.id ?? "",
        qualifications: DOCTOR_QUALIFICATIONS[0],
        specialization: SPECIALIZATIONS[0],
        onlineConsultation: true,
        experienceYears: 5,
        consultationFee: 500,
        phone: "",
        email: "",
        bio: "",
      });
    }
  }, [open, branches, reset]);

  const onSubmit = (values: DoctorFormValues) => {
    createDoctor.mutate(values, {
      onSuccess: (doctor) => {
        toast.success(`${doctor.name} has been added.`);
        onOpenChange(false);
        setNewAccount({ id: doctor.id, name: doctor.name, email: doctor.email, phone: doctor.phone, branchId: doctor.branchId });
      },
      onError: () => toast.error("Could not add doctor. Please try again."),
    });
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add new doctor</DialogTitle>
          <DialogDescription>Create a doctor profile with their specialization, fee, and availability.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="doc-name">Full name</Label>
            <Input id="doc-name" placeholder="e.g. Anmol Sharma (without “Dr.”)" {...register("name")} />
            {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Select value={watch("gender")} onValueChange={(v) => setValue("gender", v as DoctorFormValues["gender"])}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Qualifications</Label>
            <Select value={watch("qualifications")} onValueChange={(v) => setValue("qualifications", v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCTOR_QUALIFICATIONS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Specialization</Label>
            <Select value={watch("specialization")} onValueChange={(v) => setValue("specialization", v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SPECIALIZATIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="doc-reg-number">Registration number (optional)</Label>
            <Input id="doc-reg-number" placeholder="e.g. MED-123456" {...register("registrationNumber")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-experience">Experience (years)</Label>
            <Input id="doc-experience" type="number" min={0} max={60} {...register("experienceYears")} />
            {errors.experienceYears && <p className="text-xs text-danger">{errors.experienceYears.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-fee">Consultation fee (₹)</Label>
            <Input id="doc-fee" type="number" min={0} step={50} {...register("consultationFee")} />
            {errors.consultationFee && <p className="text-xs text-danger">{errors.consultationFee.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="doc-phone">Phone</Label>
            <Input id="doc-phone" placeholder="+91 9XXXXXXXXX" {...register("phone")} />
            {errors.phone && <p className="text-xs text-danger">{errors.phone.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-email">Email</Label>
            <Input id="doc-email" type="email" placeholder="name@sehatsetu.demo" {...register("email")} />
            {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Branch</Label>
            <Select value={watch("branchId")} onValueChange={(v) => setValue("branchId", v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {errors.branchId && <p className="text-xs text-danger">{errors.branchId.message}</p>}
          </div>
          <div className="flex items-end justify-between rounded-md border px-3 py-2">
            <Label htmlFor="doc-online" className="text-sm">Offers online consultation</Label>
            <Switch id="doc-online" checked={watch("onlineConsultation")} onCheckedChange={(v) => setValue("onlineConsultation", v)} />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="doc-bio">Bio (optional)</Label>
            <Textarea id="doc-bio" rows={2} placeholder="Leave blank to generate one automatically" {...register("bio")} />
          </div>

          <DialogFooter className="col-span-2 mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createDoctor.isPending}>
              {createDoctor.isPending ? "Saving…" : "Add doctor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    {newAccount && (
      <CredentialsDialog
        open={Boolean(newAccount)}
        onOpenChange={(next) => !next && setNewAccount(null)}
        name={newAccount.name}
        email={newAccount.email}
        phone={newAccount.phone}
        role="Doctor"
        branchName={branches.find((b) => b.id === newAccount.branchId)?.name}
        onDone={() => {
          const id = newAccount.id;
          setNewAccount(null);
          onCreated?.(id);
        }}
      />
    )}
    </>
  );
}
