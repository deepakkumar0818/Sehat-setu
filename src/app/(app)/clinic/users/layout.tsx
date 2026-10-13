import { redirect } from "next/navigation";
import { isSupabaseAuthEnabled } from "@/lib/auth/config";

// This page lists the in-browser demo users. With Supabase Auth (live data) the
// real directory and invitations are on /staff, so never render the demo list.
export default function Layout({ children }: { children: React.ReactNode }) {
  if (isSupabaseAuthEnabled()) redirect("/staff");
  return children;
}
