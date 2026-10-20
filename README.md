# MediClinic

A Progressive Web App for a small Philippine outpatient clinic. One queue, three role portals —
**Doctor**, **Patient**, **Staff/Receptionist** — switchable from the header.

Everything runs client-side on seeded demo data held in `localStorage`. There is no backend and no
authentication yet, so **do not enter real patient information**.

## Quick start

```bash
npm install
npm run dev                        # http://localhost:5173
```

The service worker is only registered in production builds. To test install + offline behaviour:

```bash
npm run build && npm run preview   # http://localhost:4173
```

## What it does

| Portal | Screens |
|---|---|
| **Staff** | Now-serving board, check-in (existing or new patient, triage vitals, priority lane), queue status controller, patient directory, pharmacy stock, billing and payment collection |
| **Doctor** | Daily overview with KPIs and check-ins by hour, consultation workspace (vitals, SOAP with templates, ICD-10, prescribing with allergy + stock checks), records search |
| **Patient** | Live queue position, next appointment, teleconsult waiting room, appointment booking, prescriptions and visit history |

### The main flow

```
Staff check-in        → queue [Waiting]
Doctor "Call in"      → queue [In Consultation]   (the note autosaves as you type)
Doctor "Complete"     → encounter + pending statement, queue [Completed]
Staff "Receive payment" → statement Paid, dispensed stock deducted from the pharmacy
```

Open the app in **two tabs** — Staff in one, Doctor in the other — and the queue moves in both: state
syncs across tabs through the `storage` event.

## Things worth trying

- **Reset demo** — click the *Online* badge in the header. Today's queue is re-anchored to the current
  time, so the board always looks live.
- **Simulate offline** — same popover. Changes queue in a counter and "sync" when you come back online.
- **Allergy checks** — prescribe Amoxicillin for Juan Miguel Reyes (penicillin allergy) and the builder
  blocks you until you acknowledge it. Cephalosporins raise a softer cross-reactivity warning.
- **Senior Citizen discount** — bill Andres Lim or Teresita Gonzales; the 20% discount is suggested
  automatically at age 60+.
- **Stock gating** — Salbutamol MDI is seeded out of stock, Azithromycin low. Billing won't let you
  dispense what the shelf cannot cover.
- **Printing** — prescriptions, medical certificates, medical abstracts and billing statements all print
  on the clinic letterhead. Use the print dialog to save as PDF.

## Stack

React 18, Vite 5, Tailwind CSS 3, lucide-react. The app is a single `src/App.jsx` by design, divided
into numbered sections. See [CLAUDE.md](./CLAUDE.md) for the architecture, data flow, conventions and
the list of deliberately deferred work (auth, backend, BIR-registered receipts, Data Privacy Act
consent and audit logging).

## Compliance status

This is a demo build. Several things a production Philippine clinic system needs are **not** done yet:
BIR-registered Official Receipts (the receipt here is a billing statement / acknowledgement),
Data Privacy Act (R.A. 10173) consent capture and audit logging, role-based access control, and
e-signature capture. SC/PWD discounts are applied as a flat 20% of subtotal rather than the real
VAT-exempt + 20% computation. CLAUDE.md tracks each gap.
