import { apiRoute } from "@/server/api/route-handler";
import { BOOKING_REVIEW, rejectBookingRequest } from "@/server/data/booking-review";

/** Decline a pending request with a reason for the patient (3–300 characters). The slot is freed; the row is kept. */
export const POST = apiRoute<{ id: string }>({ permission: BOOKING_REVIEW, resource: "POST /api/v1/booking-requests/[id]/reject" }, async ({ ctx, params, request }) =>
  rejectBookingRequest(ctx, params.id, await request.json())
);
