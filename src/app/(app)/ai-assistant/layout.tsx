import { guardStaffRoute } from "@/server/auth/session";

// Server-side permission check for /ai-assistant (see STAFF_ROUTE_PERMISSIONS).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await guardStaffRoute("/ai-assistant");
  return children;
}
