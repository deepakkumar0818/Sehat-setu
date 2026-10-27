import { platformRoute } from "@/server/api/route-handler";
import { getPlatformClinic, setPlatformClinicStatus } from "@/server/data/platform";

/** One clinic in detail: subscription and payments, branches, people, 6 months of usage. */
export const GET = platformRoute<{ id: string }>({ resource: "GET /api/v1/platform/clinics/[id]" }, ({ identity, params }) => getPlatformClinic(identity, params.id));

/** Suspend or reactivate a clinic: { status: "active" | "suspended" }. */
export const PATCH = platformRoute<{ id: string }>({ resource: "PATCH /api/v1/platform/clinics/[id]" }, async ({ identity, params, request }) =>
  setPlatformClinicStatus(identity, params.id, await request.json())
);
