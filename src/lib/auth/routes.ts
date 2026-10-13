// Which routes need a signed-in user, and which permission each staff route
// requires. The proxy uses PROTECTED_PREFIXES for the fast "are you signed in"
// redirect; the authoritative check is guardRoute() in each segment's server
// layout (src/server/auth/session.ts), which verifies the session with Supabase
// and the permission against the user's clinic membership in the database.
//
// Permission keys come from src/data/permission-catalog.ts. A route lists the
// keys that grant access — holding ANY one of them is enough. An empty list
// means "any active staff member of the clinic".

export const STAFF_ROUTE_PERMISSIONS: Record<string, readonly string[]> = {
  "/dashboard": [],
  "/ai-assistant": [],
  "/notifications": [],
  "/settings": [],
  "/patients": ["patient.view", "patient.basic_info.view", "assigned_patients.view"],
  "/appointments": ["appointment.view", "own_appointments.view"],
  "/waiting-room": ["checkin.manage", "appointment.view", "own_appointments.view"],
  "/consultations": ["medical_record.view", "patient.medical_record.view"],
  "/prescriptions": ["prescription.view", "prescription.manage", "medicine.dispense"],
  "/reports": ["lab_report.view", "lab.manage", "medical_record.view"],
  "/documents": ["medical_record.view", "patient.medical_record.view"],
  "/doctor-roster": ["doctor.view", "doctor.manage"],
  "/staff": ["staff.view", "staff.manage", "user.view"],
  "/inventory": ["pharmacy.manage", "pharmacy.inventory.manage", "pharmacy.inventory.view"],
  "/billing": ["billing.view", "invoice.view"],
  "/expenses": ["billing.manage", "financial_reports.view"],
  "/analytics": ["reports.view", "financial_reports.view"],
  "/audit-log": ["clinic.settings.manage", "role.manage"],
  "/subscription": ["clinic.update"],
  "/clinic": ["clinic.view", "branch.view"],
  "/clinic/settings/roles": ["role.manage"],
};

export const PORTAL_PREFIX = "/portal";

/** Pages for any signed-in user, before they belong to a clinic (e.g. accepting a staff invitation). */
export const IDENTITY_PREFIXES: readonly string[] = ["/invitations"];

export const PROTECTED_PREFIXES: readonly string[] = [...Object.keys(STAFF_ROUTE_PERMISSIONS), PORTAL_PREFIX, ...IDENTITY_PREFIXES];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

/**
 * Permission keys for a staff path, using the most specific configured prefix.
 * Returns undefined for paths that are not staff routes — callers must treat
 * that as "deny", never as "no requirement".
 */
export function staffRoutePermissions(pathname: string): readonly string[] | undefined {
  const match = Object.keys(STAFF_ROUTE_PERMISSIONS)
    .filter((prefix) => matchesPrefix(pathname, prefix))
    .sort((a, b) => b.length - a.length)[0];
  return match === undefined ? undefined : STAFF_ROUTE_PERMISSIONS[match];
}

/** Only same-origin relative paths are allowed as post-login redirects (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return fallback;
  return next;
}
