import type { UserRole } from "@/types";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Armchair,
  Stethoscope,
  FileSignature,
  FlaskConical,
  FolderOpen,
  UserRoundCog,
  Contact,
  Boxes,
  Receipt,
  Wallet,
  LineChart,
  Sparkles,
  Bell,
  Settings,
  ScrollText,
  CreditCard,
  Home,
  Video,
  FileText,
  User,
  Building2,
  Layers,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export interface NavLeaf {
  label: string;
  href: string;
  icon: LucideIcon;
  badgeKey?: "waitingCount" | "notificationCount" | "lowStockCount";
}

export interface NavGroup {
  label?: string;
  items: NavLeaf[];
}

const overview: NavGroup = {
  items: [{ label: "Overview", href: "/dashboard", icon: LayoutDashboard }],
};

const adminNav: NavGroup[] = [
  overview,
  {
    items: [
      { label: "Patients", href: "/patients", icon: Users },
      { label: "Appointments", href: "/appointments", icon: CalendarDays },
      { label: "Waiting Room", href: "/waiting-room", icon: Armchair, badgeKey: "waitingCount" },
    ],
  },
  {
    label: "Clinical",
    items: [
      { label: "Consultations", href: "/consultations", icon: Stethoscope },
      { label: "Prescriptions", href: "/prescriptions", icon: FileSignature },
      { label: "Reports", href: "/reports", icon: FlaskConical },
      { label: "Documents", href: "/documents", icon: FolderOpen },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Doctors", href: "/doctor-roster", icon: UserRoundCog },
      { label: "Staff", href: "/staff", icon: Contact },
      { label: "Inventory", href: "/inventory", icon: Boxes, badgeKey: "lowStockCount" },
      { label: "Billing", href: "/billing", icon: Receipt },
      { label: "Expenses", href: "/expenses", icon: Wallet },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Analytics", href: "/analytics", icon: LineChart },
      { label: "AI Assistant", href: "/ai-assistant", icon: Sparkles },
    ],
  },
  {
    label: "Communication",
    items: [{ label: "Notifications", href: "/notifications", icon: Bell, badgeKey: "notificationCount" }],
  },
  {
    label: "Management",
    items: [
      { label: "Branches", href: "/clinic/branches", icon: Building2 },
      { label: "Departments", href: "/clinic/departments", icon: Layers },
      { label: "Specialties", href: "/clinic/specialties", icon: Stethoscope },
      { label: "Users & Roles", href: "/clinic/users", icon: ShieldCheck },
    ],
  },
  {
    items: [
      { label: "Audit Log", href: "/audit-log", icon: ScrollText },
      { label: "Subscription", href: "/subscription", icon: CreditCard },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

const doctorNav: NavGroup[] = [
  { items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }] },
  {
    items: [
      { label: "Today's Patients", href: "/waiting-room", icon: Armchair, badgeKey: "waitingCount" },
      { label: "Appointments", href: "/appointments", icon: CalendarDays },
      { label: "Consultations", href: "/consultations", icon: Stethoscope },
      { label: "Prescriptions", href: "/prescriptions", icon: FileSignature },
      { label: "Reports", href: "/reports", icon: FlaskConical },
      { label: "Patients", href: "/patients", icon: Users },
    ],
  },
  {
    items: [
      { label: "AI Assistant", href: "/ai-assistant", icon: Sparkles },
      { label: "Notifications", href: "/notifications", icon: Bell, badgeKey: "notificationCount" },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

const receptionistNav: NavGroup[] = [
  overview,
  {
    items: [
      { label: "Patients", href: "/patients", icon: Users },
      { label: "Appointments", href: "/appointments", icon: CalendarDays },
      { label: "Waiting Room", href: "/waiting-room", icon: Armchair, badgeKey: "waitingCount" },
      { label: "Billing", href: "/billing", icon: Receipt },
    ],
  },
  {
    items: [
      { label: "Notifications", href: "/notifications", icon: Bell, badgeKey: "notificationCount" },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

const nurseNav: NavGroup[] = [
  overview,
  {
    items: [
      { label: "Waiting Room", href: "/waiting-room", icon: Armchair, badgeKey: "waitingCount" },
      { label: "Patients", href: "/patients", icon: Users },
      { label: "Appointments", href: "/appointments", icon: CalendarDays },
    ],
  },
  { items: [{ label: "Settings", href: "/settings", icon: Settings }] },
];

const pharmacistNav: NavGroup[] = [
  overview,
  {
    items: [
      { label: "Inventory", href: "/inventory", icon: Boxes, badgeKey: "lowStockCount" },
      { label: "Prescriptions", href: "/prescriptions", icon: FileSignature },
      { label: "Billing", href: "/billing", icon: Receipt },
    ],
  },
  { items: [{ label: "Settings", href: "/settings", icon: Settings }] },
];

const labStaffNav: NavGroup[] = [
  overview,
  {
    items: [
      { label: "Reports", href: "/reports", icon: FlaskConical },
      { label: "Patients", href: "/patients", icon: Users },
    ],
  },
  { items: [{ label: "Settings", href: "/settings", icon: Settings }] },
];

const branchManagerNav: NavGroup[] = [
  overview,
  {
    items: [
      { label: "Patients", href: "/patients", icon: Users },
      { label: "Appointments", href: "/appointments", icon: CalendarDays },
      { label: "Waiting Room", href: "/waiting-room", icon: Armchair, badgeKey: "waitingCount" },
      { label: "Doctors", href: "/doctor-roster", icon: UserRoundCog },
      { label: "Staff", href: "/staff", icon: Contact },
    ],
  },
  {
    items: [
      { label: "Inventory", href: "/inventory", icon: Boxes, badgeKey: "lowStockCount" }, // view-only for their branch
      { label: "Billing", href: "/billing", icon: Receipt },
      { label: "Reports", href: "/reports", icon: FlaskConical },
    ],
  },
  { items: [{ label: "Settings", href: "/settings", icon: Settings }] },
];

const billingStaffNav: NavGroup[] = [
  overview,
  {
    items: [
      { label: "Billing", href: "/billing", icon: Receipt },
      { label: "Payments", href: "/billing", icon: Wallet },
    ],
  },
  { items: [{ label: "Settings", href: "/settings", icon: Settings }] },
];

const accountantNav: NavGroup[] = [
  overview,
  {
    items: [
      { label: "Billing", href: "/billing", icon: Receipt },
      { label: "Analytics", href: "/analytics", icon: LineChart },
    ],
  },
  { items: [{ label: "Settings", href: "/settings", icon: Settings }] },
];

const superAdminNav: NavGroup[] = adminNav;

export const NAV_CONFIG: Record<UserRole, NavGroup[]> = {
  super_admin: superAdminNav,
  clinic_owner: adminNav,
  clinic_admin: adminNav,
  branch_manager: branchManagerNav,
  doctor: doctorNav,
  receptionist: receptionistNav,
  nurse: nurseNav,
  pharmacist: pharmacistNav,
  lab_staff: labStaffNav,
  billing_staff: billingStaffNav,
  accountant: accountantNav,
  patient: [],
};

export const PATIENT_PORTAL_NAV: NavLeaf[] = [
  { label: "Home", href: "/portal", icon: Home },
  { label: "Appointments", href: "/portal/appointments", icon: CalendarDays },
  { label: "Consultations", href: "/portal/consultations", icon: Video },
  { label: "Prescriptions", href: "/portal/prescriptions", icon: FileSignature },
  { label: "Reports", href: "/portal/reports", icon: FlaskConical },
  { label: "Documents", href: "/portal/documents", icon: FileText },
  { label: "Payments", href: "/portal/payments", icon: Wallet },
  { label: "AI Assistant", href: "/portal/ai-assistant", icon: Sparkles },
  { label: "Profile", href: "/portal/profile", icon: User },
];
