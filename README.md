# MediClinic

A Progressive Web App for a single-doctor Philippine outpatient clinic. One queue, three role portals —
**Doctor**, **Patient**, **Staff/Receptionist** — reached by signing in with the matching account.

Everything runs client-side on seeded demo data held in `localStorage`. There is no backend, and the
sign-in is a faithful *interface* for authentication rather than real security — passwords are stored in
the browser in plain text. **Do not enter real patient information.**

## Signing in

Sign in with an **e-mail address or mobile number**. The default password for every seeded account is
`123456`, and you will be asked to choose a new one before you can go any further.

| Role | Sign in as |
|---|---|
| Doctor | `dr.santos@mediclinic.ph` |
| Staff | `imelda.cruz@mediclinic.ph` |
| Patient | `jm.reyes@email.ph` |

The login screen lists these under *Show demo accounts*. Forgot a password? There is no self-service
reset — the doctor or the front desk resets it from **Accounts**, which puts it back to `123456` and
forces a change at the next sign-in.

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
| **Staff** | Now-serving board (one panel for the clinic), check-in (existing or new patient, triage vitals, priority lane), queue status controller, patient directory, pharmacy stock, billing and payment collection, follow-up chase list, messages |
| **Doctor** | Daily overview with KPIs and check-ins by hour, consultation workspace (vitals, SOAP with templates, 161-code ICD-10 picker, prescribing with allergy + stock checks, patient chart on hand, hand straight to the next patient), records search, messages, pharmacy, billing, accounts, and settings for the signature block, e-signature, prescription template, letterhead and clinic locations |
| **Patient** | Live queue position, follow-up reminders, next appointment, teleconsult waiting room, appointment booking, prescriptions and visit history, messages to their doctors |

### The main flow

```
Staff check-in        → queue [Waiting]
Doctor "Call in"      → queue [In Consultation]   (the note autosaves as you type)
Doctor "Complete"     → encounter + pending statement, queue [Completed]
Staff "Receive payment" → statement Paid, dispensed stock deducted from the pharmacy
```

### Follow-ups and messaging

Setting a follow-up date on a consultation note raises the patient's reminder automatically. The patient
sees it on their dashboard and in the bell; the front desk sees it in **Follow-ups** once it is within a
week of being due, and can send it (a simulated SMS).

Messaging is deliberately restricted: **doctor↔patient** and **doctor↔staff** only. A patient and a
front-desk clerk never share a thread — clinical questions go to the doctor, and anything administrative
reaches the patient through their attending doctor or the phone. The rule lives in `MESSAGING_RULES` and
is enforced both in the compose list and in the reducer.

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
- **Variants** — prescribe Paracetamol and the second dropdown offers tablet, syrup, drops and ampule;
  pick a nebule and the route switches to Nebulization, pick a bottle and the quantity defaults to 1.
- **Reminders** — as Staff, open *Follow-ups*: Teresita Gonzales is overdue, Rowena Castillo is due in
  two days. Send one and switch to that patient to see it marked.
- **Prescription template** — as the Doctor, open *Settings*: edit your PRC number or switch off the
  allergies box and watch the real document redraw beside you.
- **Password reset** — as the Doctor or Staff, open *Accounts* and reset a patient. Sign in as them with
  `123456` and the forced-change window appears.
- **Clinic logo** — Doctor → *Settings* → *Letterhead* → upload a PNG. It appears on the header, the
  login screen and every printed document.
- **Several clinics** — the doctor holds clinic at two sites out of the box. Add a third in *Settings*,
  then book as a patient: the location picker appears and the address shows on the dashboard.
- **Device notifications** — open the bell, turn them on, then (in another tab as Staff) send a follow-up
  reminder or a message. A real system notification pops up. It only works while the app is open on that
  device — there is no push server.
- **Amend a prescription** — as the Doctor, open a patient's chart → *Prescriptions* → *Edit*. Change a
  course or add a medicine; the chart and the printed copy both record that it was amended, and the
  originally issued list is kept.
- **Register a patient** — as Staff, check in a *New patient*. Their account is created in the same step;
  the card that appears hands you the username and temporary password to read out.
- **Next patient** — as the Doctor, finish a consultation with *Complete & call #N* to discharge and call
  the next one in without leaving the workspace.
- **E-signature** — Doctor → *Settings* → *My details* → upload a signature. It prints on the line of
  every document.
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
