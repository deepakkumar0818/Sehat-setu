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
* **Patients** are linked to their record only by a clinic decision: a
  one-time linking code issued by an Administrator or Receptionist after the
  clinic's identity check and redeemed by the patient (P6.4, below), or the
  operator CLI (`npm run auth:provision -- … --role PATIENT --patient AAR-P-0007`).
  Either way the link fills an empty `patients.userId` and refuses one owned by
  someone else. The patient id is never taken from the browser. A PATIENT role's own permissions
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
| `auth.password_reset_requested`, `auth.sign_up_requested` (attempted email + reason code; never passwords or links) | `src/app/login/actions.ts`, `src/app/register/actions.ts` |
| `patient.link_code_issued` / `_revoked` (patient id, code id, expiry, `identityVerified`), `patient.portal_linked` (code id, whether an account/membership was created), `patient.link_code_redeem_failed` (reason code; unknown codes carry no clinic) — **never the code or its hash** | the P6.4 database functions (migration `20261022000000`) |
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
   * "Allow new users to sign up" stays **on — deliberately** (approved P6.4
     decision: patient self-registration). A self-registered login has **no**
     access to anything until a clinic-issued linking code is redeemed (see
     "Patient self-registration and linking codes (P6.4)"). Staff still join
     only by invitation.
   * Keep "Confirm email" **on** (`mailer_autoconfirm: false`): redemption
     requires a confirmed email.
   * Phone sign-in stays **off** (no SMS provider charges; deferred decision).
   * Recommended before public launch: enable CAPTCHA protection (Auth →
     Attack Protection) and review the Auth rate limits for sign-ups and emails.
   * **URL Configuration** (Authentication → URL Configuration). Email links
     must come back to the app that sent them:
     * *Redirect URLs* — **required**: add `http://localhost:3000/**` (and
       later `https://<production domain>/**`). Supabase ignores any redirect
       the app sends that isn't on this list and falls back to the Site URL.
     * *Site URL* — for the **development** project set it to
       `http://localhost:3000`. It was a deleted Vercel deployment, so every
       link built from `{{ .SiteURL }}` opened `404 DEPLOYMENT_NOT_FOUND`. A
       production project gets its own production domain here.
   * How the app sends redirects (`src/lib/auth/site-url.ts`): sign-up and
     "Forgot password?" pass `<site>/auth/callback?next=…`, where `<site>` is
     `NEXT_PUBLIC_APP_URL` if it is a localhost origin, else
     `http://localhost:3000`, in development (a Vercel/remote URL is never used
     locally; `VERCEL_URL` is ignored); in production only an explicit https
     `NEXT_PUBLIC_APP_URL`, otherwise no redirect is sent (Site URL, unchanged).
4. **Email templates.** In Authentication → Emails:
   * Confirm signup — **code only: `{{ .Token }}`, no link.** The register
     page asks for this emailed code (verifyOtp, type `email`). Do NOT put
     `{{ .ConfirmationURL }}` or a `token_hash` link in this template: mail
     scanners open links in incoming mail, and opening one confirms the address
     without its owner (seen 2026-10-15: confirmed 26 s after sending, no
     session ever created). Existing patient records still link only with the
     clinic's single-use code, so a confirmed email alone never reaches them.
     Historical options (not for sign-up any more): Supabase's default `{{ .ConfirmationURL }}`
     (works once the redirect is allowlisted: Supabase verifies the link and
     sends the browser to `/auth/callback?code=…`; open it in the browser you
     registered with, otherwise the app says "email confirmed — sign in"), or,
     recommended (works in any browser and follows the app's own URL in every
     environment):
     `<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Confirm your email</a>`
     Both continue to `/link-account`. The older
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` also
     works, but only once the Site URL is right.
   * Reset password — default `{{ .ConfirmationURL }}`, or
     `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`, or the
     older `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
   * Invite user: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
     (the admin invite API sends no PKCE code, so invitations keep using
     `/auth/confirm` and the Site URL)
   * Magic link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink`

   `/auth/callback` accepts a PKCE `code`, a `token_hash` + `type`, and
   Supabase's `error_code` (expired or already-used links); it never logs or
   forwards a code or token, and continues only to same-origin paths.

   These templates can't be read with the public key, so they're **not
   verified by the app or its tests**: check them in the dashboard. Configure
   custom SMTP before inviting real staff or opening registration (Supabase's
   built-in sender is heavily rate-limited).
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
   The two `NEXT_PUBLIC_` values must be present **at build time** (the build
   fails without them). Serve over HTTPS only, redirect HTTP to HTTPS, and keep
   the platform from stripping or overriding the security headers.

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
| `npm run db:storage-consistency [-- --verify-checksums]` | no (READ ONLY transaction; downloads only to memory) | Document rows vs `patient-documents` objects: missing/unreferenced files, sizes, types, key ownership, bucket posture; optional SHA-256 re-check. Exit 0/1/2. See "Backup and recovery runbook". |
| `npm run storage:backup [-- --destination=<kind>:<target> --apply \| --verify]` | dry run: no; `--apply` writes only to the backup destination | Incremental, write-once patient-file backup with a manifest. **No destination is approved yet**, so only the dry run works. See "Backup and recovery runbook". |
| `npx tsx prisma/p65-dry-run.ts` | no (always rolled back) | Before applying `20261023000000_patient_intake`: runs it in one transaction, checks tables/RLS/grants/function privileges, proves every existing table unchanged, rolls back. Refuses once applied. |
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
| `/reports`, `/documents`, patient Lab reports and Documents tabs (P6.2) | **Database** (`server/data/lab-reports.ts`, `documents.ts`) |
| AI summary and AI notes/safety assistants | Hidden (later phases) |
| `/notifications`, notification bell, sidebar notification badge | **Database** (`server/data/notifications.ts`) once migration `20261019000000` is applied; until then an honest "not available yet" state. Never demo data. Patient portal bell: "not available" (staff notifications only). |
| `/staff` Invitations tab, "Invite staff", Doctors page "Invite doctor", `/invitations` (invitee) | **Database** (`server/data/invitations.ts`) once migration `20261019000100` is applied; "not set up yet" until then |
| Every other staff page (lab reports, documents, expenses, AI assistant, clinic admin, audit log, settings…) | Mock data, with a visible **"Demo data"** notice |
| Patient portal: home, lab reports, report detail, documents | **Database** (`server/data/portal.ts`, P6.3): the patient's own reviewed, shared reports and their result files |
| Other patient-portal pages (appointments, prescriptions, payments, AI, profile) | Signed-in patient: "Not available yet" (hidden from the menu, no demo data). Demo mode: mock data |
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
  mock data. It can't reach the database. **Production builds refuse to run
  without the Supabase settings** (`next build` fails) unless
  `SEHAT_ALLOW_DEMO_BUILD=true` is set for a deliberate demo deployment.

## Browser security headers and safe error logging

* **Headers** (`src/lib/security-headers.ts`, wired in `next.config.ts`): every
  page gets a Content-Security-Policy, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a Permissions-Policy that
  switches off camera, microphone, geolocation, payment and similar features,
  and `Cross-Origin-Opener-Policy: same-origin`. Every response gets
  `X-Content-Type-Options: nosniff`; production builds also send
  `Strict-Transport-Security: max-age=31536000`. `X-Powered-By` is off. `/api`
  responses don't get the page CSP: file downloads set their own sandbox CSP.
* **CSP:** only this origin for scripts, styles, fonts and images (plus `data:`
  and `blob:` images for document previews); connections only to this origin and
  the Supabase project; no frames, plugins, `<base>` changes or cross-site form
  posts; the app can't be framed. It has no nonces, so scripts still allow
  `'unsafe-inline'` (Next.js's inline bootstrap) while pages stay statically
  rendered. Nonce-based CSP (every page rendered per request) is the stronger
  next step. `src/lib/security-headers.test.ts` fails if the app starts using
  something the policy doesn't allow (third-party scripts, iframes, workers…).
* **HSTS:** no `includeSubDomains` or `preload` yet. Both commit every subdomain
  of the production domain to HTTPS (preload effectively permanently); decide
  once the domain is known. HTTPS itself (certificates, HTTP→HTTPS redirect) is
  the hosting platform's job.
* **Error logs** (`src/server/log.ts`): unexpected server errors are logged as
  the error class, Prisma code, SQLSTATE, model and constraint field *names* and
  a few stack frames. Database and Prisma error messages are never logged (they
  can contain "Failing row contains (…)", "Key (email)=(…)" or the query
  arguments); other messages are redacted (emails, numbers, quoted values,
  credentials, keys, tokens) and truncated. A test fails if server code passes a
  raw error or its message to `console.*`.

## Monitoring and alerting

**Status: hooks implemented, monitoring NOT active.** No monitoring provider is
installed or configured; by default every monitoring event is dropped
(`monitoringStatus()` reports `active: false`). Nothing is sent anywhere.

* **Module:** `src/server/monitoring.ts` (provider-neutral). Code reports
  categorised events; a sink decides where they go: `none` (default),
  `console` (`SEHAT_MONITORING=console`: one `[monitor] {json}` line per event
  on stdout, for local use or a log-based provider), or a provider sink passed
  to `setMonitoringSink()` (the single integration point, e.g. registered in
  `src/instrumentation.ts` once a provider is approved).
* **Events** carry only: category, severity, scope (route template or operation;
  ids and query strings masked), a reason code, HTTP status, the data-free error
  summary (class, Prisma code, SQLSTATE, model/field names, a few redacted stack
  frames) and burst counts. Never names, phone numbers, emails, clinical data,
  user ids, IP addresses, passwords, tokens, SQL parameters, request bodies or
  raw database messages (`src/server/monitoring.test.ts`).
* **Hooks:** API 500s (`route-handler.ts`) and auth errors (`auth/http.ts`) →
  `server_error`, or `db_unavailable` for connection failures (Prisma P1001/
  P1002/P1008/P1017/P2024, network errors, SQLSTATE 08xxx/53300/57P01);
  Server Component, Server Action and proxy errors via `onRequestError` in
  `src/instrumentation.ts` (route template only); audit-write failures
  (`audit.ts`, which is fail-open, so this is the only signal) →
  `audit_write_failed`; authorization refusals (`auditDenied` in
  `auth/session.ts`) → `access_denied`; failed sign-ins → `auth_failure`
  (reason code only; the attempted email stays in the audit row); failed
  linking-code redemptions → `link_code_failure`.
* **Not covered by app hooks:** Next.js's own error output in the hosting logs
  (unchanged; it can include error messages — keep log access restricted and
  retention short), and migration failures: `prisma migrate deploy` runs in the
  deploy pipeline, so the pipeline must fail and notify on a non-zero exit.

**Recommended alert thresholds.** The same rules raise one in-process `alert`
event per window (`BURST_RULES`), but each server instance counts separately,
so configure the authoritative rules in the provider, on aggregated counts:

| Event | Threshold | Severity | Why |
|---|---|---|---|
| `audit_write_failed` | ≥ 1 in 5 min | critical | Any lost security record. |
| `db_unavailable` | ≥ 3 in 1 min | critical | Outage or pool exhaustion. |
| `server_error` (5xx) | ≥ 10 in 5 min, or > 2 % of requests | error | Unexpected failures. |
| `access_denied` | ≥ 50 in 5 min (or 5× the weekly baseline) | warning | Probing or a broken role. |
| `auth_failure` | ≥ 20 in 5 min | warning | Credential stuffing. Per-account detail is in `audit_events` (`npm run db:audit`). |
| `link_code_failure` | ≥ 15 in 15 min | warning | Code guessing across accounts (the database already limits each account to 5 failures in 15 min). |
| migration step | any failure | critical | Deploy pipeline, not the app. |

* **No IPs or user ids in monitoring.** `audit_events.ipAddress` comes from
  `x-forwarded-for`, which a client can forge unless the hosting proxy
  overwrites it. Treat it as a hint until the platform's proxy behaviour is
  verified, and never use it for blocking.
* **Before enabling a provider:** choose one with an India/acceptable data
  region and a DPA; turn off its automatic capture of request bodies, headers,
  cookies, query strings, user identity, IPs and breadcrumbs; register it via
  `setMonitoringSink()`; then verify with a synthetic error that only the fields
  above arrive.

## Backup and recovery runbook

**Status: safeguards implemented in the repository; backups NOT verified.**
Nobody has confirmed what database backups this project has (plan, frequency,
retention, point-in-time recovery), no backup of the `patient-documents`
Storage bucket exists, and no restore has ever been tested. A database backup
does **not** include Storage objects: document rows and their files must be
backed up and restored together. Nothing below claims otherwise.

| Implemented (repository) | Still requires the owner or an approved provider |
|---|---|
| Restore hold read by the orphan sweep (fail closed) | Setting the hold value in the database (`ALTER DATABASE`, below) |
| Orphan sweep never removes `no_row` objects | Database backup plan, frequency, retention, PITR — check in the dashboard |
| `npm run db:storage-consistency` (read-only rows ↔ objects check, optional checksum re-hash) | A Storage backup (copy of the bucket) with an approved provider and region |
| `npm run storage:backup` engine: dry run, incremental write-once copy, manifest, verify (tested with in-memory fixtures only) | An approved destination adapter in `DESTINATIONS` (`prisma/file-backup.ts`); the registry is empty, so `--apply` / `--verify` refuse |
| `db:verify-rls`, `p62-storage-setup.ts` posture check, `tableFingerprints()` | Encryption keys, off-platform copy, retention periods, a first restore drill |

**Recovery targets** (maximum acceptable data loss and recovery time) and
**retention periods** have not been decided; they set backup frequency and
must be agreed by the owner (with legal advice for medical records).

### Restore hold

The orphan sweep (`prisma/p62-orphan-sweep.ts`) reads the database-wide
setting `sehat.restore_hold`. `--apply` runs only when it is exactly `off`
in `pg_db_role_setting` **and** in the sweep's own session; anything else —
`on`, missing, another value, a role/session override, an unreadable catalog —
is treated as an **active hold** and nothing is removed. The hold is re-read
before every single removal. A database restored into a new project starts
without the setting, i.e. **held**, until someone deliberately clears it.

* **Current state:** not configured, so the sweep refuses `--apply` (verified
  read-only: the setting is absent). Dry runs work as before.
* **Enable (owner/operator, SQL editor or `psql` on `DIRECT_URL`):**
  `ALTER DATABASE postgres SET sehat.restore_hold = 'on';`
* **Clear (only after the verification below, with authorization):**
  `ALTER DATABASE postgres SET sehat.restore_hold = 'off';`
* New connections see the change; the sweep reads the catalog directly, so a
  running sweep stops at its next removal. Check with
  `SELECT setconfig FROM pg_db_role_setting WHERE setrole = 0;`
* **Not yet verified:** that Supabase lets the `postgres` role run this
  `ALTER DATABASE` (it owns the database, and a Supabase-managed
  `app.settings.*` setting already exists there). If it is refused, the hold
  stays "not configured" — still fail closed — and the sweep cannot apply at
  all until another mechanism is approved.
* The hold covers the sweep only. The application itself has no maintenance
  mode: stopping writes during a recovery means stopping or redirecting the
  app at the hosting platform.
* `no_row` objects (a file with no document row) are **never** removed by the
  sweep, hold or not: after a point-in-time restore they may be the only copy
  of a file whose row was lost. They are listed for manual review.

### Storage consistency check

`npm run db:storage-consistency` (read-only: one `REPEATABLE READ, READ ONLY`
transaction on `DIRECT_URL`, rolled back; pages of 500 in key order):

* bucket posture: exists, private, approved size/type limits, RLS on
  `storage.objects`, no storage policies;
* AVAILABLE/ARCHIVED rows without an object (`missing_object`), objects without
  a row (`unreferenced_object`, `malformed_object_key`), storage key not equal
  to `<clinicId>/<documentId>` of its own row (`key_ownership`), object size or
  type different from the row (`size_mismatch`, `size_unknown`,
  `type_mismatch`); objects of FAILED or stale UPLOADING rows are warnings;
* `-- --verify-checksums [--max-files=N]` (default 200, max 10 000) downloads
  each file into memory with the server secret key, re-hashes it against the
  row's SHA-256 and size, and discards it (`checksum_mismatch`,
  `unreadable_object`). Nothing is written to disk.

Output is counts plus at most 20 document ids per finding — never clinic ids,
raw keys, names, filenames, checksums or contents. Exit code 0 = consistent,
1 = mismatch, 2 = could not verify (connection, permission or configuration;
class/code only). To check a restored project, export **its** `DIRECT_URL`,
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the shell first (they
take precedence over `.env.local`). It has been tested with in-memory fixtures
only (`prisma/storage-consistency.test.ts`); it has not yet been run against a
real project.

### Patient-file backup utility (no destination approved yet)

`npm run storage:backup` (`prisma/file-backup.ts`) is provider-independent and
**cannot copy anything yet**: the approved-destination registry
(`DESTINATIONS`) is empty, so `--apply` and `--verify` refuse with
"No backup destination has been approved yet". It has never run against real
data.

* **Dry run (default):** reads the AVAILABLE/ARCHIVED document rows in one
  `REPEATABLE READ, READ ONLY` transaction and reports how many files would be
  copied. It reads no file and writes nothing.
* **`--destination=<kind>:<target> --apply`:** incremental. Files already in
  the destination's latest manifest are skipped. Each new file is read from the
  private bucket (secret key, in memory), checked against its row's SHA-256 and
  size (`source_mismatch` → not copied), written **write-once** (an existing
  copy is never replaced: a matching one left by an interrupted run is adopted,
  a different one is a `backup_conflict`), then read back and re-hashed.
  Finally a new write-once manifest is written.
* **Manifest:** `manifests/<snapshotAt>_<runId>.jsonl`: a header line
  (`format`, `runId`, `snapshotAt` = the database snapshot time, `createdAt`,
  `complete`, `files`), then one line per file
  `{ storageKey, sha256, sizeBytes, backedUpAt }`. Every manifest lists the
  whole backup set, so for recovery step 4 pick the earliest **complete**
  manifest whose `snapshotAt` is at or after the restore point T. Manifests are
  parsed strictly; a malformed one stops the run.
* **`--verify`:** re-hashes the copies listed in the latest manifest
  (`backup_missing`, `backup_corrupt`) and reports usable files it doesn't
  cover (`not_backed_up`, warning). It writes nothing.
* **Limits and failure handling:** `--max-files=N` per run (default 500; the
  rest are `deferred` and the manifest is marked incomplete), sequential, 8 MB
  files in memory. Five destination errors in a row stop the run with no
  manifest written. Logs carry counts and document ids only; the manifest,
  which contains storage keys and checksums, lives only in the destination.
  Exit code 0 = OK, 1 = findings, 2 = could not run.
* **To enable (owner decisions first):** choose the provider, region, account
  and credentials (write-only/no-delete for the backup job, ideally with
  object lock or versioning so the store itself enforces write-once),
  encryption (provider-side with your own key, or client-side — not yet
  implemented) and retention; then implement a `BackupDestination` adapter for
  that store, register it in `DESTINATIONS`, test it against a non-production
  bucket, and run a first `--verify` and restore drill before relying on it.

### Recovery procedure

1. **Preconditions and authority.** A recovery is started only by the owner
   or a named operator they authorize (two people at most hold restore
   access). Record who, when, why and the target restore point before
   starting. Rotate any credential suspected to be involved first.
2. **Stop writes and hold.** Stop or redirect the app at the hosting platform
   (there is no in-app maintenance mode), then set the restore hold to `on`
   on the **production** database. Do not run the orphan sweep with `--apply`.
3. **Restore the database to a NEW, non-production project** wherever the
   plan allows (never over production as a first step). Note the exact
   restore point T. The restored project starts held (setting absent).
4. **Pick a compatible file backup** taken **at or after T**. Files are
   written before their row becomes AVAILABLE and are never overwritten, so a
   file backup taken after T contains every file the rows at T refer to; an
   older one does not.
5. **Restore files without overwriting.** Copy objects into the restored
   project's private `patient-documents` bucket by key, skipping keys that
   already exist (the app itself uploads with `upsert: false`). Never change a
   key, and never use public or signed URLs for the copy.
6. **Reconcile, never auto-delete.** Run `npm run db:storage-consistency`.
   `missing_object` → find the file in another backup or record the loss per
   document id. `unreferenced_object` (files newer than T, or orphans) → leave
   them in place (or copy them to a separate quarantine location) and review by
   hand; the sweep will not remove them.
7. **Verify integrity.** `npm run db:storage-consistency -- --verify-checksums
   --max-files=<all usable rows>` must report `RESULT: CONSISTENT`;
   `npm run db:verify-rls` must pass; compare `tableFingerprints()`
   (`prisma/p5-preflight.ts`, via `npm run db:p5-preflight`) row counts against
   what is expected at T.
8. **Verify privacy posture and tenant isolation.**
   `npx tsx prisma/p62-storage-setup.ts` (read-only without `--create`) must
   report a private bucket, RLS on and no storage policies; `db:verify-rls`
   covers clinic/branch/patient scoping and the Data API.
9. **Record and validate before switching over.** Write down the restore
   point, data-loss window, time taken, findings and their resolution. Sign in
   as fixture/test users of each role and open a document before pointing the
   production app at the restored project.
10. **Clear the hold last**, with authorization, only after steps 6–9 pass:
    `ALTER DATABASE postgres SET sehat.restore_hold = 'off';`
11. **Drills.** Every quarter, and after any major migration, restore into a
    temporary non-production project and run steps 3–9; record measured
    recovery time and data-loss window; delete the temporary project
    afterwards. No drill has been run yet.
12. **Backup protection (owner decisions, none in place yet).** Backups and
    dumps contain full patient data: encrypt them with keys held outside
    Supabase; use credentials separate from production; keep at least one
    copy off-platform in an approved region; set retention to match the
    medical-records decision; restrict restore and download access to the
    named operators; never keep copies on laptops or in this repository.

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
5. Sign-up stays **on** for patient self-registration (P6.4); it gives no
   access by itself. Verify with one approved test address that (a) a new
   invitee can set a password and accept, and (b) an existing account receives
   the sign-in link and can accept.

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

## Lab reports and patient documents (P6.2)

Migration `20261021000000_patient_documents`; private Storage bucket
`patient-documents` (created by `prisma/p62-storage-setup.ts --create`).
Screens: `/reports`, `/reports/[id]`, `/documents`, the patient Lab reports and
Documents tabs, and the "Results" list under a consultation's ordered tests.
Demo mode keeps the mock screens.

* **Who sees what (RLS, `sehat_app` has SELECT only):** clinical files and lab
  reports — Administrators within their branch scope; doctors for patients they
  have an appointment with, in any branch of the clinic; nurses within their
  branch. Administrative files (ID proof, insurance, consent, other) —
  `patient_document.view` holders (Administrator, Clinic Manager, Receptionist)
  within their branch scope. Receptionists may upload clinical files and
  register lab reports but can never read them back. UPLOADING and FAILED rows
  are never visible. Another clinic's rows don't exist for the caller.
* **Writes** only through `app.*` SECURITY DEFINER functions that re-check the
  caller: `begin_/complete_/fail_/archive_patient_document`,
  `create_lab_report`, `set_lab_report_values`, `review_lab_report`,
  `set_lab_report_shared`. No deletes: documents are archived with a reason.
  New values clear a review; a shared report is locked; only a reviewed report
  can be shared; only the assigned (ordering) doctor reviews. At most 30 new
  files and 30 new lab reports per user per 10 minutes.
* **Files:** `src/server/storage/documents.ts` is the only module that holds a
  Storage client (server-only, secret key; enforced by a guard test). A write
  needs the key `app.begin_patient_document_upload` returned; a read needs an
  AVAILABLE row read through RLS in the caller's transaction. Keys are always
  `<clinicId>/<documentId>` and re-checked. No public or signed URLs. The
  browser never talks to Storage (verified: no listing, upload, download,
  signed URL or public URL works with the publishable key).
* **Upload checks (server):** ≤ 8 MB (refused from `Content-Length` before the
  body is read), PDF/JPEG/PNG by magic bytes, declared type and extension must
  agree, PDFs with scripts/launch/embedded files are refused (best effort —
  names inside compressed object streams aren't visible), filenames sanitised
  to a display name, SHA-256 recorded, duplicates (same patient, same bytes)
  refused. The database re-checks type, size, checksum format and filename.
* **Downloads:** the access (or denial) is audited and committed before the
  bytes are fetched; bytes are checked against the stored SHA-256 and size.
  Responses: `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
  sandbox; default-src 'none'`, `Cache-Control: private, no-store`,
  `Cross-Origin-Resource-Policy: same-origin`. PDFs always download; images may
  be previewed in-page from a private object URL.
* **Audit:** `document.uploaded / upload_rejected / upload_failed / viewed /
  access_denied / view_failed / archived`, `lab_report.created /
  values_updated / reviewed / shared / unshared`, plus row-change events (ids
  and column names only). Metadata carries ids, category, MIME type, size,
  counts and reason codes — never titles, filenames, values, notes, patient
  names or file contents. Application logs carry error codes only.
* **Orphans:** `prisma/p62-orphan-sweep.ts` (dry run by default; `--apply`
  removes) deletes only FAILED rows' objects and objects of rows still
  UPLOADING after 2 hours, and only while the restore hold is `off`; objects
  with no row are listed for manual review, never deleted; never AVAILABLE or
  ARCHIVED files; rows are never changed (see "Backup and recovery runbook").
* **Role defaults:** `src/data/permission-catalog.ts` grants exactly the
  migration's matrix; `prisma/seed/p62-role-matrix.test.ts` reads the migration
  SQL and fails if a reseed would grant anything different.
* **Patient portal:** see P6.3 below.

## Patient portal (P6.3)

`/portal` (home), `/portal/reports`, `/portal/reports/[id]`, `/portal/documents`
for a signed-in patient; demo mode keeps the mock portal. **No migration:** it
uses the P6.2 policies. Routes (all `patientRoute` / `patientFileRoute`, only
under `/api/v1/portal/`): `GET summary`, `GET lab-reports`,
`GET lab-reports/[id]`, `GET documents`, `GET documents/[id]/file`.

* **Who:** a verified Supabase session whose account is ACTIVE, holds an ACTIVE
  `PATIENT` membership in an ACTIVE clinic, and has a patient record linked to
  it (`patients.userId`, unique — one record per account). Links are created
  only by an operator (`npm run auth:provision -- … --role PATIENT --patient
  <number>`, audited), after the clinic has verified the person; the patient
  then gets a Supabase invitation to that exact email and sets their own
  password. Nothing is matched by name, phone or a browser-supplied id. A
  portal account without a link gets `PATIENT_NOT_LINKED` (a generic "contact
  your clinic" page that reveals nothing about records). Staff memberships never
  apply here and portal sessions never reach staff routes.
* **What:** reports with `status = REVIEWED` **and** `sharedWithPatientAt` set,
  for the linked record only; files only of category `LAB_REPORT`, status
  `AVAILABLE`, attached to such a report. ID proof, insurance, consent, imaging,
  archived, failed and unshared files are never visible. Enforced by RLS
  (`lab_reports_read`, `patient_documents_read`, `app.current_patient_ids()`,
  which also requires the ACTIVE membership, clinic and account) **and** repeated
  in every query (`src/server/data/portal.ts`). Responses carry no internal
  notes, staff ids, storage keys or checksums.
* **Withdrawal:** unsharing a report, deactivating the patient's membership,
  disabling the account or archiving the patient record cuts access on the next
  request (checked at the database, even for an already-loaded session).
* **Refusals** — unknown, malformed, unshared, someone else's, other clinic —
  are the same `404 NOT_FOUND`.
* **Files** go through the P6.2 storage gate (`openPatientDocumentFile`): the
  row is read in the patient's own RLS-scoped transaction, the view is audited
  and committed first, the bytes are checked against the stored SHA-256, and the
  response has the same no-store / nosniff / sandbox headers as staff downloads.
* **Audit:** `lab_report.viewed`, `lab_report.access_denied`, `document.viewed`,
  `document.access_denied`, `document.view_failed`, actor = the patient, metadata
  `{ portal: true }` plus ids/type/size only.
* **Other portal pages** (appointments, consultations, prescriptions, payments,
  AI assistant, profile) are not on real data yet: with a signed-in patient they
  show "Not available yet" and are hidden from the navigation — never demo data.
* **Onboarding** (P6.4, below): self-registration plus a clinic-issued
  linking code; "Forgot password?" on the sign-in page.
* **Not built (decisions pending):** in-app identity verification (the clinic's
  own procedure is relied on), mobile/SMS verification, a patient-consent
  record, and an in-app tool to remove an existing portal link (deactivate the
  membership in the staff directory or disable the account instead).

## Patient self-registration and linking codes (P6.4)

Migration `20261022000000_patient_link_codes` (forward-only, additive). Pages:
`/register` (live mode), `/link-account`, the "Patient portal" card on a
patient's page. Routes: `GET`/`POST /api/v1/patients/[id]/portal-link`,
`POST /api/v1/patients/[id]/portal-link/revoke` (permission
`patient.portal_link`: **Administrator, Receptionist** only). Redemption is the
Server Action in `src/app/link-account/actions.ts`.

* **Registration gives nothing.** `/register` creates a Supabase login (email
  + password of at least 12 characters; email confirmation required). The answer
  is the same whether or not the address already has a login. There is no Sehat
  Setu account, membership or record access until a code is redeemed; signed-in
  logins without an account are sent to `/link-account` from every guarded page.
  Email verification only proves control of an inbox. It is **not** treated as
  proof of identity, and neither is knowing a patient number.
* **Issuing** (after the clinic's identity-verification procedure; the staff
  member must tick a confirmation, recorded as `identityVerified` in the audit
  event): `app.issue_patient_link_code` checks the caller (ACTIVE staff
  membership with `patient.portal_link` in the pinned clinic), that the patient
  is in that clinic, ACTIVE and not yet linked, and the limits (60 codes per
  clinic per hour, 5 per patient per 24 h). A new code revokes the previous one.
* **The code:** 16 characters of Crockford base32 (80 bits from
  `gen_random_uuid()`, i.e. `pg_strong_random`), shown once as
  `XXXX-XXXX-XXXX-XXXX`, valid for **72 hours**, single-use. Only
  `SHA-256("sehat-setu:patient-link:" + code)` is stored. The plain code exists
  only in the issuing response and the staff member's dialog: never in logs,
  audit rows, storage or the patient's record. Hand it over in person; never
  send it to anyone whose identity wasn't checked.
* **Redeeming** (`app.redeem_patient_link_code`, one transaction): the server
  pins only the Supabase user id from `getUser()` and passes the
  Supabase-confirmed email; the browser sends only the code (strict schema).
  The function takes an advisory lock per login, applies the attempt limits,
  finds the code by hash (`FOR UPDATE`), then creates or reuses the account,
  adds an ACTIVE `PATIENT` membership, fills `patients.userId` only if empty
  and marks the code `REDEEMED`. Patient and clinic come only from the code row.
* **Refusals:** unknown, malformed, expired, used, superseded and revoked codes
  all give the same answer ("isn't valid or has expired"). A valid code is
  refused as "can't be used with this account" (and stays usable for the
  clinic to sort out) when linking would replace or mix links: the patient is
  already linked, the login already has a patient (one record per account), the
  email belongs to a different login, the account is disabled, the clinic
  switched this portal membership off, or the person is staff at that clinic.
  A repeat by the login that redeemed it is an idempotent success.
* **Brute force:** at most 5 failed redemptions per login per 15 minutes and 10
  per 24 hours (recorded in `patient_link_attempts`: login id + time only, kept
  30 days); plus 80-bit codes and 72-hour expiry. Each login also needs a
  confirmed email.
* **Database posture:** RLS on both new tables with deny-all policies and **no
  table privileges** for `sehat_app`, `anon` or `authenticated`; the four entry
  points are SECURITY DEFINER with `search_path = ''`, EXECUTE for `sehat_app`
  only; the generator/hash helpers aren't executable by the runtime role.
  Verified by `prisma/p64-dry-run.ts` (rolled back), `npm run db:verify-rls`
  and `src/server/data/patient-link.integration.test.ts`.
* **After linking** the P6.3 rules apply unchanged: the patient sees only their
  own reviewed and shared reports and those reports' available result files.
* **Not covered:** SMS/phone verification (deferred), CAPTCHA (dashboard
  setting, recommended), unlinking from the app, and linking one login to
  several records (e.g. a parent managing a child), which the data model
  doesn't support.

## Patient onboarding (P6.5)

**Status: migration `20261023000000_patient_intake` applied to the development
project (2026-10-15; checksum verified), onboarding dialog and staff review
enabled.** Not yet applied to any production project. Wherever the migration
is missing, the portal simply doesn't offer onboarding (`getIntakeState()`
returns `{ available: false }`) and the staff section stays hidden.

* **Where:** a three-step dialog in the patient portal
  (`src/components/portal/patient-onboarding.tsx`), mounted by the portal
  layout for a signed-in, LINKED patient. Registration stays email + password
  only; an unlinked login still goes to `/link-account` and never sees it.
  Steps: personal information (required: legal name, date of birth, phone,
  address, city), medical history (all optional), current symptoms (optional).
* **When it opens:** while the server-side profile row has no `completedAt`.
  Each step is saved before moving on, so it resumes at the first unsaved step.
  "Finish later" only postpones it for the browser session (sessionStorage);
  completeness is never decided in the browser. The portal home card ("Complete
  your health profile" / "Review or update") reopens it. Nothing in the portal
  is blocked by an incomplete profile, and step 3 shows emergency guidance.
* **Data:** two NEW tables, both patient-reported and kept apart from the
  clinic's own record (`patients` is never written by onboarding):
  `patient_intake_profiles` (one per patient record; explicit allergy status
  `NOT_ANSWERED` / `UNKNOWN` / `NONE_KNOWN` / `HAS_ALLERGIES`; repeatable
  allergies and medicines; progress timestamps) and `patient_symptom_reports`
  (append-only pre-visit questionnaires, never a diagnosis; a new answer never
  overwrites an earlier one). Before step 1 is saved, the form starts from the
  clinic record's contact details; nothing is derived from the email address.
* **Authorization:** Server Actions (`src/app/(portal)/intake-actions.ts`)
  re-verify the session (`requirePatient`) and accept strict input only — no
  patient, clinic or user ids. The database functions
  (`app.save_patient_intake_personal`, `…_medical`, `skip_…`,
  `app.submit_patient_symptom_report`, `app.complete_patient_intake`) take the
  patient from `app.current_patient_ids()` and refuse unless it is exactly one
  ACTIVE record in the pinned clinic. A symptom report can link only the
  caller's own SCHEDULED/CONFIRMED appointment in that clinic (otherwise
  `APPOINTMENT_NOT_FOUND`, never a silent re-assignment). The runtime role can
  only SELECT the new tables. RLS: the patient's own rows, or staff for whom
  `app.patient_reported_visible(patient)` is true — `medical_record.view` /
  `medical_record.manage` within the caller's branch scope (the patient's
  registration branch), or a doctor holding `patient.medical_record.view` with
  an appointment for that patient. Receptionists, nurses, lab, pharmacy and
  billing staff see nothing (unlike clinical files, there is no
  `lab_report.view` clause). Nothing links accounts, adds memberships or
  touches clinical records; the linking-code model is unchanged.
* **Dates:** "today" for the date-of-birth check is the application's time zone
  (Asia/Kolkata) in both the browser (`todayInAppZone`) and the database
  (`(now() AT TIME ZONE 'Asia/Kolkata')::date`); appointment times in the dialog
  are shown in IST.
* **Staff review:** the staff patient page shows a read-only "Patient-reported
  health information" section (`src/components/patients/patient-reported-card.tsx`,
  `GET /api/v1/patients/[id]/patient-reported`), badged "Patient-reported · not
  clinician-confirmed": allergy status and list, medicines, conditions, history,
  the reported personal details, and the symptom questionnaires (newest first,
  20 at most). Permission gate `medical_record.view` / `medical_record.manage` /
  `patient.medical_record.view`, then the database rule above; anything else is
  403/404 and the section stays hidden. Views are audited
  (`patient_intake.viewed`, `patient_intake.access_denied`; ids only). There is
  no editing, and nothing is copied into the clinical record.
* **Duplicates and limits:** profile saves are idempotent upserts; a symptom
  report carries a browser-generated request id (unique per patient — a repeat
  returns the first report); 20 symptom reports per patient per day.
* **Audit and logs:** `patient_intake.personal_saved`, `.medical_saved`,
  `.symptoms_submitted` (metadata: `appointmentLinked` only), `.completed`, plus
  row triggers (column names only). No names, dates of birth, phone numbers,
  allergies, medicines or symptoms in audit rows, logs, monitoring or URLs.
* **Verification (development project):** `npx tsx prisma/p65-dry-run.ts`
  (before applying: executes the SQL in a transaction, checks grants, always
  rolls back), `npm run db:verify-rls` (111/111 after applying), and
  `src/server/data/patient-intake.integration.test.ts` (as the runtime role,
  rolled back: the full patient flow, resume, idempotent symptom reports,
  refusals, staff visibility per role and clinic, the clinic's patient record
  unchanged).
* **For another environment (e.g. production):** `npm run db:migrate` against
  that project's `DIRECT_URL`, then `npm run db:verify-rls` and
  `npm run test:integration` where fixtures exist.

## Patient self-booking and portal dashboard

**Status: migrations `20261027000000_patient_link_code_only` (existing records
link only by the clinic's single-use code; email matching revoked from the
runtime role) and `20261028000000_patient_self_booking` applied to the
development project (2026-10-16; all 23 checksums verified, `db:verify-rls` 111/111,
booking/linking/intake/portal/front-desk integration tests passing).** Not yet
applied to any production project; wherever the booking migration is missing,
booking, cancel and reschedule answer "Online booking isn't available yet" (503
`FEATURE_UNAVAILABLE`) while the read-only portal pages keep working.

* **Pages (live portal):** Home (own dashboard), Book Appointment
  (`/portal/book`), My Appointments, My Health Profile, Reports, Documents,
  Bills & Payments (`src/components/portal/live-portal-care.tsx`). Consultations,
  prescriptions and the AI assistant still show "not available yet" for a real
  patient (`LIVE_PORTAL_NAV` in `src/lib/nav-config.ts`) — never demo data.
* **API:** `/api/v1/portal/{dashboard,appointments,appointments/[id],
  appointments/[id]/cancel,appointments/[id]/reschedule,booking-options,slots,
  invoices,record}`, all `patientRoute` (verified session + ACTIVE PATIENT
  membership + linked record). No route reads a patient or clinic id from the
  request; booking input is strict (`bookingSchema`).
* **Reads:** in the patient's own transaction, so the existing RLS
  (`appointments_read`, `invoices_read`, `payments_read`, `patients_read`:
  own rows only) applies, and every query repeats the patient filter. Another
  patient's appointment is the same 404 as one that doesn't exist. No staff
  notes, other patients or clinic-wide figures are returned.
* **Writes:** only through the new SECURITY DEFINER functions
  `app.patient_book_appointment`, `app.patient_cancel_appointment` and
  `app.patient_reschedule_appointment` (granted to `sehat_app`); RLS still gives
  patients no INSERT/UPDATE on `appointments`. They take the patient from
  `app.current_patient_ids()` (exactly one ACTIVE record in the pinned clinic)
  and re-check: standard slot grid (Mon–Sat 09:00–17:00 IST, 30 min, no
  13:00–14:00 — same as `defaultSlotsFor`), 30 minutes to 60 days ahead, ACTIVE
  doctor practising at the ACTIVE branch, the slot free, the patient not
  already booked at that time or with that doctor that day, at most 5 upcoming
  self-managed appointments; visit type IN_PERSON, or ONLINE only with a
  doctor whose profile offers online consultation (`ONLINE_UNAVAILABLE`
  otherwise). Cancel/reschedule: own SCHEDULED/CONFIRMED
  appointments that haven't started; reschedule keeps doctor and branch.
* **Double booking:** patient and staff bookings take the SAME advisory lock
  (`'slot:<doctorId>:<ISO instant>'`, `app.lock_doctor_slot`) and re-check
  `appointments` under it, so a patient and a receptionist can't take one slot.
  Free times shown in the browser (`app.patient_doctor_busy_slots`: times only,
  own clinic's doctors) are a hint only.
* **Symptoms at booking:** optional; saved in the same transaction as a
  patient-reported symptom report (`app.submit_patient_symptom_report`) linked
  to the new appointment — both or neither.
* **Audit/notifications:** every change is row-audited by `audit_appointments`
  (actor: the patient's user) and notifies the doctor via `notify_appointments`.
* **Health profile:** patient-reported answers (onboarding, editable) are shown
  apart from the clinic record (`GET /api/v1/portal/record`, read-only).
  Diagnoses, prescriptions and lab results can't be edited by patients.
* **Tests:** `portal-booking-rules.test.ts`, `portal-booking.test.ts`,
  `api/v1/portal/booking-routes.test.ts`, `src/test/ui/live-portal-care.test.tsx`;
  database behaviour (RLS, locks, conflicts, other patients) in
  `portal-booking.integration.test.ts` — run with `npm run test:integration`
  once the migration is applied to the test database.

## Clinic administration: setup, audit log, expenses (P7)

**Status: migration `20261029000000_expenses_and_setup_audit` applied to the
development project (2026-10-16; the 23 earlier checksums verified unchanged
first; `clinic-admin.integration.test.ts` 7/7 passing, rolled back).** Not yet
applied to any production project.

* **Pages (live staff app):** Branches, Departments, Specialties, Audit Log,
  Expenses, Subscription and Settings now read the clinic database
  (`src/components/clinic-admin/*`); they're in `LIVE_ROUTE_PREFIXES`, so the
  demo-data notice no longer shows there. Demo mode keeps the browser sample
  data. Users & Roles and custom roles are still demo-only.
* **Branches / departments / clinic profile:** writes go through the existing
  RLS policies (`branches_insert/update` need `branch.create`/`branch.update`;
  `departments_*` need `clinic.settings.manage` or `branch.update`;
  `clinics_update` needs `clinic.update` or `clinic.settings.manage`). Nothing is
  deleted: branches and departments are deactivated. The head office can't be
  deactivated, nor a branch with upcoming appointments. Branch codes and the
  clinic code can't be changed from the app. The screens get their buttons from
  server capability flags (`ClinicProfile.can`); the server re-checks.
* **Specialties:** the catalogue is shared by every clinic (no tenant column),
  so it stays read-only for clinics (`platform.specialty.manage` is operator-only);
  the page shows each specialty's use by this clinic's doctors and departments.
* **Audit log:** `GET /api/v1/audit-events` (`clinic.settings.manage` or
  `role.manage`, also enforced by `audit_events_read`). It returns who, what,
  when and the changed column names, never values. A failed sign-in's attempted
  email (`actorLabel`) is never returned. New row-change triggers:
  `audit_branches`, `audit_departments`, `audit_clinics` (update), `audit_expenses`.
* **Expenses:** table `expenses` (integer paise, per branch). Read:
  `billing.manage` or `financial_reports.view`; record/void: `billing.manage`;
  clinic + branch isolation (`app.branch_visible`). Column grants allow INSERT of
  the entry fields only and UPDATE of the void columns only; no DELETE grant. The
  update policy allows only RECORDED → VOIDED by the current user, with a reason
  (CHECK `expenses_void_consistent`). The app inserts with an explicit column
  list for this reason. Billing summary `totalExpensesThisMonth` is the recorded
  total for the IST month (null without expense permissions).
* **Plan & usage:** there is no subscription billing. The page shows the clinic
  status and real usage counts only: no plans, prices or invoices.
* **Tests:** `clinic-admin-rules.test.ts`, `src/test/ui/live-clinic-admin.test.tsx`,
  and `clinic-admin.integration.test.ts`. The integration test uses the clinic's
  own active administrator (`activeAdminContext`), so it runs without the demo seed.

## Reception approval of patient bookings

**Status: migrations `20261030000000_appointment_review_statuses` (enum values
only) and `20261030000100_patient_booking_approval` applied to the configured
Supabase project (2026-10-16; checksums match, existing appointments unchanged).**
Before that they were verified on a throwaway PostgreSQL (PGlite, in memory):
all 26 migrations apply from scratch and 39 workflow checks pass (pending status,
slot held, guard trigger, permissions and branch/clinic scope, approve, reject,
expired, slot taken, reschedule, withdraw, limit, grants). Any other database
needs `npm run db:migrate` **before this code is deployed against it**: the app
reads the new columns and statuses, so without the migrations the patient
portal's appointment pages and the reception queue fail to load.

* **States:** a patient's booking is `PENDING_APPROVAL`. It holds its slot under
  the same advisory lock and busy checks as every booking, but isn't on any
  doctor's schedule. Reception moves it to `CONFIRMED` (approve) or `REJECTED`
  (reject, with a 3–300 character reason shown to the patient). `REJECTED` frees
  the slot, like `CANCELLED`/`NO_SHOW`. Rows are never deleted. A patient
  moving a request, or a confirmed visit, makes it `PENDING_APPROVAL` again.
* **Who decides:** `app.approve_patient_booking(id)` and
  `app.reject_patient_booking(id, reason)` (SECURITY DEFINER, EXECUTE for
  `sehat_app` only). Both require a verified staff member with
  `appointment.update` (Administrator, Clinic Manager, Receptionist; not
  doctors or nurses), in the pinned clinic, whose branch scope covers the
  appointment (another branch's or clinic's request is `NOT_FOUND`). They
  record `approvedAt/approvedByUserId` or `rejectedAt/rejectedByUserId/rejectionReason`
  from the session, never from the request.
* **Approval re-checks, under the slot lock:** still pending and unchanged (a
  conditional update, so of two concurrent approvals one gets `NOT_PENDING`),
  not started (`EXPIRED`), doctor ACTIVE at the ACTIVE branch and patient ACTIVE
  (`UNAVAILABLE`), and no other active booking for the doctor (`SLOT_TAKEN`) or
  the patient (`PATIENT_CONFLICT`) at that time. Lock order (advisory slot lock,
  then the row) matches the booking and reschedule paths.
* **Guard trigger** `guard_appointment_review` (BEFORE INSERT/UPDATE on
  `appointments`): the runtime role has table-wide UPDATE on `appointments`, so
  for its own statements the trigger refuses creating, moving, approving,
  rejecting or reviving a `PENDING_APPROVAL`/`REJECTED` row, and any write of the
  review columns. Only the definer functions (running as their owner) may.
* **Schedules and counts:** staff appointment lists, today's schedule, the
  waiting room, dashboards and reports leave out `PENDING_APPROVAL` and
  `REJECTED`. Declined requests can be listed with the "Declined requests" status
  filter. Reception sees requests in **Pending Patient Bookings** on the
  Appointments and Waiting Room pages (`GET /api/v1/booking-requests`,
  `POST …/[id]/approve`, `POST …/[id]/reject`).
* **Notifications:** a new or moved request → `BOOKING_REQUESTED` to the
  branch's staff with `appointment.update`; the doctor gets
  `APPOINTMENT_BOOKED` only on approval. Patients have no in-app notifications
  and no email is sent (no provider for it): the portal shows "Awaiting
  receptionist approval", "Declined" with the reason, or "Request expired".
