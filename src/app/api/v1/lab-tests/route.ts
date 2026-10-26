import { apiRoute } from "@/server/api/route-handler";
import { createLabTest, LAB_TEST_MANAGE, listLabTests } from "@/server/data/lab-tests";

/** The clinic's lab test master (any active staff member; doctors order from it). */
export const GET = apiRoute({ permission: [], resource: "GET /api/v1/lab-tests" }, ({ ctx }) => listLabTests(ctx));

/** Add a test to the list. */
export const POST = apiRoute({ permission: LAB_TEST_MANAGE, resource: "POST /api/v1/lab-tests" }, async ({ ctx, request }) =>
  createLabTest(ctx, await request.json())
);
