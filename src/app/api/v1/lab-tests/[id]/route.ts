import { apiRoute } from "@/server/api/route-handler";
import { LAB_TEST_MANAGE, updateLabTest } from "@/server/data/lab-tests";

/** Rename or recategorise a test, or { status } to deactivate/reactivate it. */
export const PATCH = apiRoute<{ id: string }>({ permission: LAB_TEST_MANAGE, resource: "PATCH /api/v1/lab-tests/[id]" }, async ({ ctx, params, request }) =>
  updateLabTest(ctx, params.id, await request.json())
);
