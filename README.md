# Sehat Setu

**Connecting Care. Simplifying Healthcare.**

Sehat Setu is a full-featured clinic management SaaS prototype connecting clinics,
doctors, staff, and patients in one platform — patient records, appointments,
consultations, prescriptions, lab reports, billing, inventory, a patient
portal, a public consumer-facing site for finding and booking doctors, and an
AI layer across the whole product.

This is a **design/engineering prototype**: every screen is a real, working
Next.js page backed by a realistic, interconnected mock dataset and a mock
service layer — not a set of static mockups. There is no live backend for
clinic data; see [Future backend integration](#future-backend-integration) for
how one would be wired in. The one exception is [new-account
notifications](#new-account-notifications) — adding a doctor or staff member
really does send them an email and SMS, via a small real API route.

---

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (Radix primitives) + **lucide-react**
- **TanStack Query** for data fetching/caching/mutations against the mock service layer
- **Zustand** (with `persist`) for the mock database, auth session, and UI state
- **React Hook Form** + **Zod** for form validation
- **Recharts** for charts
- **date-fns** for date handling
- **Vitest** for unit tests

## Demo accounts

All demo accounts use the password **`Demo@123`**. Pick a role on the login
screen, or sign in directly:

| Email | Role |
|---|---|
| `admin@sehatsetu.demo` | Clinic Admin |
| `doctor@sehatsetu.demo` | Doctor |
| `reception@sehatsetu.demo` | Receptionist |
| `patient@sehatsetu.demo` | Patient (patient portal) |
| `nurse@sehatsetu.demo` | Nurse |
| `pharmacist@sehatsetu.demo` | Pharmacist |
| `lab@sehatsetu.demo` | Lab Staff |
| `superadmin@sehatsetu.demo` | Super Admin |

Each demo role is bound to a **real seeded record** (e.g. the doctor login is
`db.doctors[0]`, the patient login is `db.patients[0]`), so what you see is
that person's actual data — their real appointments, prescriptions, invoices —
not a disconnected placeholder.

## Running locally

```bash
npm install
npm run dev       # start the dev server at http://localhost:3000
npm run build     # production build
npm run start     # run the production build
npm run test      # run the vitest unit test suite
npm run lint      # eslint
```

No environment variables are required to run the app itself. Adding a doctor
or staff member works either way — see [New-account
notifications](#new-account-notifications) below for the one feature that
uses a real (free-tier) email/SMS API and the one env var worth setting.

## Architecture

```
src/
  app/                     Routes (Next.js App Router)
    (public)/              Public marketing site: homepage, doctor
                            directory/profile (/doctors), clinic
                            directory/profile (/clinics), booking flow
                            (/book, /book/[doctorId]). See "Public site"
                            below.
    (app)/                 Staff-facing app shell: dashboard, patients,
                            appointments, consultations, prescriptions,
                            reports, inventory, billing, staff,
                            doctor-roster (internal doctor CRUD — see note
                            below), analytics, AI assistant, settings, etc.
                            Role-aware nav.
    (portal)/portal/        Patient-facing portal: its own shell/nav, home,
                            appointments, consultations (+ simulated online
                            video consultation), prescriptions, reports,
                            documents, payments, AI assistant, profile.
    login/, register/      Demo login (role selector tucked behind a
                            collapsed disclosure) and public patient
                            self-registration
    api/notify-new-account/ The one real API route — sends the new-account
                            email + SMS (see below)
  server/                 Server-only code (guarded by the `server-only`
                            package). send-account-notifications.ts is the
                            only module in the app that holds provider API
                            keys or talks to a third party.
  components/
    ui/                    shadcn/ui primitives
    shared/                Cross-cutting building blocks: DataTable,
                            StatCard, PageHeader, EmptyState/ErrorState,
                            StatusBadge, PersonAvatar, Timeline, TagInput,
                            AIPanel/AIBadge, ConfirmDialog, SearchInput...
    layout/                Staff app shell: sidebar, header, command
                            palette (Cmd/Ctrl+K), notifications, auth gate
    portal/                Patient portal shell (sidebar/header/bottom nav)
    dashboard/, patients/, appointments/, consultations/, prescriptions/,
    reports/, inventory/, billing/, staff/, doctors/, charts/, ai/
                            Feature-specific components and dialogs
  data/
    pools.ts               Reference data (names, medicines, diagnoses...)
    seed/                  Deterministic generators that build the full,
                            cross-referenced mock database (branches,
                            doctors, staff, patients, appointments,
                            consultations, prescriptions, lab reports,
                            medicines, invoices, payments, expenses,
                            notifications, audit log)
  services/                The mock "API" — one module per domain
                            (patients, appointments, clinical, billing,
                            inventory, notifications, audit, analytics,
                            search, ai). UI code calls these, never the
                            store directly, so a real backend can be
                            swapped in without touching components.
  hooks/                   TanStack Query hooks wrapping the services,
                            with a shared query-key factory for cache
                            invalidation
  store/                   Zustand stores: the mock "database" (persisted
                            to localStorage, resettable), auth session, UI
                            state (command palette, active branch), and
                            clinic settings
  lib/                     rng.ts (seeded random generator), format.ts,
                            permissions.ts (role → resource → action
                            matrix), nav-config.ts, auth.ts (demo login
                            resolution), demo-clock.ts (fixed "now" so
                            seeded data always looks current)
  types/                   Single source of truth for every domain type
```

### Why a mock service layer instead of hard-coded arrays

Every list, detail page, and dashboard calls a function in `src/services/*`
(`listPatients`, `createAppointment`, `recordPayment`, ...). These functions
read and write a single Zustand-held "database" (`src/store/data-store.ts`),
seeded once by `src/data/seed`, and simulate network latency. Because
everything goes through this layer:

- The same patient/appointment/invoice/prescription is consistent everywhere
  it appears (patient profile, doctor dashboard, calendar, billing, patient
  portal, notifications) — creating an appointment from a patient's profile
  immediately shows up in Today's Appointments, the doctor's dashboard, and
  the patient's own portal.
- Swapping in a real backend later means rewriting `src/services/*` to call
  real HTTP endpoints — no UI component needs to change.

### AI layer

All AI-flavored features (`src/services/ai.ts`) are implemented as
**deterministic, explainable functions over the real seeded data** — e.g.
`generateClinicInsights()` computes actual week-over-week deltas from
`db.appointments`/`db.payments`, and `answerPatientQuestion()` pattern-matches
intent and answers from the asking patient's own records. Nothing here calls
an external LLM. Every AI surface in the UI is labeled **"AI-generated"**
with a review disclaimer, and nothing AI-produced is ever saved
automatically — a human always has to accept/save it explicitly (prescription
safety review, consultation-notes draft, OCR extraction, etc.).

### Roles & permissions

`src/lib/permissions.ts` defines a resource × action matrix per role and
`src/lib/nav-config.ts` defines per-role navigation. The staff app shell and
patient portal are two separate route groups and layouts, each gated by
`AuthGate` (`src/components/layout/auth-gate.tsx`), which also handles
redirecting a signed-in patient away from the staff shell and vice versa.

## Public site

`src/app/(public)/` is the consumer-facing marketing site — homepage funnel
(hero, trust stats, how-it-works, specialties, online consultation, patient
portal preview, Sehat AI, for-clinics, testimonials, FAQ), a doctor directory
and profile, a clinic directory and profile, and a 5-step booking flow (Doctor
→ Date & Time → Details → Payment → Confirmation) that only asks a visitor to
sign in or create an account right before payment — never earlier.

Booking is not a parallel data model: `src/services/booking.ts#submitBooking`
calls the same `createAppointment` / `createInvoiceForAppointment` /
`recordPayment` services the staff app uses, so a public booking shows up
immediately in the doctor's schedule, the clinic dashboard, and the patient's
own `/portal`. `src/services/payments.ts` is a mock payment-gateway
abstraction (UPI/Card/Net Banking) simulating provider latency — swap it for a
real gateway (Razorpay, Stripe, ...) later without touching the booking UI;
never put real gateway secrets in frontend code.

**Note on `/doctor-roster`:** the public doctor directory needed the URL
`/doctors` (and `/doctors/[id]`), which the internal staff app's doctor
management screen already owned. The internal screen was renamed to
`/doctor-roster` to free up the public path — it's the same feature (add/edit
doctors, from Doctors in the staff sidebar), just a different URL.

The "Clinic" directory reuses the existing `Branch` entity
(`src/services/clinics.ts` wraps `db.branches`) rather than introducing a
duplicate model, and the patient portal at `/portal` doubles as the
post-booking patient experience — there's no separate `/patient/*` route
tree.

`NEXT_PUBLIC_DEMO_MODE` (default `true`) shows a small "Demo" badge on the
public site; set it to `"false"` once this is pointed at a real backend.
`src/app/sitemap.ts` / `robots.ts` list every public/doctor/clinic page and
disallow the staff app, patient portal, booking flow, and API routes.

## New-account notifications

Adding a doctor (Doctors → **+ Add Doctor**) or staff member (Staff → **+ Add
Staff**) does two things beyond creating the record: it makes that person able
to actually sign in immediately (see [Roles &
permissions](#roles--permissions) — any doctor/staff email now authenticates,
not just the 8 canonical demo accounts), and it sends them their sign-in
details by **real email and SMS**, using free-tier third-party APIs called
from a genuine server route — `POST /api/notify-new-account`
(`src/app/api/notify-new-account/route.ts` →
`src/server/send-account-notifications.ts`).

- **Email — [Resend](https://resend.com).** Free tier (3,000/month, no card).
  Requires `RESEND_API_KEY` in `.env.local` — see the comments in
  `.env.example` for the 1-minute signup. Until it's set, email delivery is
  reported as "not sent" in the UI, nothing crashes.
- **SMS — [TextBelt](https://textbelt.com).** Works with **zero signup**: the
  code defaults to the literal key `"textbelt"`, which sends 1 free SMS/day
  per IP address. Fine for trying the feature; for real clinic volume, buy a
  paid TextBelt key (pay-as-you-go, no subscription) or swap in a different
  provider and set `TEXTBELT_API_KEY`.

Either channel can fail independently (e.g. the free SMS quota is used up for
the day) without blocking the other, and the in-app **credentials dialog**
that appears right after saving always shows the email + password directly
too — so an admin is never stuck without the new person's login details just
because a send failed.

This is intentionally the **one** piece of real backend code in an otherwise
fully mock app — see [Future backend integration](#future-backend-integration)
for how the rest of the app would follow this same pattern: a server route or
action, secrets read from non-`NEXT_PUBLIC_` env vars, and never called
directly from the browser.

## Resetting demo data

Open the user menu (top-right avatar) → **Reset demo data**. This regenerates
the entire mock database with a fresh random seed — useful after making a lot
of changes during a demo. The default seed is deterministic, so a normal page
reload always shows the same data unless you've explicitly reset it or made
changes in the session (both persist to `localStorage`).

## Future backend integration

1. Re-implement each function in `src/services/*.ts` to call real HTTP
   endpoints (or server actions) instead of `getDb()`/`mutateDb()`. Keep the
   same function signatures and return shapes — the TanStack Query hooks in
   `src/hooks/*` and every component that calls them stay unchanged.
2. Replace `src/lib/auth.ts` + `src/store/auth-store.ts` with real
   authentication (e.g. NextAuth, a session cookie backed by your API). Keep
   the `AuthUser` shape in `src/types/index.ts` so `AuthGate` and role-based
   nav keep working.
3. Replace `src/services/ai.ts`'s mock functions with calls to a real LLM
   provider **from a server route/action**, using `AI_PROVIDER_API_KEY` from
   `.env.local` (see `.env.example`). Never call a provider directly from the
   client or expose the key via a `NEXT_PUBLIC_` variable.
4. Retire `src/data/seed` and `src/store/data-store.ts` once real data is
   flowing; `src/types/index.ts` remains the contract for both mock and real
   data.

## Deployment notes

This is a static-friendly Next.js app (no server-only secrets are required
for the mock version) and deploys as-is to Vercel or any Node hosting that
supports Next.js 16. Once a real backend/AI provider is wired in (see above),
set `NEXT_PUBLIC_API_BASE_URL` and `AI_PROVIDER_API_KEY` in your hosting
provider's environment configuration — never commit them.

## What's a prototype limitation today

- Data lives in `localStorage` via Zustand `persist` — it's per-browser, not
  shared across devices/users, and is wiped if the user clears site data.
- "Download PDF" / "Print" (prescriptions, invoices, reports) use the
  browser's native print dialog (print-optimized layout, chrome hidden via
  `print:` styles) rather than server-side PDF generation.
- The online video consultation is a simulated UI (avatar tiles, mock
  connect delay, local-only chat) — see [AI layer](#ai-layer) note above for
  the equivalent approach to a real video SDK integration.
#   S e h a t - s e t u  
 