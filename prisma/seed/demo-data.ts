// Sehat Setu demo dataset — pure, deterministic, no database access.
//
// buildDemoData(now) returns every row the seed inserts, keyed by table, with
// stable UUIDs (see demoId). Given the same `now` it always returns identical
// data, which is what makes the seed idempotent: re-running it re-inserts the
// same primary keys, and the writer skips rows that already exist.
//
// All people, contact details, and medical information here are fictional.
// Emails use the reserved example.com domain; phone numbers use the "+91 00000"
// prefix, which no real Indian mobile number can have.
import { createHash } from "node:crypto";
import { Rng } from "../../src/lib/rng";
import { PERMISSION_CATALOG, ROLE_PERMISSION_DEFAULTS } from "../../src/data/permission-catalog";
import type { Prisma } from "../../src/generated/prisma/client";
import type {
  AppointmentStatus,
  AppointmentType,
  Gender,
  InvoiceStatus,
  PaymentMethod,
  RoleKey,
} from "../../src/generated/prisma/enums";
import type { UserRole } from "../../src/types";

// ---------------------------------------------------------------------------
// Deterministic ids
// ---------------------------------------------------------------------------

/** A stable, RFC 4122-shaped (v5-style, SHA-1 name-based) UUID for a seed entity key like "clinic:AAR". */
export function demoId(key: string): string {
  const hex = createHash("sha1").update(`sehat-setu-demo:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5"; // version 5
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // RFC 4122 variant
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Time helpers — demo clinics operate in IST (UTC+05:30)
// ---------------------------------------------------------------------------

const IST_OFFSET_MS = 330 * 60 * 1000;

/** The UTC instant for a wall-clock time in IST, `dayOffset` days from `now`'s IST date. */
function istInstant(now: Date, dayOffset: number, time: string): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const [h, m] = time.split(":").map(Number);
  const utcMs = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + dayOffset, h, m) - IST_OFFSET_MS;
  return new Date(utcMs);
}

/** A @db.Date value (midnight UTC) for the IST calendar date `dayOffset` days from `now`. */
function istDate(now: Date, dayOffset: number): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + dayOffset));
}

const rupees = (inr: number) => inr * 100;

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const CLINICS = [
  {
    code: "AAR",
    name: "Aarogya Multispeciality Clinic",
    email: "contact@aarogya.example.com",
    phone: "+91 00000 10000",
    addressLine: "12 Lakeview Road",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411038",
    brandColor: "#2563EB",
  },
  {
    code: "NIR",
    name: "Nirmaya Family Health",
    email: "hello@nirmaya.example.com",
    phone: "+91 00000 20000",
    addressLine: "4th Cross, Garden Layout",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560038",
    brandColor: "#0D9488",
  },
] as const;

type ClinicCode = (typeof CLINICS)[number]["code"];

const BRANCHES: { key: string; clinic: ClinicCode; code: string; name: string; addressLine: string; city: string; isHeadOffice: boolean }[] = [
  { key: "AAR-KTH", clinic: "AAR", code: "KTH", name: "Aarogya — Kothrud", addressLine: "12 Lakeview Road, Kothrud", city: "Pune", isHeadOffice: true },
  { key: "AAR-WKD", clinic: "AAR", code: "WKD", name: "Aarogya — Wakad", addressLine: "7 Riverside Plaza, Wakad", city: "Pune", isHeadOffice: false },
  { key: "NIR-IND", clinic: "NIR", code: "IND", name: "Nirmaya — Indiranagar", addressLine: "4th Cross, Garden Layout, Indiranagar", city: "Bengaluru", isHeadOffice: true },
];

const SPECIALTIES = [
  { key: "general-medicine", name: "General Medicine", description: "Primary care for common acute and chronic conditions." },
  { key: "cardiology", name: "Cardiology", description: "Heart and blood-vessel care." },
  { key: "pediatrics", name: "Pediatrics", description: "Care for infants, children and adolescents." },
  { key: "dermatology", name: "Dermatology", description: "Skin, hair and nail conditions." },
  { key: "orthopedics", name: "Orthopedics", description: "Bones, joints and musculoskeletal injuries." },
  { key: "gynecology", name: "Gynecology", description: "Women's reproductive health." },
] as const;

type SpecialtyKey = (typeof SPECIALTIES)[number]["key"];

/** branch null = clinic-wide department. */
const DEPARTMENTS: { key: string; clinic: ClinicCode; branch: string | null; specialty: SpecialtyKey; name: string }[] = [
  { key: "AAR-GEN", clinic: "AAR", branch: null, specialty: "general-medicine", name: "General Medicine" },
  { key: "AAR-CAR", clinic: "AAR", branch: "AAR-KTH", specialty: "cardiology", name: "Cardiology" },
  { key: "AAR-ORT", clinic: "AAR", branch: "AAR-KTH", specialty: "orthopedics", name: "Orthopedics" },
  { key: "AAR-PED", clinic: "AAR", branch: "AAR-WKD", specialty: "pediatrics", name: "Pediatrics" },
  { key: "AAR-DER", clinic: "AAR", branch: "AAR-WKD", specialty: "dermatology", name: "Dermatology" },
  { key: "NIR-GEN", clinic: "NIR", branch: "NIR-IND", specialty: "general-medicine", name: "General Medicine" },
  { key: "NIR-GYN", clinic: "NIR", branch: "NIR-IND", specialty: "gynecology", name: "Obstetrics & Gynecology" },
  { key: "NIR-PED", clinic: "NIR", branch: "NIR-IND", specialty: "pediatrics", name: "Pediatrics" },
];

const DOCTORS: {
  key: string;
  clinic: ClinicCode;
  name: string;
  specialty: SpecialtyKey;
  department: string;
  qualifications: string;
  experienceYears: number;
  feeInr: number;
  branches: string[]; // first = primary
  online: boolean;
}[] = [
  { key: "DR-01", clinic: "AAR", name: "Dr. Meera Kulkarni", specialty: "general-medicine", department: "AAR-GEN", qualifications: "MBBS, MD (Internal Medicine)", experienceYears: 14, feeInr: 600, branches: ["AAR-KTH", "AAR-WKD"], online: true },
  { key: "DR-02", clinic: "AAR", name: "Dr. Arjun Deshpande", specialty: "cardiology", department: "AAR-CAR", qualifications: "MBBS, MD, DM (Cardiology)", experienceYears: 18, feeInr: 1200, branches: ["AAR-KTH"], online: false },
  { key: "DR-03", clinic: "AAR", name: "Dr. Sana Qureshi", specialty: "orthopedics", department: "AAR-ORT", qualifications: "MBBS, MS (Orthopaedics)", experienceYears: 9, feeInr: 900, branches: ["AAR-KTH"], online: false },
  { key: "DR-04", clinic: "AAR", name: "Dr. Rohan Joshi", specialty: "pediatrics", department: "AAR-PED", qualifications: "MBBS, DCH", experienceYears: 11, feeInr: 700, branches: ["AAR-WKD"], online: true },
  { key: "DR-05", clinic: "AAR", name: "Dr. Kavya Iyer", specialty: "dermatology", department: "AAR-DER", qualifications: "MBBS, MD (Dermatology)", experienceYears: 7, feeInr: 800, branches: ["AAR-WKD"], online: true },
  { key: "DR-06", clinic: "NIR", name: "Dr. Vikram Rao", specialty: "general-medicine", department: "NIR-GEN", qualifications: "MBBS, MD (General Medicine)", experienceYears: 20, feeInr: 500, branches: ["NIR-IND"], online: true },
  { key: "DR-07", clinic: "NIR", name: "Dr. Ananya Hegde", specialty: "gynecology", department: "NIR-GYN", qualifications: "MBBS, MS (Obstetrics & Gynaecology)", experienceYears: 12, feeInr: 1000, branches: ["NIR-IND"], online: false },
  { key: "DR-08", clinic: "NIR", name: "Dr. Farhan Siddiqui", specialty: "pediatrics", department: "NIR-PED", qualifications: "MBBS, MD (Paediatrics)", experienceYears: 6, feeInr: 650, branches: ["NIR-IND"], online: true },
];

/** branch null = clinic-wide membership. */
const STAFF: { key: string; clinic: ClinicCode; branch: string | null; role: RoleKey; name: string }[] = [
  { key: "ST-01", clinic: "AAR", branch: null, role: "ADMINISTRATOR", name: "Priya Nair" },
  { key: "ST-02", clinic: "AAR", branch: "AAR-WKD", role: "CLINIC_MANAGER", name: "Siddharth Patil" },
  { key: "ST-03", clinic: "AAR", branch: "AAR-KTH", role: "RECEPTIONIST", name: "Neha Gokhale" },
  { key: "ST-04", clinic: "AAR", branch: "AAR-WKD", role: "RECEPTIONIST", name: "Imran Shaikh" },
  { key: "ST-05", clinic: "AAR", branch: "AAR-KTH", role: "NURSE", name: "Lata Pawar" },
  { key: "ST-06", clinic: "AAR", branch: "AAR-WKD", role: "NURSE", name: "Joseph D'Souza" },
  { key: "ST-07", clinic: "NIR", branch: null, role: "ADMINISTRATOR", name: "Deepa Raghavan" },
  { key: "ST-08", clinic: "NIR", branch: "NIR-IND", role: "RECEPTIONIST", name: "Karthik Gowda" },
  { key: "ST-09", clinic: "NIR", branch: "NIR-IND", role: "NURSE", name: "Shalini Murthy" },
];

const ROLES: { key: RoleKey; name: string; description: string; permissionsFrom: UserRole }[] = [
  { key: "ADMINISTRATOR", name: "Administrator", description: "Runs day-to-day clinic operations across branches.", permissionsFrom: "clinic_admin" },
  { key: "CLINIC_MANAGER", name: "Clinic Manager", description: "Manages one assigned branch.", permissionsFrom: "branch_manager" },
  { key: "DOCTOR", name: "Doctor", description: "Consultations, prescriptions and patient records.", permissionsFrom: "doctor" },
  { key: "RECEPTIONIST", name: "Receptionist", description: "Appointments, check-ins and front-desk billing.", permissionsFrom: "receptionist" },
  { key: "NURSE", name: "Nurse", description: "Vitals capture and clinical assistance.", permissionsFrom: "nurse" },
  { key: "PATIENT", name: "Patient", description: "Access to their own health records.", permissionsFrom: "patient" },
];

const MEDICINES: { key: string; name: string; genericName: string; strength: string; dosageForm: Prisma.MedicineCreateManyInput["dosageForm"] }[] = [
  { key: "paracetamol-650", name: "Paracetamol", genericName: "Paracetamol", strength: "650 mg", dosageForm: "TABLET" },
  { key: "azithromycin-500", name: "Azithromycin", genericName: "Azithromycin", strength: "500 mg", dosageForm: "TABLET" },
  { key: "amoxiclav-625", name: "Amoxicillin-Clavulanate", genericName: "Amoxicillin + Clavulanic acid", strength: "625 mg", dosageForm: "TABLET" },
  { key: "cetirizine-10", name: "Cetirizine", genericName: "Cetirizine", strength: "10 mg", dosageForm: "TABLET" },
  { key: "pantoprazole-40", name: "Pantoprazole", genericName: "Pantoprazole", strength: "40 mg", dosageForm: "TABLET" },
  { key: "metformin-500", name: "Metformin", genericName: "Metformin", strength: "500 mg", dosageForm: "TABLET" },
  { key: "amlodipine-5", name: "Amlodipine", genericName: "Amlodipine", strength: "5 mg", dosageForm: "TABLET" },
  { key: "atorvastatin-10", name: "Atorvastatin", genericName: "Atorvastatin", strength: "10 mg", dosageForm: "TABLET" },
  { key: "aspirin-75", name: "Aspirin", genericName: "Acetylsalicylic acid", strength: "75 mg", dosageForm: "TABLET" },
  { key: "ibuprofen-400", name: "Ibuprofen", genericName: "Ibuprofen", strength: "400 mg", dosageForm: "TABLET" },
  { key: "diclofenac-gel", name: "Diclofenac Gel", genericName: "Diclofenac", strength: "1% w/w", dosageForm: "OINTMENT" },
  { key: "calcium-d3", name: "Calcium + Vitamin D3", genericName: "Calcium carbonate + Cholecalciferol", strength: "500 mg / 250 IU", dosageForm: "TABLET" },
  { key: "paracetamol-syrup", name: "Paracetamol Syrup", genericName: "Paracetamol", strength: "120 mg/5 ml", dosageForm: "SYRUP" },
  { key: "ors", name: "Oral Rehydration Salts", genericName: "ORS (WHO formula)", strength: "21 g sachet", dosageForm: "SYRUP" },
  { key: "clotrimazole-cream", name: "Clotrimazole Cream", genericName: "Clotrimazole", strength: "1% w/w", dosageForm: "OINTMENT" },
  { key: "folic-acid-5", name: "Folic Acid", genericName: "Folic acid", strength: "5 mg", dosageForm: "TABLET" },
  { key: "salbutamol-inhaler", name: "Salbutamol Inhaler", genericName: "Salbutamol", strength: "100 mcg/dose", dosageForm: "INHALER" },
];

/** Synthetic visit reasons, diagnoses, and medicines per specialty. */
const CLINICAL: Record<SpecialtyKey, { reasons: string[]; diagnoses: string[]; medicines: string[] }> = {
  "general-medicine": {
    reasons: ["Fever and body ache", "Persistent cough", "Diabetes review", "Acidity and bloating", "Routine health check"],
    diagnoses: ["Viral fever", "Acute bronchitis", "Type 2 diabetes mellitus — follow-up", "Gastritis", "Upper respiratory tract infection"],
    medicines: ["paracetamol-650", "azithromycin-500", "cetirizine-10", "pantoprazole-40", "metformin-500", "amoxiclav-625"],
  },
  cardiology: {
    reasons: ["Blood pressure review", "Chest discomfort on exertion", "Palpitations", "Lipid profile review"],
    diagnoses: ["Essential hypertension", "Stable angina — evaluation", "Dyslipidemia", "Sinus tachycardia"],
    medicines: ["amlodipine-5", "atorvastatin-10", "aspirin-75"],
  },
  orthopedics: {
    reasons: ["Knee pain", "Lower back pain", "Shoulder stiffness", "Ankle sprain follow-up"],
    diagnoses: ["Osteoarthritis of knee", "Mechanical low back pain", "Adhesive capsulitis", "Grade I ankle sprain"],
    medicines: ["ibuprofen-400", "diclofenac-gel", "calcium-d3"],
  },
  pediatrics: {
    reasons: ["Fever in child", "Vaccination visit", "Loose motions", "Wheezing"],
    diagnoses: ["Viral fever", "Acute gastroenteritis", "Reactive airway disease", "Well-child visit — normal growth"],
    medicines: ["paracetamol-syrup", "ors", "salbutamol-inhaler", "cetirizine-10"],
  },
  dermatology: {
    reasons: ["Itchy skin rash", "Acne", "Fungal infection", "Hair fall"],
    diagnoses: ["Allergic contact dermatitis", "Acne vulgaris", "Tinea corporis", "Telogen effluvium"],
    medicines: ["clotrimazole-cream", "cetirizine-10"],
  },
  gynecology: {
    reasons: ["Antenatal check-up", "Irregular cycles", "Routine gynecological exam"],
    diagnoses: ["Normal pregnancy — routine antenatal care", "Polycystic ovarian syndrome", "Iron-deficiency anaemia"],
    medicines: ["folic-acid-5", "calcium-d3", "metformin-500"],
  },
};

const FREQUENCIES = ["Once daily", "Twice daily", "Three times daily", "At bedtime", "As needed for pain"];

const FIRST_NAMES_F = ["Aditi", "Bhavna", "Divya", "Gauri", "Ishita", "Jyoti", "Kiran", "Lakshmi", "Madhuri", "Nandini", "Pooja", "Rutuja", "Sneha", "Tanvi", "Uma"];
const FIRST_NAMES_M = ["Abhay", "Chetan", "Darshan", "Ganesh", "Harsh", "Kunal", "Manoj", "Nikhil", "Omkar", "Pranav", "Rahul", "Sameer", "Tushar", "Varun", "Yash"];
const LAST_NAMES = ["Apte", "Bhosale", "Chavan", "Dixit", "Gadgil", "Hegde", "Kamath", "Kale", "Menon", "Naik", "Prabhu", "Rane", "Shetty", "Thakur", "Wagle"];
const BLOOD_GROUPS = ["A+", "B+", "O+", "AB+", "A-", "B-", "O-"];
const ALLERGIES = ["Penicillin", "Sulfa drugs", "Peanuts", "Dust mites"];
const CHRONIC = ["Hypertension", "Type 2 diabetes", "Asthma", "Hypothyroidism"];

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface DemoData {
  clinics: Prisma.ClinicCreateManyInput[];
  branches: Prisma.BranchCreateManyInput[];
  specialties: Prisma.SpecialtyCreateManyInput[];
  departments: Prisma.DepartmentCreateManyInput[];
  roles: Prisma.RoleCreateManyInput[];
  permissions: Prisma.PermissionCreateManyInput[];
  rolePermissions: Prisma.RolePermissionCreateManyInput[];
  users: Prisma.UserCreateManyInput[];
  memberships: Prisma.ClinicMembershipCreateManyInput[];
  doctorProfiles: Prisma.DoctorProfileCreateManyInput[];
  doctorBranches: Prisma.DoctorBranchCreateManyInput[];
  patients: Prisma.PatientCreateManyInput[];
  medicines: Prisma.MedicineCreateManyInput[];
  appointments: Prisma.AppointmentCreateManyInput[];
  consultations: Prisma.ConsultationCreateManyInput[];
  prescriptions: Prisma.PrescriptionCreateManyInput[];
  prescriptionItems: Prisma.PrescriptionItemCreateManyInput[];
  invoices: Prisma.InvoiceCreateManyInput[];
  invoiceLineItems: Prisma.InvoiceLineItemCreateManyInput[];
  payments: Prisma.PaymentCreateManyInput[];
  /** Patient records to link to a portal user — applied only where patients.userId is still empty. */
  patientLinks: { patientId: string; userId: string }[];
}

const SEED = 20261012;
const SLOT_TIMES = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00"];

function emailFor(name: string, domain: string): string {
  return `${name.replace(/^Dr\.\s*/, "").toLowerCase().replace(/[^a-z\s]/g, "").trim().replace(/\s+/g, ".")}@${domain}`;
}

function fakePhone(n: number): string {
  return `+91 00000 ${String(n).padStart(5, "0")}`;
}

function shuffled<T>(rng: Rng, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function buildDemoData(now: Date): DemoData {
  const rng = new Rng(SEED);
  const clinicId = (code: ClinicCode) => demoId(`clinic:${code}`);
  const branchId = (key: string) => demoId(`branch:${key}`);
  const specialtyId = (key: string) => demoId(`specialty:${key}`);
  const departmentId = (key: string) => demoId(`department:${key}`);
  const roleId = (key: RoleKey) => demoId(`role:${key}`);
  const medicineId = (key: string) => demoId(`medicine:${key}`);
  const domainOf = (code: ClinicCode) => (code === "AAR" ? "aarogya.example.com" : "nirmaya.example.com");

  // --- Tenancy ---------------------------------------------------------------
  const clinics: DemoData["clinics"] = CLINICS.map((c) => ({ id: clinicId(c.code), ...c, currency: "INR", status: "ACTIVE" }));

  const branches: DemoData["branches"] = BRANCHES.map((b, i) => ({
    id: branchId(b.key),
    clinicId: clinicId(b.clinic),
    code: b.code,
    name: b.name,
    addressLine: b.addressLine,
    city: b.city,
    phone: fakePhone(10001 + i),
    email: `${b.code.toLowerCase()}@${domainOf(b.clinic)}`,
    isHeadOffice: b.isHeadOffice,
    status: "ACTIVE",
  }));

  const specialties: DemoData["specialties"] = SPECIALTIES.map((s) => ({ id: specialtyId(s.key), name: s.name, description: s.description }));

  const departments: DemoData["departments"] = DEPARTMENTS.map((d) => ({
    id: departmentId(d.key),
    clinicId: clinicId(d.clinic),
    branchId: d.branch ? branchId(d.branch) : null,
    specialtyId: specialtyId(d.specialty),
    name: d.name,
    status: "ACTIVE",
  }));

  // --- Roles & permissions (keys reuse the app's existing permission catalog) --
  const permissions: DemoData["permissions"] = PERMISSION_CATALOG.filter((p) => p.module !== "platform").map((p) => ({
    id: demoId(`permission:${p.key}`),
    key: p.key,
    name: p.name,
    module: p.module,
    description: p.description,
  }));
  const permissionKeys = new Set(permissions.map((p) => p.key));

  const roles: DemoData["roles"] = ROLES.map((r) => ({ id: roleId(r.key), key: r.key, name: r.name, description: r.description }));
  const rolePermissions: DemoData["rolePermissions"] = ROLES.flatMap((r) =>
    ROLE_PERMISSION_DEFAULTS[r.permissionsFrom]
      .filter((key) => permissionKeys.has(key))
      .map((key) => ({ roleId: roleId(r.key), permissionId: demoId(`permission:${key}`) }))
  );

  // --- People (no passwords; status INVITED, no auth-provider link) ----------
  const users: DemoData["users"] = [];
  const memberships: DemoData["memberships"] = [];
  const doctorProfiles: DemoData["doctorProfiles"] = [];
  const doctorBranches: DemoData["doctorBranches"] = [];

  DOCTORS.forEach((d, i) => {
    const userId = demoId(`user:${d.key}`);
    const doctorId = demoId(`doctor:${d.key}`);
    users.push({ id: userId, email: emailFor(d.name, domainOf(d.clinic)), name: d.name, phone: fakePhone(11001 + i), status: "INVITED" });
    memberships.push({ id: demoId(`membership:${d.key}`), userId, clinicId: clinicId(d.clinic), branchId: null, roleId: roleId("DOCTOR"), status: "ACTIVE" });
    doctorProfiles.push({
      id: doctorId,
      userId,
      clinicId: clinicId(d.clinic),
      specialtyId: specialtyId(d.specialty),
      departmentId: departmentId(d.department),
      qualifications: d.qualifications,
      registrationNumber: `DEMO-REG-${String(i + 1).padStart(4, "0")}`,
      experienceYears: d.experienceYears,
      consultationFeePaise: rupees(d.feeInr),
      bio: `${d.qualifications} with ${d.experienceYears} years of clinical experience.`,
      onlineConsultation: d.online,
      status: "ACTIVE",
    });
    d.branches.forEach((b, j) => doctorBranches.push({ doctorId, branchId: branchId(b), clinicId: clinicId(d.clinic), isPrimary: j === 0 }));
  });

  STAFF.forEach((s, i) => {
    const userId = demoId(`user:${s.key}`);
    users.push({ id: userId, email: emailFor(s.name, domainOf(s.clinic)), name: s.name, phone: fakePhone(12001 + i), status: "INVITED" });
    memberships.push({
      id: demoId(`membership:${s.key}`),
      userId,
      clinicId: clinicId(s.clinic),
      branchId: s.branch ? branchId(s.branch) : null,
      roleId: roleId(s.role),
      status: "ACTIVE",
    });
  });

  // --- Patients: 20 at Aarogya (12 Kothrud, 8 Wakad), 10 at Nirmaya ------------
  const patientPlan: { clinic: ClinicCode; branch: string }[] = [
    ...Array.from({ length: 12 }, () => ({ clinic: "AAR" as const, branch: "AAR-KTH" })),
    ...Array.from({ length: 8 }, () => ({ clinic: "AAR" as const, branch: "AAR-WKD" })),
    ...Array.from({ length: 10 }, () => ({ clinic: "NIR" as const, branch: "NIR-IND" })),
  ];
  const patientSeq: Record<ClinicCode, number> = { AAR: 0, NIR: 0 };
  const usedNames = new Set<string>();
  const patients: DemoData["patients"] = patientPlan.map((p, i) => {
    const gender: Gender = i % 2 === 0 ? "FEMALE" : "MALE";
    let name: string;
    do {
      name = `${rng.pick(gender === "FEMALE" ? FIRST_NAMES_F : FIRST_NAMES_M)} ${rng.pick(LAST_NAMES)}`;
    } while (usedNames.has(name));
    usedNames.add(name);
    const age = i < 4 ? rng.int(3, 12) : rng.int(19, 74); // a few children for pediatrics
    const seq = ++patientSeq[p.clinic];
    return {
      id: demoId(`patient:${i + 1}`),
      clinicId: clinicId(p.clinic),
      branchId: branchId(p.branch),
      patientNumber: `${p.clinic}-P-${String(seq).padStart(4, "0")}`,
      name,
      dateOfBirth: istDate(now, -(age * 365 + rng.int(0, 364))),
      gender,
      phone: fakePhone(20001 + i),
      email: emailFor(`${name} ${i + 1}`, "example.com"),
      bloodGroup: rng.pick(BLOOD_GROUPS),
      addressLine: `${rng.int(1, 120)} Demo Street`,
      city: p.clinic === "AAR" ? "Pune" : "Bengaluru",
      allergies: rng.bool(0.2) ? [rng.pick(ALLERGIES)] : [],
      chronicConditions: age > 40 && rng.bool(0.4) ? [rng.pick(CHRONIC)] : [],
      emergencyContactName: `${rng.pick(rng.bool() ? FIRST_NAMES_F : FIRST_NAMES_M)} ${name.split(" ")[1]}`,
      emergencyContactPhone: fakePhone(30001 + i),
      status: "ACTIVE",
    };
  });

  // One fictional patient-portal user (no login; INVITED) linked to the first
  // Aarogya patient, so patient-scoped access rules can be exercised.
  const portalPatient = patients[0];
  const portalUserId = demoId("user:PU-01");
  users.push({ id: portalUserId, email: portalPatient.email!, name: portalPatient.name, phone: portalPatient.phone, status: "INVITED" });
  memberships.push({ id: demoId("membership:PU-01"), userId: portalUserId, clinicId: portalPatient.clinicId, branchId: null, roleId: roleId("PATIENT"), status: "ACTIVE" });
  const patientLinks: DemoData["patientLinks"] = [{ patientId: portalPatient.id!, userId: portalUserId }];

  const medicines: DemoData["medicines"] = MEDICINES.map((m) => ({
    id: medicineId(m.key),
    name: m.name,
    genericName: m.genericName,
    strength: m.strength,
    dosageForm: m.dosageForm,
    isActive: true,
  }));

  // --- Appointments: 25 past, 6 today, 17 upcoming (48 total) ------------------
  type Slot = { dayOffset: number; status: AppointmentStatus };
  const pastStatuses: AppointmentStatus[] = [...Array(18).fill("COMPLETED"), ...Array(4).fill("CANCELLED"), ...Array(3).fill("NO_SHOW")];
  const todayStatuses: AppointmentStatus[] = ["CHECKED_IN", "CONFIRMED", "CONFIRMED", "CONFIRMED", "SCHEDULED", "SCHEDULED"];
  const futureStatuses: AppointmentStatus[] = [...Array(9).fill("SCHEDULED"), ...Array(6).fill("CONFIRMED"), ...Array(2).fill("CANCELLED")];
  const slots: Slot[] = [
    ...shuffled(rng, pastStatuses).map((status, i) => ({ dayOffset: -1 - (i % 21), status })),
    ...todayStatuses.map((status) => ({ dayOffset: 0, status })),
    ...shuffled(rng, futureStatuses).map((status, i) => ({ dayOffset: 1 + (i % 14), status })),
  ];

  const doctorByKey = new Map(DOCTORS.map((d) => [d.key, d]));
  const takenSlots = new Set<string>();
  const appointments: DemoData["appointments"] = [];
  const appointmentMeta = new Map<string, { doctorKey: string; clinic: ClinicCode; dayOffset: number; patientId: string }>();

  slots.forEach((slot, i) => {
    const patientIndex = i % patients.length;
    const patient = patients[patientIndex];
    const clinic = patientPlan[patientIndex].clinic;
    const isChild = patientIndex < 4;
    const candidates = DOCTORS.filter((d) => d.clinic === clinic && (isChild ? d.specialty === "pediatrics" || d.specialty === "general-medicine" : d.specialty !== "pediatrics"));
    const doctor = rng.pick(candidates);
    const branch = rng.pick(doctor.branches);

    let time = rng.pick(SLOT_TIMES);
    while (takenSlots.has(`${doctor.key}|${slot.dayOffset}|${time}`)) time = rng.pick(SLOT_TIMES);
    takenSlots.add(`${doctor.key}|${slot.dayOffset}|${time}`);

    const startsAt = istInstant(now, slot.dayOffset, time);
    const type: AppointmentType = slot.dayOffset > 0 && doctor.online && rng.bool(0.3) ? "ONLINE" : rng.weighted<AppointmentType>([["IN_PERSON", 7], ["FOLLOW_UP", 2], ["WALK_IN", 1]]);
    const id = demoId(`appointment:${i + 1}`);
    appointments.push({
      id,
      clinicId: clinicId(clinic),
      branchId: branchId(branch),
      patientId: patient.id!,
      doctorId: demoId(`doctor:${doctor.key}`),
      startsAt,
      durationMinutes: type === "FOLLOW_UP" ? 15 : 30,
      type,
      status: slot.status,
      reason: rng.pick(CLINICAL[doctor.specialty].reasons),
      checkedInAt: slot.status === "CHECKED_IN" ? new Date(startsAt.getTime() - 10 * 60 * 1000) : null,
      cancelledAt: slot.status === "CANCELLED" ? new Date(startsAt.getTime() - 24 * 60 * 60 * 1000) : null,
    });
    appointmentMeta.set(id, { doctorKey: doctor.key, clinic, dayOffset: slot.dayOffset, patientId: patient.id! });
  });

  // --- Consultations (every completed appointment), prescriptions (16 of 18) ---
  const consultations: DemoData["consultations"] = [];
  const prescriptions: DemoData["prescriptions"] = [];
  const prescriptionItems: DemoData["prescriptionItems"] = [];
  const rxSeq: Record<ClinicCode, number> = { AAR: 0, NIR: 0 };
  const medicinesByConsultation = new Map<string, string[]>();

  appointments
    .filter((a) => a.status === "COMPLETED")
    .forEach((a, i) => {
      const meta = appointmentMeta.get(a.id!)!;
      const doctor = doctorByKey.get(meta.doctorKey)!;
      const clinical = CLINICAL[doctor.specialty];
      const consultationId = demoId(`consultation:${a.id}`);
      const completedAt = new Date((a.startsAt as Date).getTime() + 25 * 60 * 1000);
      consultations.push({
        id: consultationId,
        clinicId: a.clinicId,
        appointmentId: a.id!,
        chiefComplaint: a.reason,
        notes: `Patient seen for ${a.reason.toLowerCase()}. Examination findings recorded. Advised as per plan.`,
        diagnosis: [rng.pick(clinical.diagnoses)],
        followUpDate: rng.bool(0.5) ? istDate(now, meta.dayOffset + rng.int(7, 21)) : null,
        status: "COMPLETED",
        completedAt,
      });

      if (i % 9 === 8) return; // 2 of 18 consultations end without a prescription
      const code = meta.clinic;
      const prescriptionId = demoId(`prescription:${consultationId}`);
      prescriptions.push({
        id: prescriptionId,
        clinicId: a.clinicId,
        consultationId,
        prescriptionNumber: `${code}-RX-${String(++rxSeq[code]).padStart(4, "0")}`,
        status: meta.dayOffset < -10 ? "COMPLETED" : "ACTIVE",
        notes: rng.bool(0.4) ? "Review if symptoms persist beyond the course." : null,
        issuedAt: completedAt,
      });
      const picked = rng.pickMany(clinical.medicines, rng.int(1, Math.min(3, clinical.medicines.length)));
      medicinesByConsultation.set(consultationId, picked);
      picked.forEach((medKey, j) => {
        prescriptionItems.push({
          id: demoId(`prescription-item:${prescriptionId}:${j}`),
          prescriptionId,
          medicineId: medicineId(medKey),
          dosage: MEDICINES.find((m) => m.key === medKey)!.dosageForm === "OINTMENT" ? "Apply thin layer" : "1 unit",
          frequency: rng.pick(FREQUENCIES),
          durationDays: rng.pick([3, 5, 7, 10, 14, 30]),
          instructions: rng.pick(["After food", "Before food", "With plenty of water", null]),
        });
      });
    });

  // --- Invoices & payments ------------------------------------------------------
  const invoices: DemoData["invoices"] = [];
  const invoiceLineItems: DemoData["invoiceLineItems"] = [];
  const payments: DemoData["payments"] = [];
  const invSeq: Record<ClinicCode, number> = { AAR: 0, NIR: 0 };
  const consultationByAppointment = new Map(consultations.map((c) => [c.appointmentId, c.id!]));

  // Completed visits: 12 paid, 3 partially paid, 3 pending. Today's checked-in /
  // confirmed visits: billed at the desk, mostly still pending.
  const completedOutcomes: InvoiceStatus[] = shuffled(rng, [...Array(12).fill("PAID"), ...Array(3).fill("PARTIALLY_PAID"), ...Array(3).fill("PENDING")]);
  const todaysBillable = appointments.filter((a) => appointmentMeta.get(a.id!)!.dayOffset === 0 && (a.status === "CHECKED_IN" || a.status === "CONFIRMED"));
  const billable: { appointment: (typeof appointments)[number]; outcome: InvoiceStatus }[] = [
    ...appointments.filter((a) => a.status === "COMPLETED").map((a, i) => ({ appointment: a, outcome: completedOutcomes[i] })),
    ...todaysBillable.map((a, i) => ({ appointment: a, outcome: (i === 0 ? "PAID" : "PENDING") as InvoiceStatus })),
  ];

  function addInvoice(opts: {
    key: string;
    clinic: ClinicCode;
    branchId: string;
    patientId: string;
    appointmentId: string | null;
    issuedAt: Date;
    lines: { description: string; category: Prisma.InvoiceLineItemCreateManyInput["category"]; quantity: number; unitPricePaise: number }[];
    discountPaise: number;
    outcome: InvoiceStatus;
  }) {
    const id = demoId(`invoice:${opts.key}`);
    const lineRows = opts.lines.map((l, j) => ({
      id: demoId(`invoice-line:${opts.key}:${j}`),
      invoiceId: id,
      description: l.description,
      category: l.category,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      amountPaise: l.quantity * l.unitPricePaise,
    }));
    const subtotalPaise = lineRows.reduce((s, l) => s + l.amountPaise, 0);
    const taxPaise = 0; // healthcare services are GST-exempt in India
    const totalPaise = subtotalPaise - opts.discountPaise + taxPaise;
    invoices.push({
      id,
      clinicId: clinicId(opts.clinic),
      branchId: opts.branchId,
      patientId: opts.patientId,
      appointmentId: opts.appointmentId,
      invoiceNumber: `${opts.clinic}-INV-${String(++invSeq[opts.clinic]).padStart(4, "0")}`,
      issuedAt: opts.issuedAt,
      dueDate: new Date(opts.issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      subtotalPaise,
      discountPaise: opts.discountPaise,
      taxPaise,
      totalPaise,
      status: opts.outcome,
    });
    invoiceLineItems.push(...lineRows);

    const method = rng.pick<PaymentMethod>(["CASH", "UPI", "UPI", "CARD", "ONLINE"]);
    const paidAt = new Date(opts.issuedAt.getTime() + 5 * 60 * 1000);
    if (opts.outcome === "PAID") {
      // Occasionally split across two payments; amounts always sum to the total.
      if (totalPaise >= rupees(1000) && rng.bool(0.3)) {
        const first = Math.round(totalPaise / 2 / 100) * 100;
        payments.push({ id: demoId(`payment:${opts.key}:0`), clinicId: clinicId(opts.clinic), invoiceId: id, amountPaise: first, method: "CASH", status: "SUCCEEDED", paidAt });
        payments.push({ id: demoId(`payment:${opts.key}:1`), clinicId: clinicId(opts.clinic), invoiceId: id, amountPaise: totalPaise - first, method, status: "SUCCEEDED", paidAt: new Date(paidAt.getTime() + 60 * 60 * 1000) });
      } else {
        payments.push({ id: demoId(`payment:${opts.key}:0`), clinicId: clinicId(opts.clinic), invoiceId: id, amountPaise: totalPaise, method, status: "SUCCEEDED", paidAt });
      }
    } else if (opts.outcome === "PARTIALLY_PAID") {
      const partial = Math.round((totalPaise * rng.float(0.3, 0.6, 2)) / 100) * 100;
      payments.push({ id: demoId(`payment:${opts.key}:0`), clinicId: clinicId(opts.clinic), invoiceId: id, amountPaise: partial, method, status: "SUCCEEDED", paidAt });
    } else if (opts.outcome === "PENDING" && rng.bool(0.3)) {
      // A declined online attempt — recorded, but it doesn't count toward the paid amount.
      payments.push({ id: demoId(`payment:${opts.key}:0`), clinicId: clinicId(opts.clinic), invoiceId: id, amountPaise: totalPaise, method: "ONLINE", status: "FAILED", paidAt, reference: "DEMO-DECLINED" });
    }
  }

  billable.forEach(({ appointment: a, outcome }) => {
    const meta = appointmentMeta.get(a.id!)!;
    const doctor = doctorByKey.get(meta.doctorKey)!;
    const lines: Parameters<typeof addInvoice>[0]["lines"] = [
      { description: `Consultation — ${doctor.name}`, category: "CONSULTATION", quantity: 1, unitPricePaise: rupees(doctor.feeInr) },
    ];
    const consultationId = consultationByAppointment.get(a.id!);
    const meds = consultationId ? medicinesByConsultation.get(consultationId) ?? [] : [];
    if (meds.length && rng.bool(0.5)) {
      const med = MEDICINES.find((m) => m.key === meds[0])!;
      lines.push({ description: `${med.name} ${med.strength}`, category: "MEDICINE", quantity: rng.int(1, 3), unitPricePaise: rupees(rng.pick([45, 60, 85, 120])) });
    }
    if (consultationId && rng.bool(0.25)) {
      lines.push({ description: rng.pick(["Complete blood count", "Lipid profile", "HbA1c", "X-ray"]), category: "LAB_TEST", quantity: 1, unitPricePaise: rupees(rng.pick([350, 600, 450, 800])) });
    }
    const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPricePaise, 0);
    addInvoice({
      key: `appointment:${a.id}`,
      clinic: meta.clinic,
      branchId: a.branchId,
      patientId: a.patientId,
      appointmentId: a.id!,
      issuedAt: a.startsAt as Date,
      lines,
      discountPaise: rng.bool(0.2) ? Math.round((subtotal * 0.1) / 100) * 100 : 0,
      outcome,
    });
  });

  // Two walk-in lab invoices with no appointment.
  [
    { patientIndex: 5, outcome: "PAID" as InvoiceStatus, test: "Thyroid profile (T3, T4, TSH)", inr: 550, dayOffset: -3 },
    { patientIndex: 24, outcome: "PENDING" as InvoiceStatus, test: "Vitamin D (25-OH)", inr: 1200, dayOffset: -1 },
  ].forEach((m, i) => {
    const patient = patients[m.patientIndex];
    addInvoice({
      key: `lab-walk-in:${i + 1}`,
      clinic: patientPlan[m.patientIndex].clinic,
      branchId: patient.branchId,
      patientId: patient.id!,
      appointmentId: null,
      issuedAt: istInstant(now, m.dayOffset, "10:15"),
      lines: [{ description: m.test, category: "LAB_TEST", quantity: 1, unitPricePaise: rupees(m.inr) }],
      discountPaise: 0,
      outcome: m.outcome,
    });
  });

  return {
    clinics,
    branches,
    specialties,
    departments,
    roles,
    permissions,
    rolePermissions,
    users,
    memberships,
    doctorProfiles,
    doctorBranches,
    patients,
    medicines,
    appointments,
    consultations,
    prescriptions,
    prescriptionItems,
    invoices,
    invoiceLineItems,
    payments,
    patientLinks,
  };
}
