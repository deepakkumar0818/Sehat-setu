import { apiRoute } from "@/server/api/route-handler";
import { DOCTOR_MANAGE, getDoctor, removeDoctor, setDoctorStatus } from "@/server/data/people";

export const GET = apiRoute<{ id: string }>({ permission: [], resource: "GET /api/v1/doctors/[id]" }, ({ ctx, params }) => getDoctor(ctx, params.id));

/** Suspend or reactivate a doctor: { status: "active" | "inactive" } (Administrators). */
export const PATCH = apiRoute<{ id: string }>({ permission: DOCTOR_MANAGE, resource: "PATCH /api/v1/doctors/[id]" }, async ({ ctx, params, request }) =>
  setDoctorStatus(ctx, params.id, await request.json())
);

/** Permanently delete a doctor with no appointments or lab reports (Administrators). */
export const DELETE = apiRoute<{ id: string }>({ permission: DOCTOR_MANAGE, resource: "DELETE /api/v1/doctors/[id]" }, ({ ctx, params }) => removeDoctor(ctx, params.id));
