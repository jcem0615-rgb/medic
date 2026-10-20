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
3. **Store** — one pure `reducer` + `usePersistentStore` (localStorage key `mediclinic:v1`, `SCHEMA_VERSION`). Cross-tab sync via the `storage` event → open Staff and Doctor in two tabs to watch the queue move.
4. **PWA hooks & shell** — `useNetwork` (real + simulated offline), `useServiceWorkerState`, Header, LiveClock, PwaStatus popover (simulate offline, reset demo), InstallBanner (`beforeinstallprompt` + fallback hint), Toasts, SubNav.
4b. **Authentication** — `useSession` (localStorage when "remember me" is ticked, sessionStorage otherwise),
    `LoginScreen`, `ForcePasswordChange`, `AccountsPanel`. See **Accounts** below.
5. **UI primitives** — Badge/StatusBadge, SlideOver, Modal, StatCard, FakeQR, VitalsStrip, AllergyBadges, HourlyBars.
5b. **Messaging & notifications** — `MESSAGING_RULES` + `canMessage`, `threadsFor`/`unreadThreadCount`/`notificationsFor`/`dueReminders`, `NotificationBell` (header), `MessagesPanel` (shared inbox for all three portals), `PatientReminders`, `FollowUpQueue`.
6. **Print Center & documents** — `PrintCenter` renders a preview in a modal *and* portals a clean copy into `#print-root`; `@media print` hides `#root` and shows only `#print-root`, so multi-page docs paginate correctly. Documents: `MedicalCertificateDoc` (kind = certificate | abstract), `PrescriptionDoc`, `ReceiptDoc`.
   Also `PatientChart` (shared slide-over used by Doctor records and Staff directory; role-gated actions) and `EncounterCard`.
7. **Doctor portal** — Overview (KPIs, live queue, check-ins by hour, today's appts), `ConsultationWorkspace` (vitals, SOAP + templates, ICD-10, `MedicationBuilder`, disposition, draft autosave into the queue item, **Open chart** for the patient in the room), `RecordsSearch`, Messages, Accounts, and `DoctorSettings` (signature block, prescription template, letterhead — with a live preview of the real document).
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

**This is not security.** Passwords sit in localStorage in plain text, there is no hashing, no rate
limiting and no server to enforce any of it — a user can edit their own role in devtools. It is a
faithful *interface* for auth, standing in until Supabase Auth + RLS (gap 1).

## Messaging policy (don't loosen this by accident)
`MESSAGING_RULES` is the single source of truth: **doctor↔patient** and **doctor↔staff** are allowed,
**patient↔staff is not**. Clinical questions go patient→doctor; anything the front desk needs a patient to
know goes through the attending doctor or the phone. The rule is enforced in two places — the compose
recipient list is built from it, *and* `SEND_MESSAGE` re-checks it in the reducer, so a hand-crafted
dispatch can't create a forbidden thread. Threads are two-party only.

## One doctor
The clinic has a single practitioner. Booking skips department and doctor and starts at the calendar,
check-in shows the attending doctor instead of a picker, and the reception board is one panel rather than
one column per room. `state.doctors` is still an array and `doctorId` still travels on encounters, queue
items and invoices, so adding a second doctor later is additive — but the UI assumes one and would need
the pickers back.

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
5. **Placeholders:** DOH LTO number (now editable in Settings → Letterhead, still not a real licence), clinic seal, signatures (no e-signature capture), teleconsult links (`meet.mediclinic.ph` is fake), QR codes (`FakeQR` draws a deterministic pattern — swap for a real QR lib encoding a signed verification URL).
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
- Persisted state from an older day keeps old timestamps; the Overview only counts *today*. Use **Online badge → Reset demo** to reseed.
- Bump `SCHEMA_VERSION` whenever the state shape changes (old localStorage is discarded automatically).
- The SW is only registered in production builds; test PWA install/offline with `npm run build && npm run preview`.
