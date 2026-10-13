import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Timeline } from "@/components/shared/timeline";
import { EmptyState } from "@/components/shared/empty-state";
import { AIPatientSummary } from "@/components/patients/ai-patient-summary";
import { formatDate } from "@/lib/format";
import { usePatientTimeline } from "@/hooks/use-patients";
import type { Patient } from "@/types";
import { useLiveData } from "@/lib/data-source";
import { NotConnected } from "@/components/shared/not-connected";

export function OverviewTab({ patient }: { patient: Patient }) {
  const { data: timeline, isLoading } = usePatientTimeline(patient.id);
  const live = useLiveData();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {live ? <Card><CardContent className="p-0"><NotConnected feature="AI summary and visit timeline" className="border-0" /></CardContent></Card> : <AIPatientSummary patientId={patient.id} />}
        {!live && <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent timeline</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="#timeline">View full timeline</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading timeline…</p>
            ) : timeline && timeline.length > 0 ? (
              <Timeline events={timeline.slice(0, 5)} />
            ) : (
              <EmptyState title="No activity yet" description="Timeline events will appear here once this patient has visits." className="border-0 py-8" />
            )}
          </CardContent>
        </Card>}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Medical information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Allergies</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {patient.allergies.length ? (
                  patient.allergies.map((a) => <Badge key={a} variant="outline" className="border-warning/30 text-warning">{a}</Badge>)
                ) : (
                  <span className="text-muted-foreground">None known</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Chronic conditions</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {patient.chronicConditions.length ? (
                  patient.chronicConditions.map((c) => <Badge key={c} variant="outline">{c}</Badge>)
                ) : (
                  <span className="text-muted-foreground">None recorded</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Emergency contact</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {patient.emergencyContact.name ? (
              <>
                <p className="font-medium text-foreground">{patient.emergencyContact.name}</p>
                <p className="text-muted-foreground">{patient.emergencyContact.relation} · {patient.emergencyContact.phone}</p>
              </>
            ) : (
              <p className="text-muted-foreground">Not provided</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registration</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Registered on {formatDate(patient.registeredDate)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
