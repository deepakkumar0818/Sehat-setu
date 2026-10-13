"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreatePatient } from "@/hooks/use-patients";
import { useBranches } from "@/hooks/use-branches";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const patientSchema = z.object({
  name: z.string().min(2, "Enter the patient's full name"),
  age: z.coerce.number().int().min(0, "Age must be 0 or more").max(120, "Enter a valid age"),
  gender: z.enum(["male", "female", "other"]),
  phone: z.string().min(7, "Enter a valid phone number"),
  email: z.string().email("Enter a valid email address"),
  bloodGroup: z.string().min(1, "Select a blood group"),
  address: z.string().min(3, "Enter an address"),
  city: z.string().min(2, "Enter a city"),
  branchId: z.string().min(1, "Select a branch"),
});

type PatientFormValues = z.infer<typeof patientSchema>;

interface PatientFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (patientId: string) => void;
}

export function PatientFormDialog({ open, onOpenChange, onCreated }: PatientFormDialogProps) {
  const branches = useBranches();
  const createPatient = useCreatePatient();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<PatientFormValues>({
    resolver: zodResolver(patientSchema),
    defaultValues: { gender: "male", branchId: branches[0]?.id ?? "" },
  });

  useEffect(() => {
    if (open) reset({ gender: "male", branchId: branches[0]?.id ?? "" });
  }, [open, branches, reset]);

  const onSubmit = (values: PatientFormValues) => {
    createPatient.mutate(values, {
      onSuccess: (patient) => {
        toast.success(`${patient.name} has been added.`);
        onOpenChange(false);
        onCreated?.(patient.id);
      },
      onError: () => toast.error("Could not add patient. Please try again."),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add new patient</DialogTitle>
          <DialogDescription>Create a patient record to start booking appointments and consultations.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" placeholder="e.g. Rahul Sharma" {...register("name")} />
            {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="age">Age</Label>
            <Input id="age" type="number" min={0} max={120} {...register("age")} />
            {errors.age && <p className="text-xs text-danger">{errors.age.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Select value={watch("gender")} onValueChange={(v) => setValue("gender", v as PatientFormValues["gender"])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" placeholder="+91 9XXXXXXXXX" {...register("phone")} />
            {errors.phone && <p className="text-xs text-danger">{errors.phone.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Blood group</Label>
            <Select value={watch("bloodGroup")} onValueChange={(v) => setValue("bloodGroup", v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {BLOOD_GROUPS.map((bg) => (
                  <SelectItem key={bg} value={bg}>
                    {bg}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.bloodGroup && <p className="text-xs text-danger">{errors.bloodGroup.message}</p>}
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="name@example.com" {...register("email")} />
            {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input id="city" placeholder="e.g. Chandigarh" {...register("city")} />
            {errors.city && <p className="text-xs text-danger">{errors.city.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Branch</Label>
            <Select value={watch("branchId")} onValueChange={(v) => setValue("branchId", v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="address">Address</Label>
            <Input id="address" placeholder="House no., street, sector" {...register("address")} />
            {errors.address && <p className="text-xs text-danger">{errors.address.message}</p>}
          </div>
          <DialogFooter className="col-span-2 mt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createPatient.isPending}>
              {createPatient.isPending ? "Saving…" : "Add patient"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
