# CLAUDE.md — MediClinic

Handoff notes for Claude Code. Read this first, then `src/App.jsx`.

## What this is
MediClinic is a Progressive Web App for a **single-doctor** Philippine outpatient clinic with three role
portals — **Doctor**, **Patient**, **Staff/Receptionist**. The portal you get is decided by the account you
sign in with. Everything runs client-side on seeded mock data; there is no backend yet.

Stack: React 18 + Vite 5, Tailwind CSS 3, lucide-react. Single-file app by design (`src/App.jsx`, ~6k lines)
per the original brief.

```bash
npm install
npm run dev        # http://localhost:5173 (service worker NOT registered in dev — shown as "Simulated")
npm run build && npm run preview   # http://localhost:4173 (real SW, installable PWA)
```

## File map
```
index.html                 #root (app) + #print-root (print-only portal target), manifest, fonts
public/manifest.webmanifest
public/sw.js               App-shell SW: network-first navigation, cache-first static. Bump CACHE_VERSION per release.
public/icons/              192 / 512 / maskable-512 PNGs
src/main.jsx               Mounts <App/>, registers SW in PROD only, emits `mc-sw` window event
src/index.css              Tailwind layers, .card/.btn/.input/.badge components, @media print rules
src/App.jsx                Whole app — sections marked `// ===== N.`
```

### App.jsx sections
1. **Constants & utilities** — CLINIC letterhead, FREQUENCIES (OD/BID/TID/…/PRN with perDay), ICD10 list (WHO codes as used by PhilHealth), ALLERGY_RULES, `autoQty`, `invoiceTotals`, `stockStatus`, `isRxActive`, `nextId`.
2. **Seed data** — `buildSeed()`; 1 doctor, 3 staff, 10 patients, 14 accounts, 108 formulary items, 14 encounters (SOAP + meds), invoices, 7 queue items, 5 appointments, 4 message threads, 6 notifications, the editable `clinic` letterhead and `rxTemplate`. Today's queue is anchored to *now* (`ago(mins)`) so the demo always looks live.
3. **Store** — one pure `reducer` + `usePersistentStore` (localStorage key `mediclinic:v1`, `SCHEMA_VERSION`). Cross-tab sync via the `storage` event, **plus a re-read on `focus`/`visibilitychange`** so a tab that missed an event (throttled in the background, opened mid-write) converges when it comes forward. Open Staff and Doctor in two tabs to watch the queue move.
4. **PWA hooks & shell** — `useNetwork` (real + simulated offline), `useServiceWorkerState`, Header, LiveClock, PwaStatus popover (simulate offline, reset demo), InstallBanner (`beforeinstallprompt` + fallback hint), Toasts, SubNav.
4b. **Authentication** — `useSession` (localStorage when "remember me" is ticked, sessionStorage otherwise),
    `LoginScreen`, `ForcePasswordChange`, `AccountsPanel`. See **Accounts** below.
5. **UI primitives** — Badge/StatusBadge, SlideOver, Modal, StatCard, FakeQR, VitalsStrip, AllergyBadges, HourlyBars.
5c. **Device notifications** — `useDeviceNotifications` (permission + `notify`), `DeviceNotifier` (watches
    the store and raises one notification per new item), `DeviceNotificationSetting` (inside the bell).
    These are local notifications, not web push: see **Device notifications** below.
5b. **Messaging & notifications** — `MESSAGING_RULES` + `canMessage`, `threadsFor`/`unreadThreadCount`/`notificationsFor`/`dueReminders`, `NotificationBell` (header), `MessagesPanel` (shared inbox for all three portals), `PatientReminders`, `FollowUpQueue`.
6. **Print Center & documents** — `PrintCenter` renders a preview in a modal *and* portals a clean copy into `#print-root`; `@media print` hides `#root` and shows only `#print-root`, so multi-page docs paginate correctly. Documents: `MedicalCertificateDoc` (kind = certificate | abstract), `PrescriptionDoc`, `ReceiptDoc`.
   Also `PatientChart` (shared slide-over used by Doctor records and Staff directory; role-gated actions) and `EncounterCard`.
7. **Doctor portal** — Overview (KPIs, live queue, check-ins by hour, today's appts), `ConsultationWorkspace` (vitals, SOAP + templates, ICD-10, `MedicationBuilder`, disposition, draft autosave into the queue item, **Open chart** for the patient in the room), `RecordsSearch`, Messages, **Pharmacy and Billing** (the same components the staff use, passed `accent="teal"`), Accounts, and `DoctorSettings` (signature block + e-signature upload, prescription template, letterhead, clinic locations — with a live preview of the real document).
8. **Patient portal** — Dashboard (live queue position, follow-up reminders, next appt, teleconsult waiting room), `BookAppointment` (dept → doctor → date/slot → mode → complaint), `PatientRecords` (active/past Rx, simulated QR verification, downloadable summaries), Messages (doctors only).
9. **Staff portal** — `ReceptionQueue` (now-serving board, `CheckInForm` existing/new patient, priority toggle, status controller, appointment check-in), `PatientDirectory`, `Pharmacy` (restock, inline price edit, add item), `Billing` + `InvoiceEditor` (dispense toggles, lab presets, SC/PWD 20% discount, Cash/GCash/Maya/Card, change computation, stock deduction on payment), `FollowUpQueue`, Messages (doctors only), Accounts.
10. **App root** — context provider (store + act + toasts + print + role identities), offline outbox counter, `?portal=` deep links from the manifest shortcuts.

## Data flow (the important bit)
```
Staff check-in ──ADD_QUEUE──▶ queue[Waiting]
Doctor "Call in" ──UPDATE_QUEUE──▶ queue[In Consultation]  (draft autosaves to queue.draft)
Doctor "Complete & discharge" ──COMPLETE_CONSULT──▶ encounters[+1], invoices[+1 Pending], queue[Completed]
Staff "Receive payment & dispense" ──PAY_INVOICE──▶ invoice Paid, inventory stock −= dispensed qty

Doctor sets a follow-up date ──COMPLETE_CONSULT(followUpNotification)──▶ notifications[+1 Scheduled]
Staff "Send" in Follow-ups ──SEND_REMINDER──▶ notification Sent (simulated SMS)
Anyone sends a message ──SEND_MESSAGE──▶ threads[append | +1]  (pairing re-checked in the reducer)
```
- All mutations go through `act(action, { silent })` from context. When offline, non-silent actions increment a
  simulated outbox counter that "syncs" on reconnect. This is the seam for a real outbox.
- IDs are computed *outside* the reducer with `nextId(prefix, list)` so the reducer stays pure (StrictMode-safe).
- Senior Citizen discount is auto-suggested at age ≥ 60.

## Accounts (simulated auth — read this before trusting it)
Everyone signs in with **e-mail address or mobile number** (`matchesIdentifier` compares phone numbers
digits-only). The default password is `DEFAULT_PASSWORD` = **123456**; every seeded account carries
`mustChangePassword: true`, so `ForcePasswordChange` blocks the app until a different password of at
least `MIN_PASSWORD_LENGTH` is set. There is no self-service reset: the doctor or any staff member resets
an account from **Accounts**, which puts it back on the default and re-arms the forced change.

The session is the only thing kept outside the store, under `mediclinic:session` — localStorage when
"remember me" is ticked, sessionStorage when it is not. `role` comes from `user.kind`, so the old demo
role switcher is gone; the login screen lists demo accounts instead.

### Passwords are hashed, never stored
A chosen password is put through **PBKDF2-SHA256, 120k iterations, with a 16-byte per-user salt**
(`makePasswordRecord` / `verifyPassword`) and only `passwordHash` + `passwordSalt` are kept. An account
with **no hash is still on `DEFAULT_PASSWORD`** — that is how a new or reset account is represented, so
the default never has to be written to storage either. Sign-in hashes even when no account matched, so a
wrong username and a wrong password cost the same time. `crypto.subtle` needs a secure context: over
plain http on a LAN IP, hashing throws and says to use HTTPS rather than silently falling back.

**It is still not security.** There is no server, so anyone with the device can edit the store or the
session and promote themselves. What hashing buys is narrower and real: reading localStorage never hands
over a password the person may have reused somewhere that *does* matter. Real enforcement waits for
Supabase Auth + RLS (gap 1).

### What a user can actually see
Role guards are belt-and-braces, not the only defence: `PatientChart` and `AccountsPanel` return nothing
for a patient account even though neither is mounted in that portal. The patient portal is swept by the
`secure` suite, which asserts that **no other patient's name appears anywhere in its DOM** across every
view — the now-serving board deliberately shows a queue *number*, never a name.

The leak that remains is architectural: the whole store is one localStorage blob, so every signed-in
browser physically holds every patient's record. No amount of UI gating changes that. Only a backend with
row-level security does.

## Device notifications
Sent follow-up reminders and incoming messages raise a real system notification through
`registration.showNotification()`, and `sw.js` handles `notificationclick` to focus the app. The permission
is requested from the bell popover, which also offers a test notification.

**This is not web push.** There is no server and no VAPID subscription, so a notification can only be
raised while the app is running on that device — a backgrounded tab or an installed PWA counts, a closed
browser does not. Cross-device delivery (the real "notify the patient's phone") needs a push service;
until then, the cross-tab `storage` event is what carries a reminder sent by the front desk to a patient
tab open on the same machine. On iOS the app must be installed to the Home Screen first.
`DeviceNotifier` marks everything present at mount as seen, so a reload never replays the backlog.

## Messaging policy (don't loosen this by accident)
`MESSAGING_RULES` is the single source of truth: **doctor↔patient** and **doctor↔staff** are allowed,
**patient↔staff is not**. Clinical questions go patient→doctor; anything the front desk needs a patient to
know goes through the attending doctor or the phone. The rule is enforced in two places — the compose
recipient list is built from it, *and* `SEND_MESSAGE` re-checks it in the reducer, so a hand-crafted
dispatch can't create a forbidden thread. Threads are two-party only.

## Who can create accounts
Only the **doctor** can add staff (`ADD_STAFF`, which writes the staff record and the user account
together) — the button is not rendered for staff. Both the doctor and staff can *reset* a password, and
staff still register patients. Hiring is the doctor's call; the front desk's job is the desk.

## Registering a patient creates their account
`CheckInForm` in "New patient" mode dispatches `ADD_PATIENT` with both the patient *and* a `user`, so the
front desk never has a second step to forget. The username is whatever they captured — e-mail or mobile —
and the password is `DEFAULT_PASSWORD` with `mustChangePassword` set, so the patient is forced to choose
their own at first sign-in. The identifier is checked against every existing account first, because it is
the username: a clash is refused by name. After saving, the modal shows a credentials card for the desk to
read out; it stays up until dismissed rather than closing behind them.

## Finishing a consultation
`Complete & discharge` keeps the doctor on the Consultation tab — the empty state there *is* the waiting
list, so the next patient is one click away. When anyone else is waiting there is also
`Complete & call #N`, which discharges and calls the next patient straight in.
**Watch the closure:** `callIn` guards against starting a second consultation, but at hand-off time its
`inConsult` still holds the patient being discharged, so that path passes `{ force: true }`. Removing the
flag silently reintroduces "Finish the current consultation before calling in another patient."

## Amending a prescription
The doctor can edit an already-issued prescription from the chart's **Prescriptions** tab
(`PrescriptionEditor`, doctor-only). It reuses `MedicationBuilder`, so the allergy and stock checks that
apply during a consultation apply to a correction too. Saving writes `UPDATE_ENCOUNTER` with the new
`meds` plus `medsAmendedAt` / `medsAmendedBy`, and keeps the first-issued list in `medsOriginal` — an
issued prescription is never rewritten without a trace. The chart shows an "Amended" line and the printed
copy states that it supersedes the original. Save is disabled until something actually changes.

Everything reads the one `encounters` slice, so an amendment is immediately visible in the patient's own
records (with "Amended by your doctor on …"), in `EncounterCard` anywhere it appears, and on the same
chart opened from the staff portal — there is no copy to keep in step.

This is a stand-in for a real amendment trail: there is still no append-only audit log (gap 8), and
nothing stops a later edit overwriting `medsAmendedBy`.

## Clinic locations
A doctor may hold clinic at several sites. `doctor.locations[]` carries name, address, phone, room, days,
hours and fee, with exactly one `primary` — `primaryLocation()` supplies the room shown on the board and
the fee charged to walk-ins, `locationById()` resolves an appointment's site. Patients pick a location
when booking (the step only appears when there is more than one) and the appointment stores `locationId`;
teleconsults store none. Removing the primary promotes another, and the last location cannot be removed.
**Not yet per-site:** the queue, encounters and invoices have no location — a real multi-site build would
need the front desk to choose which clinic it is running.

## One doctor
The clinic has a single practitioner. Booking skips department and doctor and starts at the calendar,
check-in shows the attending doctor instead of a picker, and the reception board is one panel rather than
one column per room. `state.doctors` is still an array and `doctorId` still travels on encounters, queue
items and invoices, so adding a second doctor later is additive — but the UI assumes one and would need
the pickers back.

## Clinic logo
`clinic.logo` holds a data URL. Uploads go through `processLogoFile`: raster types only (PNG/JPEG/WebP,
max 5 MB), redrawn through a canvas at `LOGO_MAX_PX`, re-encoded (PNG, falling back to JPEG) and rejected
above `LOGO_MAX_CHARS` — the whole store is one localStorage string, so an unbounded image would break
persistence. Rasterizing also means an uploaded SVG could never reach the DOM. `ClinicMark` draws the logo
wherever the clinic is identified (documents, header, login) and falls back to the default cross.
A refused localStorage write now emits `mc-persist-error`, which the app surfaces once as a toast.

## Billing a medicine
The statement's **Add charges** has a `Medicine` tab (`MedicineChargePicker`): search the formulary,
see what is on the shelf, set a quantity, and the line is added flagged to dispense. Adding the same
medicine twice **tops up the existing line** instead of stacking duplicates the cashier has to
reconcile, and the availability figure subtracts what this statement already commits. Payment then
deducts exactly the dispensed quantity, as it always did.

## Formulary
108 stocked items across ~81 generics. A generic may have several variants (strength + form): Paracetamol
alone is tablet / syrup / drops / ampule. `MedicationBuilder` is therefore two-step — generic, then
strength-variant — and `routeForForm` sets the route from the chosen form. `WHOLE_PACK_UNITS` (bottle,
tube, vial, amp, pc, respule, sachet) suggest a quantity of 1 instead of `autoQty`'s doses x days.

## Conventions
- Currency `peso()` (en-PH, ₱). Dates: date-only fields are `YYYY-MM-DD` strings (`ymd`), timestamps are ISO.
- Generic drug names (R.A. 6675). Prescription signature block shows PRC, PTR and S2 numbers.
- Colors: teal = doctor/clinical, indigo = patient, sky = staff. Status tones live in `STATUS_TONE`.
- Never define components inside other components' render bodies (caused remount/focus loss once — fixed).
- Overlays share `useEscapeKey`/`escapeStack` so Escape closes only the topmost one. Any new overlay must
  use it rather than its own `keydown` listener, or it will close everything stacked beneath it.
- Keep `@media print` approach: anything printable must render through `PrintCenter` → `#print-root`.

## Known gaps / deliberately deferred
1. **Auth is simulated, not secure.** Sign-in, forced password change and resets all work, but passwords
   are plain text in localStorage and nothing is enforced server-side (see **Accounts**). Real build:
   Supabase Auth with roles (doctor, staff, patient) + RLS. No session expiry, lockout or audit of
   sign-ins either.
2. **No backend.** Everything is localStorage. Suggested: Supabase Postgres tables mirroring the state slices
   (`patients, doctors, encounters, encounter_meds, queue, appointments, inventory, invoices, invoice_items`), Realtime for the queue.
3. **Offline sync is simulated.** Replace the counter with a Dexie/IndexedDB outbox using `client_uuid` idempotency keys.
4. **BIR compliance.** Receipt is a billing statement / acknowledgement — no BIR-registered OR series, no CAS/POS accreditation fields, no VAT breakdown. SC/PWD handled as flat 20% of subtotal (real rules: VAT-exempt + 20%; verify OSCA/PWD ID, log ID numbers).
5. **Placeholders:** DOH LTO number (now editable in Settings → Letterhead, still not a real licence), clinic seal, e-signature (an uploaded image, not a cryptographic signature — nothing binds it to the document or proves who applied it), teleconsult links (`meet.mediclinic.ph` is fake), QR codes (`FakeQR` draws a deterministic pattern — swap for a real QR lib encoding a signed verification URL).
6. **Payments.** GCash/Maya/Card record the method and a reference number only — no gateway.
7. **Clinical safety.** Allergy check is keyword-based (`ALLERGY_RULES`), no drug–drug interaction database, ICD list is a short curated subset.
8. **Data Privacy Act (R.A. 10173).** No consent capture, audit log, or access logging yet — required before real patient data.
9. **Scheduling & reminders.** Doctor schedules are display-only; booking doesn't enforce clinic days. Follow-up reminders are raised and tracked in-app, but "Send" is a simulated SMS — no gateway, no delivery receipt. Messaging has no push notification, typing state, attachments or delivery/read receipts beyond the local `read` flag.
10. **No tests in the repo.** Recommended: Vitest for `reducer`, `invoiceTotals`, `autoQty`, `allergyFlags`, `canMessage`; Playwright for check-in → consult → billing and for the messaging policy.

## Suggested build order (next sessions)
1. Split `App.jsx` into `features/{doctor,patient,staff,print}` + `store/` + `lib/` (keep behavior identical; add Vitest first).
2. Supabase schema + RLS + Auth roles; replace `usePersistentStore` with a repository layer.
3. Dexie outbox with `client_uuid` for offline writes; Realtime subscription for queue.
4. Real QR + signed verification endpoint; e-signature capture for doctors.
5. BIR OR series + SC/PWD ID capture; GCash/Maya reference numbers or gateway.
6. Data Privacy Act consent + audit log.

## Gotchas
- `buildSeed()` compresses the queue's minutes-ago spread (`seedAgo`) so opening the app just after
  midnight doesn't anchor the board on *yesterday*, where `isToday` would hide it.
- Persisted state from an older day keeps old timestamps; the Overview only counts *today*. Use **Online badge → Reset demo** to reseed.
- Bump `SCHEMA_VERSION` whenever the state shape changes (old localStorage is discarded automatically).
- The SW is only registered in production builds; test PWA install/offline with `npm run build && npm run preview`.
