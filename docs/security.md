# Sehat Setu — authentication, authorization & tenant isolation

Written for: developers and operators working on Sehat Setu.

## The model in one picture

```
Browser ──(Supabase session cookie)──▶ proxy.ts ──▶ server layout / route handler / server action
                                        │ refresh token,        │ 1. supabase.auth.getUser()  → verified auth user
                                        │ redirect if signed out│ 2. users + memberships + doctor/patient links (DB) → identity
                                        │                       │ 3. resolveTenantContext / resolvePatientContext
                                        │                       │ 4. requirePermission / appointmentScopeFilter / assertRecordAccess
                                        ▼                       ▼
                                          withTenantDb(ctx) / withPatientDb(ctx)  ── as sehat_app (NOBYPASSRLS), verified TLS
                                            SET LOCAL app.user_id / app.clinic_id / app.branch_id
                                            └─▶ PostgreSQL RLS re-derives membership, branch, permissions,
                                                doctor and patient scope from those ids — then filters rows
```

* **Identity** comes only from Supabase Auth, verified server-side with
  `getUser()`. Nothing in localStorage, request bodies, query strings, or
  cookies other than the Supabase session is trusted for identity, role,
  clinic, patient, or permissions.
* **Authorization** is decided from the database (`clinic_memberships` →
  `roles` → `role_permissions`) using the keys in `src/data/permission-catalog.ts`.
* **Enforced twice.** The app filters every query explicitly (clinic, branch,
  doctor/patient scope) and re-checks loaded records. Separately, PostgreSQL
  RLS **re-verifies** the context: it does not trust `app.clinic_id` on its
  own. The user in `app.user_id` must hold an active membership there, and
  permissions are looked up from role tables. A bug that sets the wrong clinic
  therefore returns nothing (tested: a clinic-B admin with a forged clinic-A
  context sees zero rows).

## Access rules

"Staff permission X" means a non-PATIENT role in the current clinic grants X.
A branch-restricted membership only counts when the request is scoped to that
branch.

| Records | Who can read | Who can write |
|---|---|---|
| Patients | staff with `patient.view` / `patient.basic_info.view`; doctors with only `assigned_patients.view` → patients they have an appointment with; a patient → only records linked to them | insert `patient.create`; update `patient.update` / `patient.update_basic_info` |
| Appointments | staff with `appointment.view` / `checkin.manage` (branch-filtered); doctors with only `own_appointments.view` → their own; a patient → their own | insert `appointment.create`; update `appointment.update`/`cancel`/`checkin.manage`, or a doctor's own with `own_appointments.manage` (cannot reassign to another doctor) |
| Consultations | appointment visible **and** clinical permission (`medical_record.view`, `patient.medical_record.view`, `medical_record.manage`); a patient → their own. Front-desk roles **cannot** read clinical notes | `medical_notes.create` / `.update`, `medical_record.manage`, `patient.medical_record.update` |
| Prescriptions + items | consultation visible **and** `prescription.view`/`.manage`/`.create`; a patient → their own | `prescription.create` / `.update` / `.manage` |
| Invoices, line items, payments | `billing.view` / `invoice.view` / `billing.manage` (branch-filtered); a patient → their own | invoices `invoice.create`/`.update`/`billing.manage`; payments `payment.create`/`billing.manage` |
| Users, memberships | own row; staff see their clinic's members; patients see only their clinic's doctors | memberships: `role.manage` / `user.create` / `staff.manage` |
| Clinic, branches, departments, doctors | any active member of the clinic | `clinic.update`, `branch.create`/`.update`, `clinic.settings.manage`, `doctor.manage` |
| Audit events | staff with `clinic.settings.manage` / `role.manage`, own clinic only | nobody directly (see Audit trail) |

* **Nobody can DELETE** through the app: the runtime role has no DELETE privilege.
* **Patients** are linked to their record only by an administrator
  (`npm run auth:provision -- … --role PATIENT --patient AAR-P-0007`). The link
  fills an empty `patients.userId` and refuses one owned by someone else. The
  patient id is never taken from the browser. A PATIENT role's own permissions
  (e.g. `billing.view`) never count as staff permissions.
* **Doctors** see clinical records only through their own appointments. Seeing
  another doctor's consultation for a shared patient isn't supported yet;
  that would need an explicit care-team model.
* **Column-level limits** (e.g. `patient.basic_info.view` meaning "contact
  details only") are not enforced by RLS. Query modules must select only the
  allowed columns.

## Database roles and connections

| Role | Used by | Bypasses RLS | Privileges |
|---|---|---|---|
| `postgres` | `DIRECT_URL`: migrations, seed, `db:*` / `auth:provision` scripts | **yes** | Never used by the running app. |
| `sehat_app` | `DATABASE_URL`: the Next.js server | no | SELECT/INSERT/UPDATE on tenant tables, SELECT on reference tables and `audit_events`, EXECUTE on `app.*` helpers. **No DELETE, no DDL, no direct audit writes.** |
| `anon`, `authenticated` | Supabase Data API | no | All privileges revoked; this app never uses the Data API. |

### TLS (verified)

Every connection verifies the server certificate **and** hostname against the
pinned **Supabase Root 2021 CA** (`certs/supabase-root-2021-ca.crt`, SHA-256
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`).
Connections negotiate TLS 1.3.

* **App and scripts** (`pg` driver): `src/server/db/tls.ts` sets
  `ssl: { ca, rejectUnauthorized: true }` with the CA embedded in
  `src/server/db/supabase-root-ca.ts` (no filesystem access). It refuses database URLs that carry
  their own `ssl*` parameters, and throws if the CA can't be loaded. There is
  no insecure fallback.
* **Prisma CLI** (migrations): `prisma.config.ts` adds `sslmode=require`,
  `sslcert=<CA>` and `sslaccept=strict`.
* **Tested:** both pooler ports verify. A wrong CA is rejected
  (`SELF_SIGNED_CERT_IN_CHAIN`, CLI `P1011`), and so is a wrong hostname
  (`ERR_TLS_CERT_ALTNAME_INVALID`). `db:verify-rls` asserts the runtime socket
  is `authorized`.
* **Trust anchor:** the CA was taken from the chain the server presented. Confirm
  its fingerprint against the copy from Dashboard → Project Settings → Database
  → SSL Configuration → Download certificate.
* **Overriding the CA** (e.g. after Supabase rotates it): set `DATABASE_CA_CERT`
  (PEM text). The CLI reads `certs/supabase-root-2021-ca.crt`; a test keeps
  both copies identical.

Before this change the `pg` connections used **no TLS at all** (the driver's
default). An earlier version of this document wrongly said they were encrypted.

### Tenant context and connection pooling

`withTenantDb` / `withPatientDb` open a transaction and call
`set_config(…, true)`. The `true` makes the setting transaction-local:
PostgreSQL clears it at COMMIT/ROLLBACK, so a pooled connection (Supavisor
transaction mode) can't carry one request's identity into the next. With no
context, every policy is false (**default deny**). Both are verified live.

## Audit trail (`audit_events`)

| Event | Written by |
|---|---|
| `auth.sign_in` (SUCCESS / FAILURE + reason), `auth.sign_out` | `src/app/login/actions.ts`, `/auth/signout` |
| `auth.account_linked` | first sign-in of an invited user |
| `access.denied` (route + reason code) | server guards and `requireStaff` |
| `user.provisioned` | `npm run auth:provision` |
| `staff.invitation_created` / `_resent` / `_revoked` / `_accepted` / `_delivery_failed` (role, branch id, masked email such as `d***@example.com`, error code; never tokens, links or full emails) | the invitation database functions (migration `20261019000100`) |
| `billing.invoice_created`, `billing.payment_recorded`, `billing.payment_refunded`, `billing.invoice_voided` (invoice number, amount in paise, method; no patient details) | `server/data/billing.ts`, in the same transaction as the change |
| `<table>.insert/update/delete` for patients, appointments, consultations, prescriptions (+ items), invoices, payments, users, clinic memberships, role permissions, roles | database triggers — catch every change, whatever made it |

* **Stored fields:** actor (user id, auth id, or a label such as `cli:db:seed`
  or the attempted email of a failed sign-in), clinic, action, timestamp,
  target id, outcome, reason, client IP.
* **Never stored:** passwords, tokens, credentials, or values. Data-change rows
  record which columns changed (e.g. `{"changed":["city"]}`).
* **Append-only:** `sehat_app` has no INSERT/UPDATE/DELETE on the table. Rows
  arrive only through `app.log_event()` and the triggers, both of which take
  the actor from the transaction context. Triggers block UPDATE/DELETE/TRUNCATE
  for every role, including `postgres`. A `postgres` superuser-equivalent
  could still drop a trigger, so exporting audit rows to external storage is
  the next hardening step.
* **Failure behaviour:** if writing an audit event fails, the error is logged
  on the server and the request continues (fail-open for logging, never for
  access).
* `npm run db:audit [n]` shows the latest events.

## Setup checklist (manual steps)

1. **Rotate the database password.** The current one was shared in a chat.
   Reset it in Dashboard → Project Settings → Database, then update
   `DIRECT_URL` in `.env.local` (URL-encoded). `DATABASE_URL` uses
   `sehat_app`'s own password and is unaffected.
2. ~~Publishable key~~ — done.
3. **Auth settings:**
   * Turn **off** "Allow new users to sign up". It's currently **on**
     (`disable_signup: false`).
   * Keep "Confirm email" on.
   * Set *Site URL* and *Redirect URLs* (`http://localhost:3000/**`, your
     production URL).
4. **Email templates.** In Authentication → Emails, point Invite and Reset
   password at the app:
   * `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
   * `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`

   Configure custom SMTP before inviting real staff.
5. **Confirm the CA fingerprint** against the dashboard download (TLS above).
6. **Provision the first administrator** (operator only):
   `npm run auth:provision -- --email … --name "…" --clinic AAR --role ADMINISTRATOR`,
   then Dashboard → Authentication → Users → Invite user with the same email.
   Everyone else (doctors, clinic managers, receptionists, nurses) is invited
   from the app once the P5 migrations are applied — see "Staff invitations".
   The CLI stays available for exceptional cases.
7. **Production hosting.** The app server gets `DATABASE_URL` (sehat_app),
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and the CA
   (file or `DATABASE_CA_CERT`). `DIRECT_URL` belongs only where migrations run.

## Commands

| Command | Writes? | Purpose |
|---|---|---|
| `npm run db:status` | no | Connection, role, tables, migrations, row counts. |
| `npm run db:migrate` | schema | `prisma migrate deploy`: pending migrations only, never resets. |
| `npm run db:setup-app-role` | role password, `.env.local` | Login for `sehat_app` (`--rotate` for a new password). |
| `npm run db:seed` | inserts only | Fictional demo data, safe to re-run; fills empty demo portal link only. |
| `npm run db:verify-rls` | no (rolled back) | 62 live checks: TLS, roles, forged contexts, clinic/branch/doctor/patient scoping, audit immutability, billing writes and numbering, assigned-doctor clinical authoring, inventory ledger, medicine catalogue, Data API. |
| `npm run db:audit [n]` | no | Latest audit events. |
| `npm run auth:provision -- …` | inserts only | INVITED user + membership (+ `--patient` link); audited. |
| `npm run db:p5-preflight` | no (READ ONLY transaction) | Before applying the P5 migrations: migration state, case-insensitive duplicate emails, name collisions, role/helper checks, and row counts + checksums of every table (compare after applying). |
| `npm run db:p5-dry-run` | no (always rolled back) | Runs both P5 migration files in one transaction, checks tables/RLS/grants/functions/indexes and that no existing row changed, then rolls back. Run only with approval; not proof of a later real apply. |
| `npm run db:purge-notifications [-- --apply]` | only with `--apply` | Notification retention (90 days). Dry run by default (counts only); `--apply` deletes older notifications and their read receipts. Operator-run; nothing is scheduled. |
| `npm test` / `npm run test:integration` | no (writes rolled back) | Unit tests / live-database tests of the dashboard, front-desk, billing, clinical, inventory and catalogue modules as real fixture users; asserts the database is unchanged afterwards. |

## Pages and data sources

In Supabase mode the staff app reads the clinic database through `/api/v1`
(`src/app/api/v1/**` → `src/server/data/*`). Every route goes through
`apiRoute()`: verified session, permission check, `withTenantDb`, JSON errors.
Hooks pick the source from `LiveDataContext` (set by the staff shell), so the
public site and patient portal keep their mock data until their own phases.
**A failed request shows an error. It never falls back to mock data.**

| Page / feature | Data source (Supabase mode) |
|---|---|
| `/dashboard` | **Database** (`server/data/dashboard.ts`) |
| `/patients` list, search, create; patient header and appointments tab | **Database** (`server/data/patients.ts`, `appointments.ts`) |
| `/appointments` (book, check-in, cancel, no-show, reschedule), `/waiting-room`, sidebar waiting count | **Database** (`server/data/appointments.ts`) |
| `/doctor-roster` list and detail, `/staff` directory and activate/deactivate, branch selector, command-palette search | **Database** (`server/data/people.ts`, `search.ts`) |
| `/billing` (invoices, payments, summary), invoice detail (collect payment, void, mark refunded), patient billing tab, appointment "Collect payment" | **Database** (`server/data/billing.ts`) |
| `/consultations` (list, workspace: start, save draft, complete), `/prescriptions` (list, detail, create from a consultation), patient tabs: timeline, consultations, prescriptions, medicines; waiting-room and appointment "Start/Continue consultation" | **Database** (`server/data/clinical.ts`) |
| `/inventory` (stock by branch, receive stock, batch detail, adjustments, reversals, reorder levels, movement history), sidebar low-stock badge | **Database** (`server/data/inventory.ts`) |
| `/analytics` (clinic reports: appointments, new patients, doctor workload, collections, refunds, outstanding ageing, CSV export) | **Database** (`server/data/reports.ts`, rules in `lib/reports.ts`) |
| Patient tabs: lab reports, documents; AI summary and AI notes/safety assistants | "Not connected yet" / hidden (later phases) |
| `/notifications`, notification bell, sidebar notification badge | **Database** (`server/data/notifications.ts`) once migration `20261019000000` is applied; until then an honest "not available yet" state. Never demo data. Patient portal bell: "not available" (staff notifications only). |
| `/staff` Invitations tab, "Invite staff", Doctors page "Invite doctor", `/invitations` (invitee) | **Database** (`server/data/invitations.ts`) once migration `20261019000100` is applied; "not set up yet" until then |
| Every other staff page (lab reports, documents, expenses, AI assistant, clinic admin, audit log, settings…) | Mock data, with a visible **"Demo data"** notice |
| Patient portal | Mock data (P6/P7), with a visible **"Demo data"** notice on every page for signed-in patients |
| Public site (doctor directory, booking) | Mock data with the "Demo" badge (`NEXT_PUBLIC_DEMO_MODE`), P6/P7 |

* **Adding doctors and staff** in the live app is by invitation only (below).
  The demo "Add staff / Add doctor" dialogs, which showed a shared demo
  password, never render with live data; `/clinic/users` redirects to `/staff`;
  and the legacy `/api/notify-new-account` answers 410 Gone in Supabase mode
  before reading its body (removed entirely in P7).
* **Booking clashes:** a booking is checked against every active appointment
  of that doctor, across branches, via
  `app.doctor_busy_slots()` (migration `20261014000000`, SECURITY DEFINER).
  It returns busy start times only, for doctors of the caller's clinic, to
  verified staff. A per-slot advisory lock stops two simultaneous bookings.
* **Billing** (`server/data/billing.ts`, rules in `billing-math.ts`):
  * Amounts are integer paise. line = qty × unit price; subtotal = Σ lines;
    tax = round((subtotal − discount) × rate%), rate 0–28%; total = subtotal −
    discount + tax; discount ≤ subtotal; total ≤ ₹10,00,000.
  * Paid = SUCCEEDED payments only. Status is derived on the server
    (PENDING / PARTIALLY_PAID / PAID; VOID is final). The client never sends
    totals, statuses or payment times. Revenue = SUCCEEDED payments by IST day
    or month; outstanding = total − paid over open invoices; both are scoped to
    the user's branch.
  * Every mutation of an invoice takes a per-invoice advisory lock, so
    concurrent payments can't over-collect. A payment can't exceed the balance.
    Void needs no received payments (mark them refunded first). Nothing is
    ever deleted.
  * Invoice numbers come from `app.next_document_number()` (migration
    `20261015000000`, SECURITY DEFINER). It returns only the next clinic-wide
    number, so branch-restricted users can't collide with numbers they can't see.
  * **Manual recording only.** There's no payment-gateway integration;
    "online" means a payment taken elsewhere. A gateway is a separate future
    feature (`services/payments.ts` is the mock interface for the public
    booking flow).
  * Permissions (also enforced by RLS): view = `billing.view`/`invoice.view`/
    `billing.manage`; create = `invoice.create`/`billing.manage`; record payment
    = `payment.create`/`billing.manage`; void = `invoice.update`/`billing.manage`;
    refund = `refund.manage`/`billing.manage`. With the seeded roles,
    administrators can do everything. Receptionists view and take payments at
    their branch. Clinic managers view their branch. Doctors and nurses have no
    billing access.
  * Expenses have no database table yet, so `/expenses` stays on demo data.
* **Clinical records** (`server/data/clinical.ts`, migration `20261016000000`):
  * Read: administrators clinic-wide; doctors only consultations and
    prescriptions on their own appointments; branch restriction applies.
    Receptionists, nurses and clinic managers can't read either, and their
    patient tabs say "not available to you" rather than showing an empty list.
  * Write (start, save, complete, prescribe): **only the doctor the
    appointment is assigned to**, enforced in the app and in RLS.
    Administrators can read but not author.
  * Lifecycle: start needs a checked-in appointment (→ IN_CONSULTATION).
    Complete closes the consultation and the appointment (→ COMPLETED).
    Completed notes are read-only.
  * Vitals are checked against plausibility bounds (e.g. SpO2 50–100). BMI is
    computed on the server. Text fields and tag lists have length limits.
  * Prescriptions: medicines must come from the catalogue (`medicines` table,
    read-only to the app). Duration is a whole number of days (1–365). Numbers
    come from `app.next_document_number('prescription')`. There's no position
    column, so items are listed by medicine name, not entry order.
  * The audit trail records which clinical columns changed, never their
    contents.
  * Not live yet: lab reports, documents, the AI assistants, standalone walk-in
    "Start consultation" from the patient header, and adding catalogue
    medicines.
* **Inventory** (`server/data/inventory.ts`, rules in `inventory-rules.ts`, migration `20261017000000_inventory`):
  * `inventory_items` holds one row per branch, catalogue medicine and batch.
    Batch number and expiry are required. A batch number is unique per branch
    and medicine, ignoring case and surrounding spaces.
  * `inventory_reorder_levels` holds one reorder level per medicine per branch.
  * `stock_movements` is the append-only ledger (RECEIPT, ADJUSTMENT,
    REVERSAL). Update, delete and truncate are blocked for every role.
  * **Quantity changes only through a movement.** The runtime role has no
    write access to `quantityOnHand`. The trigger `app.apply_stock_movement()`
    locks the batch row, re-checks permission and branch, applies the change
    (stock can't go below 0) and sets the actor, time and resulting quantity
    in the same statement.
  * Rules:
    * Receipts must be positive and can't go into expired batches.
    * Adjustments need a reason of at least 3 characters.
    * Positive adjustments are allowed only on unexpired batches; expired
      stock can only be written off.
    * A reversal applies the exact opposite, once per movement, and can't
      itself be reversed.
    * A batch is usable through its expiry date and expired from the next IST
      day.
  * Status per medicine per branch: expired stock on hand → out of stock →
    expiring within 30 days → low (usable ≤ reorder level) → in stock.
  * Permissions:
    * View: `pharmacy.inventory.view`, `pharmacy.inventory.manage`,
      `pharmacy.manage`.
    * Change: `pharmacy.inventory.manage`, `pharmacy.manage`.
    * Administrators manage. Clinic Managers have view-only access
      (`pharmacy.inventory.view`, added by the migration) for their own
      branch. Doctors, receptionists and nurses have none.
  * Dispensing against prescriptions is **not** implemented; stock is never
    deducted automatically.
* **Shared medicine catalogue** (`server/data/medicines.ts`, migrations
  `20261018000000_dosage_forms` and `20261018000100_medicine_catalog_create`):
  * One list for every clinic. Search is server-side on name or generic name,
    paged at up to 25 per page (`GET /api/v1/medicines`), so there's no size
    cap. Used by Receive Stock and the prescription builder.
  * **Adding** (`POST /api/v1/medicines`) requires `medicine.catalog.create`,
    held by **Administrator only**. The runtime role still has SELECT-only on
    `medicines`. The only write path is `app.create_catalog_medicine()`
    (SECURITY DEFINER, fixed `search_path`), which:
    * re-checks the caller (active staff member of the current clinic with the
      permission);
    * validates lengths, control characters and dosage form;
    * stores tidied values;
    * inserts.
  * **Duplicates** are blocked by the unique index `medicines_normalized_key`
    on (name, strength, form), so concurrent requests can't both succeed.
    Names ignore case and extra spaces; strengths also ignore all spacing
    ("500 mg" = "500mg"). The API returns 409 `DUPLICATE` with the existing
    entry.
  * **Same generic name, strength and form under another name** returns 409
    `NEEDS_CONFIRMATION` with the matches. The administrator can confirm and
    proceed. A generic-name match alone isn't a duplicate.
  * **Audit:** the `medicines.insert` row event (actor and originating clinic
    from the verified context), plus `catalog.medicine_created` with the
    name, generic name, strength and form. Catalogue rows carry no clinic, and
    only the creating clinic's administrators can read these events.
  * Dosage forms (13): tablet, capsule, syrup, injection, ointment, drops,
    inhaler, cream, gel, lotion, suspension, powder, sachet.
  * Editing, deactivating and deleting entries are **operator-only**; there
    are no app controls. Existing prescriptions and stock keep their links.
  * Not handled: unit equivalence (mcg/µg, 0.5 g/500 mg), punctuation
    variants and Unicode look-alikes. Search uses a contains match without a
    trigram index.
* **Values the database doesn't hold** are left empty and never invented:
  doctor ratings and gender, staff "last active", and per-doctor schedules
  (live mode uses standard clinic hours, Mon–Sat 09:00–17:00).
* **The signed-in user is still attached to a mock staff record** for
  demo-data pages (`AuthGate`). Removing that waits until those pages are
  migrated.

## Known limits

* One branch scope per clinic (`MULTIPLE_BRANCH_SCOPES` otherwise).
* Audit rows record changes, not reads; read-access logging for clinical
  records is a candidate next step.
* Column-level restrictions are the query modules' job (see Access rules).
* Demo mode (no publishable key) keeps the client-side personas over fictional
  mock data. It can't reach the database.

## Staff invitations (P5)

Migration `20261019000100_staff_invitations`; server code in
`src/server/data/invitations.ts`, `invitation-rules.ts` and `src/server/supabase-admin.ts`.

* **Who:** only Administrators (`user.create`; doctor invitations also
  `doctor.manage`) create, resend and revoke, within their clinic and branch
  scope. Clinic Managers see their own branch's invitations read-only
  (`staff.view`). Nobody else sees them.
* **What:** Doctor, Clinic Manager, Receptionist or Nurse — never
  Administrator or Patient (checked by the API and by the database function).
  A branch is required for every role; a doctor gets exactly that one branch
  (operators add more later). Doctor invitations carry specialty,
  qualifications, registration number (unique per clinic), experience, fee
  (stored in paise) and online consultation; no department or bio.
* **Limits (enforced in the database):** 7-day expiry; resend at most every
  2 minutes, 10 sends per invitation, each resend renews the 7 days; 50 new
  invitations per clinic per hour; one pending invitation per clinic and email.
  Emails are matched case-insensitively (`users_email_lower_key`).
* **Refusals that stay inside the clinic:** already a member
  (`ALREADY_MEMBER`), a patient of this clinic (`ALREADY_PATIENT` — patients are
  never converted into staff), duplicate pending invitation (`ALREADY_INVITED`).
* **No account enumeration:** a new address gets a Supabase invite; an address
  that already has an account gets a generic sign-in link instead. The API
  response and the clinic's audit trail look the same either way.
* **Acceptance is explicit.** Nothing is created until the invitee signs in
  with a **confirmed** email that matches the invitation and presses Accept
  (`/invitations`, linked from `/access-denied`). `app.accept_staff_invitation`
  locks the invitation, re-checks owner, verified email, status, expiry, role,
  clinic and branch, and creates the membership — and for doctors the doctor
  profile and branch link — in one transaction. Repeating it is harmless. A
  person can hold only one doctor profile across all clinics
  (`DOCTOR_PROFILE_EXISTS` is shown only to the invitee; support path: the
  clinic administrator or Sehat Setu support).
* **Email:** sent after the invitation is saved, never inside a transaction;
  the outcome is stored as a code (`sent`, or `failed` with `not_configured`,
  `rate_limited`, `unavailable`, `not_authorized`, `provider_error`). "Sent"
  means accepted by the email service, never "joined". An outcome that was
  never recorded shows as "Delivery unknown" after 2 minutes; resending is safe.

### Configuration checklist (operator)

1. `SUPABASE_SECRET_KEY` (Dashboard → Project Settings → API Keys → Secret
   keys) in the **server** environment only (`.env.local` locally). Never a
   `NEXT_PUBLIC_` variable, never committed, never pasted into chat.
2. Custom SMTP active (Authentication → SMTP) with a sending rate that covers
   invitations.
3. Email templates, kept generic (no clinic, role or personal data):
   * Invite user: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
   * Magic link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink`
4. Site URL and Redirect URLs include the app's URL(s).
5. Turn **off** "Allow new users to sign up" before real use, then verify with
   one approved test address that (a) a new invitee can set a password and
   accept, and (b) an existing account receives the sign-in link and can accept.

## Notifications (P5)

Migration `20261019000000_notifications`; server code in
`src/server/data/notifications.ts` and `notification-templates.ts`.

* Rows hold no free text — a type, a reference id and allow-listed values
  (times, branch id, catalogue medicine name, counts, role). Titles and bodies
  come from fixed server templates, so patient names and clinical details can't
  be stored or shown.
* Created only by database triggers in the same transaction as the action:
  appointment booked / rescheduled / cancelled / reassigned / checked in (to the
  assigned doctor, never for their own action), usable stock crossing its
  reorder level or reaching zero (to inventory viewers of that branch), and an
  accepted invitation (to the inviter). The runtime role can't create them.
* Visible per RLS: personal ones to their recipient; branch ones to holders of
  an inventory permission within their branch scope; never to patients or other
  clinics. Users may only record their own read receipts.
* The UI refreshes every 60 seconds while the tab is visible and when you
  return to it. "Mark all read" marks everything up to the newest notification
  shown; anything that arrived since stays unread.
* Retention: queries hide notifications older than 90 days;
  `npm run db:purge-notifications -- --apply` deletes them (operator-run).

## Clinic reports (P6.1)

`/analytics` in Supabase mode; demo mode keeps the mock analytics page.
Routes: `GET /api/v1/reports/operational`, `GET /api/v1/reports/financial`
(`from`, `to` as IST dates, optional `branchId`), and
`GET /api/v1/reports/export?report=…` (CSV). No migration: the reports read the
existing tables.

* **Who:** `reports.view` (today Administrator and Clinic Manager). The
  financial report also needs a billing permission (`billing.view`,
  `invoice.view` or `billing.manage`); the same permissions gate the invoice and
  payment rows in RLS. CSV export needs `reports.export` (today Administrator
  only). No role mappings were changed.
* **Scope:** every query runs in the caller's tenant transaction (RLS) *and*
  filters by clinic, branch and, for doctors limited to their own appointments,
  doctor. A branch-limited user can't ask for another branch
  (`BRANCH_FORBIDDEN`); another clinic's branch id is refused as unknown.
* **Aggregates only:** counts and amounts by day, month, branch, doctor and
  payment method. No patient names, numbers or clinical details. A section the
  role can't read is reported as unavailable, never as zeros. Consultation
  length is shown only from consultations with consistent start and finish
  times; the seed data has none.
* **Exports** record `report.exported` in the audit trail with the report
  name, range, branch filter and row count only. Text cells that a spreadsheet
  would run as a formula are prefixed with `'`.
* **Calculation rules** (header of `src/lib/reports.ts`, also on the page):
  collected = SUCCEEDED payments by payment date; refunds are counted on the
  original payment's date because no refund date is stored; billed invoice
  value is reported separately and never as revenue; outstanding (as of today)
  = open invoices' total minus SUCCEEDED payments, aged by due date (or issue
  date). Profit is not reported: there is no expenses table.
