import { apiRoute } from "@/server/api/route-handler";
import { AuthError } from "@/server/auth/errors";
import { isTransition, transitionAppointment } from "@/server/data/appointments";

/** POST /api/v1/appointments/:id/check-in | cancel | no-show — each action re-checks its own permission. */
export const POST = apiRoute<{ id: string; action: string }>(
  { permission: ["checkin.manage", "appointment.update", "appointment.cancel", "own_appointments.manage"], resource: "POST /api/v1/appointments/[id]/[action]" },
  ({ ctx, params }) => {
    if (!isTransition(params.action)) throw new AuthError("NOT_FOUND");
    return transitionAppointment(ctx, params.id, params.action);
  }
);
