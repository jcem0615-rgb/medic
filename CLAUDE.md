# CLAUDE.md — MediClinic

Handoff notes for Claude Code. Read this first, then `src/App.jsx`.

## What this is
MediClinic is a Progressive Web App for a small Philippine outpatient clinic with three role portals —
**Doctor**, **Patient**, **Staff/Receptionist** — switchable from the header. Everything runs client-side
on seeded mock data; there is no backend yet.

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
2. **Seed data** — `buildSeed()`; 4 doctors, 10 patients, 17 inventory items, 14 encounters (SOAP + meds), invoices, 7 queue items, 5 appointments. Today's queue is anchored to *now* (`ago(mins)`) so the demo always looks live.
3. **Store** — one pure `reducer` + `usePersistentStore` (localStorage key `mediclinic:v1`, `SCHEMA_VERSION`). Cross-tab sync via the `storage` event → open Staff and Doctor in two tabs to watch the queue move.
4. **PWA hooks & shell** — `useNetwork` (real + simulated offline), `useServiceWorkerState`, Header, LiveClock, PwaStatus popover (simulate offline, reset demo), InstallBanner (`beforeinstallprompt` + fallback hint), Toasts, SubNav.
5. **UI primitives** — Badge/StatusBadge, SlideOver, Modal, StatCard, FakeQR, VitalsStrip, AllergyBadges, HourlyBars.
6. **Print Center & documents** — `PrintCenter` renders a preview in a modal *and* portals a clean copy into `#print-root`; `@media print` hides `#root` and shows only `#print-root`, so multi-page docs paginate correctly. Documents: `MedicalCertificateDoc` (kind = certificate | abstract), `PrescriptionDoc`, `ReceiptDoc`.
   Also `PatientChart` (shared slide-over used by Doctor records and Staff directory; role-gated actions) and `EncounterCard`.
7. **Doctor portal** — Overview (KPIs, live queue, check-ins by hour, today's appts), `ConsultationWorkspace` (vitals, SOAP + templates, ICD-10, `MedicationBuilder` with allergy + stock checks, disposition, draft autosave into the queue item), `RecordsSearch`.
8. **Patient portal** — Dashboard (live queue position, next appt, teleconsult waiting room), `BookAppointment` (dept → doctor → date/slot → mode → complaint), `PatientRecords` (active/past Rx, simulated QR verification, downloadable summaries).
9. **Staff portal** — `ReceptionQueue` (now-serving board, `CheckInForm` existing/new patient, priority toggle, status controller, appointment check-in), `PatientDirectory`, `Pharmacy` (restock, inline price edit, add item), `Billing` + `InvoiceEditor` (dispense toggles, lab presets, SC/PWD 20% discount, Cash/GCash/Maya/Card, change computation, stock deduction on payment).
10. **App root** — context provider (store + act + toasts + print + role identities), offline outbox counter, `?portal=` deep links from the manifest shortcuts.

## Data flow (the important bit)
```
Staff check-in ──ADD_QUEUE──▶ queue[Waiting]
Doctor "Call in" ──UPDATE_QUEUE──▶ queue[In Consultation]  (draft autosaves to queue.draft)
Doctor "Complete & discharge" ──COMPLETE_CONSULT──▶ encounters[+1], invoices[+1 Pending], queue[Completed]
Staff "Receive payment & dispense" ──PAY_INVOICE──▶ invoice Paid, inventory stock −= dispensed qty
```
- All mutations go through `act(action, { silent })` from context. When offline, non-silent actions increment a
  simulated outbox counter that "syncs" on reconnect. This is the seam for a real outbox.
- IDs are computed *outside* the reducer with `nextId(prefix, list)` so the reducer stays pure (StrictMode-safe).
- Senior Citizen discount is auto-suggested at age ≥ 60.

## Conventions
- Currency `peso()` (en-PH, ₱). Dates: date-only fields are `YYYY-MM-DD` strings (`ymd`), timestamps are ISO.
- Generic drug names (R.A. 6675). Prescription signature block shows PRC, PTR and S2 numbers.
- Colors: teal = doctor/clinical, indigo = patient, sky = staff. Status tones live in `STATUS_TONE`.
- Never define components inside other components' render bodies (caused remount/focus loss once — fixed).
- Keep `@media print` approach: anything printable must render through `PrintCenter` → `#print-root`.

## Known gaps / deliberately deferred
1. **No auth / RBAC.** Role switcher is a demo control. Real build: Supabase Auth with roles (doctor, staff, patient) + RLS.
2. **No backend.** Everything is localStorage. Suggested: Supabase Postgres tables mirroring the state slices
   (`patients, doctors, encounters, encounter_meds, queue, appointments, inventory, invoices, invoice_items`), Realtime for the queue.
3. **Offline sync is simulated.** Replace the counter with a Dexie/IndexedDB outbox using `client_uuid` idempotency keys.
4. **BIR compliance.** Receipt is a billing statement / acknowledgement — no BIR-registered OR series, no CAS/POS accreditation fields, no VAT breakdown. SC/PWD handled as flat 20% of subtotal (real rules: VAT-exempt + 20%; verify OSCA/PWD ID, log ID numbers).
5. **Placeholders:** DOH LTO number, clinic seal, signatures (no e-signature capture), teleconsult links (`meet.mediclinic.ph` is fake), QR codes (`FakeQR` draws a deterministic pattern — swap for a real QR lib encoding a signed verification URL).
6. **Payments.** GCash/Maya/Card record the method and a reference number only — no gateway.
7. **Clinical safety.** Allergy check is keyword-based (`ALLERGY_RULES`), no drug–drug interaction database, ICD list is a short curated subset.
8. **Data Privacy Act (R.A. 10173).** No consent capture, audit log, or access logging yet — required before real patient data.
9. **Scheduling.** Doctor schedules are display-only; booking doesn't enforce clinic days. No SMS reminders (text says "simulated").
10. **No tests.** Recommended: Vitest for `reducer`, `invoiceTotals`, `autoQty`, `allergyFlags`; Playwright for the check-in → consult → billing flow.

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
