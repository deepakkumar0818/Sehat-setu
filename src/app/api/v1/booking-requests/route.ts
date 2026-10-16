import { apiRoute, searchParamsOf } from "@/server/api/route-handler";
import { BOOKING_REVIEW, listBookingRequests } from "@/server/data/booking-review";

/** Patient self-booked requests awaiting approval, in the caller's clinic and branch scope: ?branchId= */
export const GET = apiRoute({ permission: BOOKING_REVIEW, resource: "GET /api/v1/booking-requests" }, ({ ctx, request }) =>
  listBookingRequests(ctx, searchParamsOf(request))
);
