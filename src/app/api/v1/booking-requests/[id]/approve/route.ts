import { apiRoute } from "@/server/api/route-handler";
import { approveBookingRequest, BOOKING_REVIEW } from "@/server/data/booking-review";

/** Approve a pending request: re-checked by the database under the slot lock; it then joins the doctor's schedule. */
export const POST = apiRoute<{ id: string }>({ permission: BOOKING_REVIEW, resource: "POST /api/v1/booking-requests/[id]/approve" }, ({ ctx, params }) =>
  approveBookingRequest(ctx, params.id)
);
