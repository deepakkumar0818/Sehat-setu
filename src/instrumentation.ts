import type { Instrumentation } from "next";
import { reportServerError } from "@/server/monitoring";

// Next.js calls this for server errors it captures: Server Component
// rendering, Route Handlers, Server Actions and the proxy. (/api/v1 routes
// catch their own errors in route-handler.ts, so they arrive here only if that
// wrapper itself fails.) Only the ROUTE TEMPLATE, request method, route type
// and the data-free error summary are reported — never the request path or
// query string (they can carry ids or search terms), headers, cookies or body.
//
// This does not replace Next.js's own error output in the hosting logs; see
// docs/security.md ("Monitoring and alerting").
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const method = /^[A-Z]{3,7}$/.test(request.method) ? request.method : "OTHER";
  reportServerError(`${context.routeType} ${method} ${context.routePath}`, err);
};
