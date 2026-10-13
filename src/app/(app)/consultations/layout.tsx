import { guardStaffRoute } from "@/server/auth/session";

// Server-side permission check for /consultations (see STAFF_ROUTE_PERMISSIONS).
export default async function Layout({ children }: { children: React.ReactNode }) {
  await guardStaffRoute("/consultations");
  return children;
}
