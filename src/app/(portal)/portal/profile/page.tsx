"use client";

import { toast } from "sonner";
import { LivePortalHealthProfile } from "@/components/portal/live-portal-care";
import { useLiveData } from "@/lib/data-source";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { usePatient, useUpdatePatient } from "@/hooks/use-patients";
import { useDataStore } from "@/store/data-store";
import { useState, useEffect } from "react";

function DemoPortalProfilePage() {
  const user = useCurrentUser();
  const { data: patient, isLoading } = usePatient(user?.patientId);
  const branch = useDataStore((s) => (patient ? s.db.branches.find((b) => b.id === patient.branchId) : undefined));
  const updatePatient = useUpdatePatient();
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    if (patient) {
      setPhone(patient.phone);
      setEmail(patient.email);
      setAddress(patient.address);
    }
  }, [patient]);

  if (isLoading || !patient) return <Skeleton className="h-96 w-full rounded-xl" />;

  return (
    <div className="space-y-5">
      <PageHeader title="Profile" description="Your personal and contact information." />

      <Card>
        <CardContent className="flex items-center gap-4">
          <PersonAvatar name={patient.name} color={patient.avatarColor} size="xl" />
          <div>
            <p className="text-lg font-semibold text-foreground">{patient.name}</p>
            <p className="text-sm text-muted-foreground">{patient.id} · {patient.age} yrs · <span className="capitalize">{patient.gender}</span></p>
            <div className="mt-1.5 flex gap-1.5">
              <Badge variant="outline">Blood group: {patient.bloodGroup}</Badge>
              <Badge variant="outline">{branch?.name}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Contact information</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <Button
            disabled={updatePatient.isPending}
            onClick={() =>
              updatePatient.mutate(
                { id: patient.id, patch: { phone, email, address } },
                { onSuccess: () => toast.success("Profile updated.") }
              )
            }
          >
            {updatePatient.isPending ? "Saving…" : "Save changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Medical information</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-muted-foreground">Allergies:</span> {patient.allergies.length ? patient.allergies.join(", ") : "None known"}</p>
          <p><span className="text-muted-foreground">Chronic conditions:</span> {patient.chronicConditions.length ? patient.chronicConditions.join(", ") : "None recorded"}</p>
          <p><span className="text-muted-foreground">Emergency contact:</span> {patient.emergencyContact.name || "Not provided"} {patient.emergencyContact.phone && `· ${patient.emergencyContact.phone}`}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PortalProfilePage() {
  // Live (signed-in patient): their own records from the clinic database. Demo mode: the original mock page.
  return useLiveData() ? <LivePortalHealthProfile /> : <DemoPortalProfilePage />;
}
