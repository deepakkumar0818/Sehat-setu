import { ClinicLetterhead } from "@/components/shared/clinic-letterhead";
import { formatDate } from "@/lib/format";
import type { Prescription } from "@/types";

// Plain shapes so both the demo records (Patient/Doctor/Branch) and the clinic database's detail fields fit.
interface PrescriptionPreviewProps {
  prescription: Prescription;
  patient: { name: string; id?: string; patientNumber?: string; age?: number; gender?: string; allergies: string[] };
  doctor: { name: string; qualifications?: string; registrationNumber?: string };
  branch?: { name?: string; address?: string; phone?: string };
}

export function PrescriptionPreview({ prescription, patient, doctor, branch }: PrescriptionPreviewProps) {
  return (
    <div className="mx-auto max-w-2xl rounded-xl border bg-card p-6 print:max-w-none print:rounded-none print:border-0 print:p-0 sm:p-8">
      <ClinicLetterhead kind="prescription" branch={branch} />

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-b pb-4 text-sm">
        <div>
          <p className="font-semibold text-foreground">{patient.name}</p>
          <p className="text-muted-foreground">
            {[patient.patientNumber ?? patient.id, patient.age !== undefined ? `${patient.age} yrs` : undefined].filter(Boolean).join(" · ")}
            {patient.gender && <> · <span className="capitalize">{patient.gender}</span></>}
          </p>
          {patient.allergies.length > 0 && <p className="text-warning">Allergies: {patient.allergies.join(", ")}</p>}
        </div>
        <div className="text-right">
          <p className="font-semibold text-foreground">{doctor.name}</p>
          <p className="text-muted-foreground">{doctor.qualifications}</p>
          {doctor.registrationNumber && <p className="text-muted-foreground">Reg. no. {doctor.registrationNumber}</p>}
          <p className="text-muted-foreground">Date: {formatDate(prescription.date)}</p>
        </div>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">℞ Medicines</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 pr-2">Medicine</th>
              <th className="py-1.5 pr-2">Dosage</th>
              <th className="py-1.5 pr-2">Frequency</th>
              <th className="py-1.5 pr-2">Duration</th>
              <th className="py-1.5">Instructions</th>
            </tr>
          </thead>
          <tbody>
            {prescription.items.map((item, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="py-2 pr-2 font-medium text-foreground">{item.medicineName} <span className="text-muted-foreground">{item.strength}</span></td>
                <td className="py-2 pr-2">{item.dosage}{item.route ? <span className="text-muted-foreground"> · {item.route}</span> : null}</td>
                <td className="py-2 pr-2">{item.frequency}</td>
                <td className="py-2 pr-2">{item.duration}</td>
                <td className="py-2 text-muted-foreground">{item.instructions || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {prescription.notes && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
          <p className="text-sm text-foreground">{prescription.notes}</p>
        </div>
      )}

      <div className="mt-10 flex justify-end">
        <div className="text-center text-sm">
          <p className="border-t pt-1 text-foreground">{doctor.name}</p>
          <p className="text-xs text-muted-foreground">Digitally generated prescription</p>
        </div>
      </div>
    </div>
  );
}
