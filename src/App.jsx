/* MediClinic — single-file app by design (see CLAUDE.md).
   Sections are marked `// ===== N.` and match the file map in the handoff notes.
   Three role portals (Doctor / Patient / Staff) over one seeded client-side store. */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Banknote, Bell, BellRing, Boxes,
  Calendar, CalendarClock, CalendarPlus, CheckCircle2, ChevronDown, ChevronRight, ClipboardList,
  Clock, CloudOff, CreditCard, Download, FileText, FlaskConical, Heart, Home, Hospital, Info,
  LayoutGrid, LogIn, LogOut, Mail, MapPin, MessageSquare, Minus, Monitor, Package, PackagePlus,
  PhilippinePeso, Phone, Pill, Plus, Printer, QrCode, RefreshCw, Search, Send, Settings2, Share2,
  ShieldCheck, Smartphone, Stethoscope, Syringe, Thermometer, Trash2, TrendingUp, Upload, User, UserPlus,
  Users, Video, Wallet, Wifi, WifiOff, X, Zap,
} from 'lucide-react';

/* ===== 1. Constants & utilities ================================================= */

const STORE_KEY = 'mediclinic:v1';
/* Bump whenever the state shape changes — older persisted state is discarded. */
const SCHEMA_VERSION = 6;

const CLINIC = {
  name: 'MediClinic Family Health Center',
  tagline: 'Family Medicine · Pediatrics · Internal Medicine · Diagnostics',
  address: '2F Sampaguita Bldg., 128 Katipunan Ave., Brgy. San Roque, Quezon City 1109',
  phone: '(02) 8712-4455',
  mobile: '0917 812 4455',
  email: 'frontdesk@mediclinic.ph',
  website: 'mediclinic.ph',
  tin: '009-421-776-000',
  lto: 'DOH-LTO-NCR-2024-00812', // placeholder — not a real licence number
  hours: 'Mon–Sat · 8:00 AM – 5:00 PM',
};

const ROLES = [
  { id: 'doctor', label: 'Doctor', icon: Stethoscope, tone: 'teal' },
  { id: 'patient', label: 'Patient', icon: Heart, tone: 'indigo' },
  { id: 'staff', label: 'Staff', icon: ClipboardList, tone: 'sky' },
];

/* Role accent classes. Tailwind needs whole class names, so they are spelled out. */
const ROLE_THEME = {
  doctor: {
    text: 'text-teal-700', bg: 'bg-teal-600', bgSoft: 'bg-teal-50', border: 'border-teal-200',
    ring: 'ring-teal-500', btn: 'btn-primary', hover: 'hover:bg-teal-700', accent: 'teal',
  },
  patient: {
    text: 'text-indigo-700', bg: 'bg-indigo-600', bgSoft: 'bg-indigo-50', border: 'border-indigo-200',
    ring: 'ring-indigo-500', btn: 'btn-indigo', hover: 'hover:bg-indigo-700', accent: 'indigo',
  },
  staff: {
    text: 'text-sky-700', bg: 'bg-sky-600', bgSoft: 'bg-sky-50', border: 'border-sky-200',
    ring: 'ring-sky-500', btn: 'btn-sky', hover: 'hover:bg-sky-700', accent: 'sky',
  },
};

const STATUS_TONE = {
  Waiting: 'bg-amber-100 text-amber-800',
  'In Consultation': 'bg-teal-100 text-teal-800',
  Completed: 'bg-slate-100 text-slate-600',
  Cancelled: 'bg-rose-100 text-rose-700',
  Paid: 'bg-emerald-100 text-emerald-700',
  Pending: 'bg-amber-100 text-amber-800',
  Void: 'bg-slate-100 text-slate-500',
  Confirmed: 'bg-indigo-100 text-indigo-700',
  Booked: 'bg-indigo-100 text-indigo-700',
  'Checked In': 'bg-sky-100 text-sky-700',
  'No Show': 'bg-rose-100 text-rose-700',
  Active: 'bg-emerald-100 text-emerald-700',
  Expired: 'bg-slate-100 text-slate-500',
  'In Stock': 'bg-emerald-100 text-emerald-700',
  'Low Stock': 'bg-amber-100 text-amber-800',
  'Out of Stock': 'bg-rose-100 text-rose-700',
};

const DEPARTMENTS = [
  { id: 'family', label: 'Family Medicine' },
  { id: 'internal', label: 'Internal Medicine' },
  { id: 'pedia', label: 'Pediatrics' },
  { id: 'obgyn', label: 'OB-GYN' },
];

/* --- Accounts ------------------------------------------------------------------
   Everyone signs in with their e-mail address or mobile number. New accounts (and
   any the clinic resets) carry this password and must change it on first sign-in.
   Credentials are held in localStorage in plain text — a stand-in for real auth
   (CLAUDE.md gap 1), never something to point at real patient data. */
const DEFAULT_PASSWORD = '123456';
const SESSION_KEY = 'mediclinic:session';
const MIN_PASSWORD_LENGTH = 6;

/* Phone numbers are typed every which way, so compare them digits-only. */
const normalizeIdentifier = (value = '') => {
  const v = String(value).trim().toLowerCase();
  return v.includes('@') ? v : v.replace(/[^0-9]/g, '');
};

const matchesIdentifier = (user, identifier) => {
  const id = normalizeIdentifier(identifier);
  if (!id) return false;
  return normalizeIdentifier(user.email) === id || normalizeIdentifier(user.mobile) === id;
};

/* --- Messaging policy ----------------------------------------------------------
   Who may open a thread with whom. Patients and front-desk staff deliberately have
   NO direct channel: clinical questions go patient→doctor, and anything the desk
   needs to tell a patient goes through the attending doctor or the phone. The rule
   is enforced in the reducer as well as the UI, so a crafted action can't bypass it. */
const MESSAGING_RULES = {
  doctor: ['patient', 'staff'],
  patient: ['doctor'],
  staff: ['doctor'],
};

const canMessage = (fromKind, toKind) => (MESSAGING_RULES[fromKind] ?? []).includes(toKind);

/* A participant is addressed as `${kind}:${id}` wherever a flat key is handy. */
const partyKey = (party) => (party ? `${party.kind}:${party.id}` : '');
const samePartyAs = (a, b) => partyKey(a) === partyKey(b);

const NOTIFICATION_KINDS = {
  'follow-up': { label: 'Follow-up', icon: CalendarClock, tone: 'bg-indigo-100 text-indigo-700' },
  appointment: { label: 'Appointment', icon: Calendar, tone: 'bg-sky-100 text-sky-700' },
  message: { label: 'Message', icon: MessageSquare, tone: 'bg-teal-100 text-teal-700' },
  billing: { label: 'Billing', icon: PhilippinePeso, tone: 'bg-amber-100 text-amber-800' },
  prescription: { label: 'Prescription', icon: Pill, tone: 'bg-emerald-100 text-emerald-700' },
};

/* How far ahead of the due date a follow-up reminder starts showing up. */
const REMINDER_LEAD_DAYS = 7;
const daysUntil = (date) =>
  Math.ceil((parseYmd(date).getTime() - parseYmd(ymd()).getTime()) / 86400000);

/* Dosing frequencies. `perDay` drives autoQty; PRN can't be computed so it is 0. */
const FREQUENCIES = [
  { code: 'OD', label: 'Once daily', sig: 'once a day', perDay: 1 },
  { code: 'BID', label: 'Twice daily', sig: 'twice a day', perDay: 2 },
  { code: 'TID', label: 'Three times daily', sig: 'three times a day', perDay: 3 },
  { code: 'QID', label: 'Four times daily', sig: 'four times a day', perDay: 4 },
  { code: 'Q4H', label: 'Every 4 hours', sig: 'every 4 hours', perDay: 6 },
  { code: 'Q6H', label: 'Every 6 hours', sig: 'every 6 hours', perDay: 4 },
  { code: 'Q8H', label: 'Every 8 hours', sig: 'every 8 hours', perDay: 3 },
  { code: 'Q12H', label: 'Every 12 hours', sig: 'every 12 hours', perDay: 2 },
  { code: 'HS', label: 'At bedtime', sig: 'at bedtime', perDay: 1 },
  { code: 'PRN', label: 'As needed', sig: 'as needed', perDay: 0 },
];

const ROUTES = ['PO', 'IM', 'IV', 'SC', 'Topical', 'Inhalation', 'Nebulization', 'Ophthalmic', 'Otic'];

/* WHO ICD-10 codes grouped by chapter, as used on PhilHealth claim forms.
   Still a working subset for outpatient family practice rather than the full
   classification — the picker scrolls the whole list and searches code or term. */
const ICD10 = [
  // Certain infectious and parasitic diseases
  { code: 'A01.0', label: 'Typhoid fever', group: 'Infectious' },
  { code: 'A08.4', label: 'Viral intestinal infection, unspecified', group: 'Infectious' },
  { code: 'A09', label: 'Gastroenteritis and colitis, presumed infectious', group: 'Infectious' },
  { code: 'A15.0', label: 'Pulmonary tuberculosis, confirmed', group: 'Infectious' },
  { code: 'A16.2', label: 'Pulmonary tuberculosis, clinically diagnosed', group: 'Infectious' },
  { code: 'A49.9', label: 'Bacterial infection, unspecified', group: 'Infectious' },
  { code: 'A90', label: 'Dengue fever (classical dengue)', group: 'Infectious' },
  { code: 'A91', label: 'Dengue haemorrhagic fever', group: 'Infectious' },
  { code: 'B01.9', label: 'Varicella (chickenpox) without complication', group: 'Infectious' },
  { code: 'B05.9', label: 'Measles without complication', group: 'Infectious' },
  { code: 'B19.9', label: 'Viral hepatitis, unspecified', group: 'Infectious' },
  { code: 'B26.9', label: 'Mumps without complication', group: 'Infectious' },
  { code: 'B34.9', label: 'Viral infection, unspecified', group: 'Infectious' },
  { code: 'B35.3', label: 'Tinea pedis (athlete’s foot)', group: 'Infectious' },
  { code: 'B35.4', label: 'Tinea corporis', group: 'Infectious' },
  { code: 'B37.3', label: 'Candidiasis of vulva and vagina', group: 'Infectious' },
  { code: 'B37.9', label: 'Candidiasis, unspecified', group: 'Infectious' },
  { code: 'B86', label: 'Scabies', group: 'Infectious' },
  { code: 'U07.1', label: 'COVID-19, virus identified', group: 'Infectious' },

  // Blood and immune
  { code: 'D50.9', label: 'Iron deficiency anaemia, unspecified', group: 'Blood' },
  { code: 'D64.9', label: 'Anaemia, unspecified', group: 'Blood' },

  // Endocrine, nutritional and metabolic
  { code: 'E03.9', label: 'Hypothyroidism, unspecified', group: 'Endocrine & metabolic' },
  { code: 'E05.9', label: 'Thyrotoxicosis, unspecified', group: 'Endocrine & metabolic' },
  { code: 'E10.9', label: 'Type 1 diabetes mellitus without complications', group: 'Endocrine & metabolic' },
  { code: 'E11.9', label: 'Type 2 diabetes mellitus without complications', group: 'Endocrine & metabolic' },
  { code: 'E11.6', label: 'Type 2 diabetes mellitus with other specified complications', group: 'Endocrine & metabolic' },
  { code: 'E16.2', label: 'Hypoglycaemia, unspecified', group: 'Endocrine & metabolic' },
  { code: 'E44.1', label: 'Mild protein-energy malnutrition', group: 'Endocrine & metabolic' },
  { code: 'E55.9', label: 'Vitamin D deficiency, unspecified', group: 'Endocrine & metabolic' },
  { code: 'E66.9', label: 'Obesity, unspecified', group: 'Endocrine & metabolic' },
  { code: 'E78.0', label: 'Pure hypercholesterolaemia', group: 'Endocrine & metabolic' },
  { code: 'E78.5', label: 'Hyperlipidaemia, unspecified', group: 'Endocrine & metabolic' },
  { code: 'E79.0', label: 'Hyperuricaemia without arthritis or tophi', group: 'Endocrine & metabolic' },
  { code: 'E86', label: 'Volume depletion (dehydration)', group: 'Endocrine & metabolic' },
  { code: 'E87.6', label: 'Hypokalaemia', group: 'Endocrine & metabolic' },

  // Mental and behavioural
  { code: 'F32.9', label: 'Depressive episode, unspecified', group: 'Mental health' },
  { code: 'F41.1', label: 'Generalized anxiety disorder', group: 'Mental health' },
  { code: 'F41.9', label: 'Anxiety disorder, unspecified', group: 'Mental health' },
  { code: 'F43.2', label: 'Adjustment disorder', group: 'Mental health' },
  { code: 'F51.0', label: 'Nonorganic insomnia', group: 'Mental health' },

  // Nervous system
  { code: 'G40.9', label: 'Epilepsy, unspecified', group: 'Nervous system' },
  { code: 'G43.9', label: 'Migraine, unspecified', group: 'Nervous system' },
  { code: 'G44.2', label: 'Tension-type headache', group: 'Nervous system' },
  { code: 'G47.0', label: 'Disorders of initiating and maintaining sleep', group: 'Nervous system' },
  { code: 'G51.0', label: 'Bell palsy', group: 'Nervous system' },
  { code: 'G56.0', label: 'Carpal tunnel syndrome', group: 'Nervous system' },
  { code: 'G62.9', label: 'Polyneuropathy, unspecified', group: 'Nervous system' },

  // Eye and ear
  { code: 'H10.9', label: 'Conjunctivitis, unspecified', group: 'Eye & ear' },
  { code: 'H25.9', label: 'Senile cataract, unspecified', group: 'Eye & ear' },
  { code: 'H40.9', label: 'Glaucoma, unspecified', group: 'Eye & ear' },
  { code: 'H52.4', label: 'Presbyopia', group: 'Eye & ear' },
  { code: 'H60.9', label: 'Otitis externa, unspecified', group: 'Eye & ear' },
  { code: 'H61.2', label: 'Impacted cerumen', group: 'Eye & ear' },
  { code: 'H65.9', label: 'Nonsuppurative otitis media, unspecified', group: 'Eye & ear' },
  { code: 'H66.9', label: 'Otitis media, unspecified', group: 'Eye & ear' },
  { code: 'H81.1', label: 'Benign paroxysmal vertigo', group: 'Eye & ear' },
  { code: 'H91.9', label: 'Hearing loss, unspecified', group: 'Eye & ear' },

  // Circulatory
  { code: 'I10', label: 'Essential (primary) hypertension', group: 'Circulatory' },
  { code: 'I11.9', label: 'Hypertensive heart disease without heart failure', group: 'Circulatory' },
  { code: 'I20.9', label: 'Angina pectoris, unspecified', group: 'Circulatory' },
  { code: 'I21.9', label: 'Acute myocardial infarction, unspecified', group: 'Circulatory' },
  { code: 'I25.9', label: 'Chronic ischaemic heart disease, unspecified', group: 'Circulatory' },
  { code: 'I48', label: 'Atrial fibrillation and flutter', group: 'Circulatory' },
  { code: 'I50.9', label: 'Heart failure, unspecified', group: 'Circulatory' },
  { code: 'I63.9', label: 'Cerebral infarction, unspecified', group: 'Circulatory' },
  { code: 'I83.9', label: 'Varicose veins of lower extremities', group: 'Circulatory' },
  { code: 'I95.9', label: 'Hypotension, unspecified', group: 'Circulatory' },

  // Respiratory
  { code: 'J00', label: 'Acute nasopharyngitis (common cold)', group: 'Respiratory' },
  { code: 'J01.9', label: 'Acute sinusitis, unspecified', group: 'Respiratory' },
  { code: 'J02.9', label: 'Acute pharyngitis, unspecified', group: 'Respiratory' },
  { code: 'J03.9', label: 'Acute tonsillitis, unspecified', group: 'Respiratory' },
  { code: 'J04.0', label: 'Acute laryngitis', group: 'Respiratory' },
  { code: 'J06.9', label: 'Acute upper respiratory infection, unspecified', group: 'Respiratory' },
  { code: 'J11.1', label: 'Influenza with other respiratory manifestations', group: 'Respiratory' },
  { code: 'J18.9', label: 'Pneumonia, unspecified', group: 'Respiratory' },
  { code: 'J20.9', label: 'Acute bronchitis, unspecified', group: 'Respiratory' },
  { code: 'J21.9', label: 'Acute bronchiolitis, unspecified', group: 'Respiratory' },
  { code: 'J30.4', label: 'Allergic rhinitis, unspecified', group: 'Respiratory' },
  { code: 'J32.9', label: 'Chronic sinusitis, unspecified', group: 'Respiratory' },
  { code: 'J35.0', label: 'Chronic tonsillitis', group: 'Respiratory' },
  { code: 'J42', label: 'Unspecified chronic bronchitis', group: 'Respiratory' },
  { code: 'J44.9', label: 'Chronic obstructive pulmonary disease, unspecified', group: 'Respiratory' },
  { code: 'J45.0', label: 'Predominantly allergic asthma', group: 'Respiratory' },
  { code: 'J45.9', label: 'Asthma, unspecified', group: 'Respiratory' },
  { code: 'J47', label: 'Bronchiectasis', group: 'Respiratory' },

  // Digestive
  { code: 'K21.0', label: 'Gastro-oesophageal reflux disease with oesophagitis', group: 'Digestive' },
  { code: 'K21.9', label: 'Gastro-oesophageal reflux disease without oesophagitis', group: 'Digestive' },
  { code: 'K25.9', label: 'Gastric ulcer, unspecified', group: 'Digestive' },
  { code: 'K29.7', label: 'Gastritis, unspecified', group: 'Digestive' },
  { code: 'K30', label: 'Functional dyspepsia', group: 'Digestive' },
  { code: 'K40.9', label: 'Inguinal hernia without obstruction or gangrene', group: 'Digestive' },
  { code: 'K52.9', label: 'Noninfective gastroenteritis and colitis', group: 'Digestive' },
  { code: 'K58.9', label: 'Irritable bowel syndrome without diarrhoea', group: 'Digestive' },
  { code: 'K59.0', label: 'Constipation', group: 'Digestive' },
  { code: 'K64.9', label: 'Haemorrhoids, unspecified', group: 'Digestive' },
  { code: 'K76.0', label: 'Fatty (change of) liver, not elsewhere classified', group: 'Digestive' },
  { code: 'K80.2', label: 'Calculus of gallbladder without cholecystitis', group: 'Digestive' },
  { code: 'K92.2', label: 'Gastrointestinal haemorrhage, unspecified', group: 'Digestive' },

  // Skin
  { code: 'L01.0', label: 'Impetigo', group: 'Skin' },
  { code: 'L02.9', label: 'Cutaneous abscess, furuncle and carbuncle', group: 'Skin' },
  { code: 'L03.9', label: 'Cellulitis, unspecified', group: 'Skin' },
  { code: 'L20.9', label: 'Atopic dermatitis, unspecified', group: 'Skin' },
  { code: 'L23.9', label: 'Allergic contact dermatitis, unspecified cause', group: 'Skin' },
  { code: 'L29.9', label: 'Pruritus, unspecified', group: 'Skin' },
  { code: 'L30.9', label: 'Dermatitis, unspecified', group: 'Skin' },
  { code: 'L40.9', label: 'Psoriasis, unspecified', group: 'Skin' },
  { code: 'L50.9', label: 'Urticaria, unspecified', group: 'Skin' },
  { code: 'L70.0', label: 'Acne vulgaris', group: 'Skin' },

  // Musculoskeletal
  { code: 'M06.9', label: 'Rheumatoid arthritis, unspecified', group: 'Musculoskeletal' },
  { code: 'M10.9', label: 'Gout, unspecified', group: 'Musculoskeletal' },
  { code: 'M15.9', label: 'Polyarthrosis, unspecified', group: 'Musculoskeletal' },
  { code: 'M17.9', label: 'Gonarthrosis (osteoarthritis of knee), unspecified', group: 'Musculoskeletal' },
  { code: 'M19.9', label: 'Arthrosis, unspecified', group: 'Musculoskeletal' },
  { code: 'M25.5', label: 'Pain in joint', group: 'Musculoskeletal' },
  { code: 'M54.2', label: 'Cervicalgia (neck pain)', group: 'Musculoskeletal' },
  { code: 'M54.5', label: 'Low back pain', group: 'Musculoskeletal' },
  { code: 'M54.9', label: 'Dorsalgia, unspecified', group: 'Musculoskeletal' },
  { code: 'M75.0', label: 'Adhesive capsulitis of shoulder', group: 'Musculoskeletal' },
  { code: 'M79.1', label: 'Myalgia', group: 'Musculoskeletal' },

  // Genitourinary
  { code: 'N10', label: 'Acute tubulo-interstitial nephritis (pyelonephritis)', group: 'Genitourinary' },
  { code: 'N18.9', label: 'Chronic kidney disease, unspecified', group: 'Genitourinary' },
  { code: 'N20.0', label: 'Calculus of kidney', group: 'Genitourinary' },
  { code: 'N30.0', label: 'Acute cystitis', group: 'Genitourinary' },
  { code: 'N39.0', label: 'Urinary tract infection, site not specified', group: 'Genitourinary' },
  { code: 'N40', label: 'Hyperplasia of prostate', group: 'Genitourinary' },
  { code: 'N76.0', label: 'Acute vaginitis', group: 'Genitourinary' },
  { code: 'N91.2', label: 'Amenorrhoea, unspecified', group: 'Genitourinary' },
  { code: 'N92.0', label: 'Excessive and frequent menstruation', group: 'Genitourinary' },
  { code: 'N94.6', label: 'Dysmenorrhoea, unspecified', group: 'Genitourinary' },

  // Pregnancy
  { code: 'O21.0', label: 'Mild hyperemesis gravidarum', group: 'Pregnancy' },
  { code: 'O23.4', label: 'Unspecified urinary tract infection in pregnancy', group: 'Pregnancy' },

  // Symptoms and signs
  { code: 'R05', label: 'Cough', group: 'Symptoms & signs' },
  { code: 'R06.0', label: 'Dyspnoea', group: 'Symptoms & signs' },
  { code: 'R07.4', label: 'Chest pain, unspecified', group: 'Symptoms & signs' },
  { code: 'R10.1', label: 'Pain localized to upper abdomen', group: 'Symptoms & signs' },
  { code: 'R10.4', label: 'Other and unspecified abdominal pain', group: 'Symptoms & signs' },
  { code: 'R11', label: 'Nausea and vomiting', group: 'Symptoms & signs' },
  { code: 'R21', label: 'Rash and other nonspecific skin eruption', group: 'Symptoms & signs' },
  { code: 'R35', label: 'Polyuria', group: 'Symptoms & signs' },
  { code: 'R42', label: 'Dizziness and giddiness', group: 'Symptoms & signs' },
  { code: 'R50.9', label: 'Fever, unspecified', group: 'Symptoms & signs' },
  { code: 'R51', label: 'Headache', group: 'Symptoms & signs' },
  { code: 'R53', label: 'Malaise and fatigue', group: 'Symptoms & signs' },
  { code: 'R55', label: 'Syncope and collapse', group: 'Symptoms & signs' },
  { code: 'R60.0', label: 'Localized oedema', group: 'Symptoms & signs' },
  { code: 'R63.4', label: 'Abnormal weight loss', group: 'Symptoms & signs' },

  // Injury and external causes
  { code: 'T14.0', label: 'Superficial injury of unspecified body region', group: 'Injury' },
  { code: 'T14.1', label: 'Open wound of unspecified body region', group: 'Injury' },
  { code: 'T14.3', label: 'Dislocation, sprain and strain of unspecified body region', group: 'Injury' },
  { code: 'T30.0', label: 'Burn of unspecified body region, unspecified degree', group: 'Injury' },
  { code: 'T63.4', label: 'Venom of other arthropods (insect bite)', group: 'Injury' },
  { code: 'T78.4', label: 'Allergy, unspecified', group: 'Injury' },

  // Factors influencing health status
  { code: 'Z00.0', label: 'General medical examination', group: 'Health services' },
  { code: 'Z00.1', label: 'Routine child health examination', group: 'Health services' },
  { code: 'Z02.7', label: 'Issue of medical certificate', group: 'Health services' },
  { code: 'Z20.3', label: 'Contact with and exposure to rabies', group: 'Health services' },
  { code: 'Z23', label: 'Need for immunization against single bacterial disease', group: 'Health services' },
  { code: 'Z30.0', label: 'General counselling and advice on contraception', group: 'Health services' },
  { code: 'Z34.9', label: 'Supervision of normal pregnancy, unspecified', group: 'Health services' },
  { code: 'Z71.3', label: 'Dietary counselling and surveillance', group: 'Health services' },
  { code: 'Z76.0', label: 'Issue of repeat prescription', group: 'Health services' },
];

/* Chapter order for the grouped picker. */
const ICD10_GROUPS = [...new Set(ICD10.map((d) => d.group))];

/* Keyword-based allergy screening. No interaction database — see CLAUDE.md gaps. */
const ALLERGY_RULES = [
  {
    id: 'penicillin', match: ['penicillin', 'amoxicillin', 'co-amoxiclav', 'ampicillin'],
    drugs: ['amoxicillin', 'ampicillin', 'penicillin', 'co-amoxiclav', 'cloxacillin', 'piperacillin'],
    severity: 'high', note: 'Documented penicillin-class allergy.',
  },
  {
    id: 'penicillin-cross', match: ['penicillin', 'amoxicillin', 'co-amoxiclav'],
    drugs: ['cefalexin', 'cephalexin', 'cefuroxime', 'ceftriaxone', 'cefixime'],
    severity: 'caution', note: 'Possible cross-reactivity with cephalosporins (~1–3%).',
  },
  {
    id: 'cephalosporin', match: ['cephalosporin', 'cefalexin', 'cefuroxime', 'ceftriaxone'],
    drugs: ['cefalexin', 'cephalexin', 'cefuroxime', 'ceftriaxone', 'cefixime'],
    severity: 'high', note: 'Documented cephalosporin allergy.',
  },
  {
    id: 'sulfa', match: ['sulfa', 'sulfonamide', 'cotrimoxazole'],
    drugs: ['cotrimoxazole', 'sulfamethoxazole', 'trimethoprim'],
    severity: 'high', note: 'Documented sulfonamide allergy.',
  },
  {
    id: 'nsaid', match: ['nsaid', 'ibuprofen', 'mefenamic', 'diclofenac', 'naproxen'],
    drugs: ['ibuprofen', 'mefenamic', 'naproxen', 'diclofenac', 'celecoxib', 'ketorolac', 'aspirin'],
    severity: 'high', note: 'NSAID class — risk of bronchospasm / angioedema.',
  },
  {
    id: 'aspirin', match: ['aspirin', 'acetylsalicylic'],
    drugs: ['aspirin', 'acetylsalicylic'],
    severity: 'high', note: 'Documented aspirin allergy.',
  },
  {
    id: 'macrolide', match: ['macrolide', 'erythromycin', 'azithromycin', 'clarithromycin'],
    drugs: ['azithromycin', 'erythromycin', 'clarithromycin'],
    severity: 'high', note: 'Documented macrolide allergy.',
  },
  {
    id: 'paracetamol', match: ['paracetamol', 'acetaminophen'],
    drugs: ['paracetamol', 'acetaminophen'],
    severity: 'high', note: 'Documented paracetamol allergy.',
  },
];

/* Priced catalogues used by the invoice editor. */
const SERVICE_PRESETS = [
  { label: 'Consultation — new patient', price: 500 },
  { label: 'Consultation — follow-up', price: 350 },
  { label: 'Teleconsultation', price: 400 },
  { label: 'Nebulization (per session)', price: 250 },
  { label: 'Wound dressing', price: 300 },
  { label: 'Injection administration', price: 150 },
  { label: 'Medical certificate', price: 150 },
  { label: 'Medical abstract', price: 250 },
];

const LAB_PRESETS = [
  { label: 'CBC with platelet count', price: 350 },
  { label: 'Urinalysis', price: 180 },
  { label: 'Fecalysis', price: 180 },
  { label: 'Fasting blood sugar (FBS)', price: 150 },
  { label: 'Lipid profile', price: 650 },
  { label: 'HbA1c', price: 750 },
  { label: 'Creatinine', price: 250 },
  { label: 'SGPT / ALT', price: 280 },
  { label: 'Uric acid', price: 220 },
  { label: 'Chest X-ray (PA)', price: 450 },
  { label: '12-lead ECG', price: 400 },
  { label: 'Dengue NS1 antigen', price: 950 },
];

const PAYMENT_METHODS = [
  { id: 'Cash', icon: Banknote },
  { id: 'GCash', icon: Smartphone },
  { id: 'Maya', icon: Wallet },
  { id: 'Card', icon: CreditCard },
];

const VITALS_FIELDS = [
  { key: 'bp', label: 'BP', unit: 'mmHg', placeholder: '120/80', width: 'w-24' },
  { key: 'hr', label: 'HR', unit: 'bpm', placeholder: '78', width: 'w-20' },
  { key: 'rr', label: 'RR', unit: '/min', placeholder: '18', width: 'w-20' },
  { key: 'temp', label: 'Temp', unit: '°C', placeholder: '36.8', width: 'w-20' },
  { key: 'spo2', label: 'SpO₂', unit: '%', placeholder: '98', width: 'w-20' },
  { key: 'weight', label: 'Weight', unit: 'kg', placeholder: '62', width: 'w-20' },
  { key: 'height', label: 'Height', unit: 'cm', placeholder: '165', width: 'w-20' },
];

const SOAP_TEMPLATES = [
  {
    id: 'uri', label: 'Acute URI',
    s: 'Cough and colds x 3 days. Low-grade fever, sore throat. No dyspnea. No vomiting. Appetite fair.',
    o: 'Awake, ambulatory, not in distress. Pharyngeal congestion, no exudates. Clear breath sounds, no wheezes or crackles. CBS, no murmur. Abdomen soft, non-tender.',
    a: 'Acute upper respiratory tract infection, viral.',
    p: 'Symptomatic treatment. Increase oral fluid intake. Adequate rest. Return if fever persists beyond 3 days, difficulty of breathing, or poor intake.',
  },
  {
    id: 'htn', label: 'Hypertension follow-up',
    s: 'For BP follow-up. Compliant with maintenance medication. Denies chest pain, headache, blurring of vision, or dyspnea. Home BP readings 130–140/80–90.',
    o: 'Awake, not in distress. Clear breath sounds. CBS, no murmur. No bipedal edema.',
    a: 'Essential hypertension, controlled on current regimen.',
    p: 'Continue maintenance medication. Low-salt, low-fat diet. Regular exercise as tolerated. Home BP monitoring twice daily. Follow-up in 1 month with BP diary.',
  },
  {
    id: 'age', label: 'Acute gastroenteritis',
    s: 'Loose watery stools x 5 episodes since yesterday, non-bloody. Associated abdominal cramps. Able to tolerate oral intake. No fever.',
    o: 'Awake, hydrated, not in distress. Moist oral mucosa, good skin turgor. Abdomen soft, hyperactive bowel sounds, mild periumbilical tenderness, no guarding.',
    a: 'Acute gastroenteritis, no signs of dehydration.',
    p: 'Oral rehydration salts after every loose stool. Soft diet. Strict hydration. Return immediately for signs of dehydration, bloody stools, or persistent vomiting.',
  },
  {
    id: 'dm', label: 'Diabetes follow-up',
    s: 'For routine follow-up. Compliant with maintenance. Denies polyuria, polydipsia, blurring of vision, or numbness of extremities. Diet partially controlled.',
    o: 'Awake, not in distress. Clear breath sounds. CBS, no murmur. Feet: intact sensation, no ulcers, good pulses.',
    a: 'Type 2 diabetes mellitus — for repeat HbA1c.',
    p: 'Continue maintenance. Diabetic diet, portion control. Repeat FBS and HbA1c before next visit. Daily foot inspection. Follow-up in 3 months.',
  },
  {
    id: 'peds', label: 'Pediatric well-child',
    s: 'For routine check-up. No fever, cough, or colds. Good appetite and activity. Immunizations up to date.',
    o: 'Awake, active, playful, not in distress. Anterior fontanelle closed. Clear breath sounds. CBS, no murmur. Abdomen soft, non-tender. Full and equal pulses.',
    a: 'Well child — age-appropriate growth and development.',
    p: 'Age-appropriate diet. Continue vitamins. Immunizations as scheduled. Return for any fever, poor intake, or difficulty of breathing.',
  },
];

/* --- small helpers ------------------------------------------------------------- */

const cx = (...parts) => parts.filter(Boolean).join(' ');

const pesoFmt = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const peso = (n) => pesoFmt.format(Number.isFinite(Number(n)) ? Number(n) : 0);

/* date-only fields are 'YYYY-MM-DD' strings; timestamps are full ISO strings. */
const ymd = (d = new Date()) => {
  const dt = d instanceof Date ? d : new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};
const parseYmd = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const inDays = (days) => ymd(new Date(Date.now() + days * 86400000));
const minsSince = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true });
const fmtDate = (v) =>
  (v ? parseYmd(typeof v === 'string' && v.length === 10 ? v : ymd(v)) : new Date()).toLocaleDateString(
    'en-PH', { year: 'numeric', month: 'short', day: 'numeric' },
  );
const fmtLongDate = (v) =>
  (v ? parseYmd(typeof v === 'string' && v.length === 10 ? v : ymd(v)) : new Date()).toLocaleDateString(
    'en-PH', { year: 'numeric', month: 'long', day: 'numeric' },
  );
const fmtDateTime = (iso) => `${fmtDate(ymd(new Date(iso)))} · ${fmtTime(iso)}`;
const fmtDuration = (mins) => (mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`);

const isToday = (iso) => ymd(new Date(iso)) === ymd();

const ageFrom = (dob) => {
  const b = parseYmd(dob);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
};
/* Pediatric patients read better in months below 2 years. */
const ageLabel = (dob) => {
  const years = ageFrom(dob);
  if (years >= 2) return `${years} y/o`;
  const b = parseYmd(dob);
  const months = Math.max(0, (new Date().getFullYear() - b.getFullYear()) * 12 + new Date().getMonth() - b.getMonth());
  return `${months} mo`;
};

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

/* IDs are computed outside the reducer so the reducer stays pure (StrictMode-safe). */
const nextId = (prefix, list = []) => {
  const max = list.reduce((acc, row) => {
    const n = Number(String(row?.id ?? '').split('-').pop());
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
};

/* Quantity to dispense for a course: doses per day x days, rounded up. */
const autoQty = (freqCode, days) => {
  const freq = FREQUENCIES.find((f) => f.code === freqCode);
  const d = Number(days);
  if (!freq || !freq.perDay || !Number.isFinite(d) || d <= 0) return '';
  return Math.ceil(freq.perDay * d);
};

const invoiceTotals = (invoice) => {
  const items = invoice?.items ?? [];
  const subtotal = items.reduce((sum, it) => sum + Number(it.qty || 0) * Number(it.unitPrice || 0), 0);
  /* Flat 20% of subtotal. Real SC/PWD rules are VAT-exempt + 20% — see CLAUDE.md gap 4. */
  const discountRate = invoice?.discountType && invoice.discountType !== 'None' ? 0.2 : 0;
  const discount = Math.round(subtotal * discountRate * 100) / 100;
  const total = Math.round((subtotal - discount) * 100) / 100;
  const paid = Number(invoice?.amountPaid || 0);
  const balance = Math.round((total - (invoice?.status === 'Paid' ? total : paid)) * 100) / 100;
  return { subtotal, discount, total, paid, balance, discountRate };
};

const stockStatus = (item) => {
  const stock = Number(item?.stock || 0);
  if (stock <= 0) return 'Out of Stock';
  if (stock <= Number(item?.reorderLevel || 0)) return 'Low Stock';
  return 'In Stock';
};

/* A prescription is active until its course (date + days) runs out. */
const isRxActive = (med, encounterDate) => {
  const days = Number(med?.days || 0);
  if (!days) return false;
  const start = parseYmd(ymd(new Date(encounterDate)));
  const end = new Date(start.getTime() + days * 86400000);
  return end.getTime() >= Date.now();
};
const rxEndDate = (med, encounterDate) =>
  ymd(new Date(parseYmd(ymd(new Date(encounterDate))).getTime() + Number(med?.days || 0) * 86400000));

/* Keyword screen of one drug name against a patient's documented allergies. */
const allergyFlags = (patient, drugName) => {
  const name = String(drugName || '').toLowerCase();
  const allergies = (patient?.allergies ?? []).map((a) => String(a).toLowerCase());
  if (!name || !allergies.length) return [];
  const hits = [];
  for (const rule of ALLERGY_RULES) {
    const allergy = allergies.find((a) => rule.match.some((m) => a.includes(m)));
    if (!allergy) continue;
    if (!rule.drugs.some((d) => name.includes(d))) continue;
    if (hits.some((h) => h.severity === rule.severity && h.allergy === allergy)) continue;
    hits.push({ id: rule.id, allergy, severity: rule.severity, note: rule.note });
  }
  return hits;
};

const bmiOf = (vitals) => {
  const w = Number(vitals?.weight), h = Number(vitals?.height);
  if (!w || !h) return null;
  return Math.round((w / (h / 100) ** 2) * 10) / 10;
};

/* Systolic/diastolic read off a '120/80' string, for the flag on the vitals strip. */
const bpFlag = (bp) => {
  const m = String(bp || '').match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!m) return null;
  const [sys, dia] = [Number(m[1]), Number(m[2])];
  if (sys >= 180 || dia >= 120) return { tone: 'rose', label: 'Hypertensive crisis' };
  if (sys >= 140 || dia >= 90) return { tone: 'amber', label: 'Stage 2' };
  if (sys >= 130 || dia >= 80) return { tone: 'amber', label: 'Stage 1' };
  if (sys < 90 || dia < 60) return { tone: 'amber', label: 'Low' };
  return { tone: 'emerald', label: 'Normal' };
};

const tempFlag = (t) => {
  const v = Number(t);
  if (!v) return null;
  if (v >= 38) return { tone: 'rose', label: 'Febrile' };
  if (v >= 37.5) return { tone: 'amber', label: 'Low-grade' };
  return { tone: 'emerald', label: 'Afebrile' };
};

/* --- Clinic logo upload --------------------------------------------------------
   The whole store is persisted as one JSON string in localStorage, so an uploaded
   logo is rasterized through a canvas, scaled down and capped before it is stored.
   Rasterizing also means an SVG (which can carry script) never reaches the DOM —
   only raster types are accepted, and what we keep is canvas output, not the file. */
const LOGO_MAX_PX = 480;
const LOGO_MAX_CHARS = 300 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function processLogoFile(file) {
  if (!file) throw new Error('No file chosen.');
  if (!LOGO_TYPES.includes(file.type)) throw new Error('Use a PNG, JPEG or WebP image.');
  if (file.size > LOGO_MAX_UPLOAD_BYTES) throw new Error('That image is larger than 5 MB.');

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('That file is not a readable image.'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);

  /* PNG first so a transparent background survives; JPEG only if it is too heavy. */
  let out = canvas.toDataURL('image/png');
  if (out.length > LOGO_MAX_CHARS) out = canvas.toDataURL('image/jpeg', 0.85);
  if (out.length > LOGO_MAX_CHARS) {
    throw new Error('That image is too detailed to store. Try a smaller or simpler one.');
  }
  return { dataUrl: out, width, height };
}

/* A doctor may hold clinic at several sites. One is marked primary: it supplies
   the letterhead-adjacent details and the default fee for walk-ins. */
const primaryLocation = (doctor) =>
  (doctor?.locations ?? []).find((l) => l.primary) ?? doctor?.locations?.[0] ?? null;

const locationById = (doctor, id) =>
  (doctor?.locations ?? []).find((l) => l.id === id) ?? primaryLocation(doctor);

const SENIOR_AGE = 60;
const isSenior = (patient) => !!patient?.dob && ageFrom(patient.dob) >= SENIOR_AGE;

const TIME_SLOTS = [
  '08:00 AM', '08:30 AM', '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '01:00 PM', '01:30 PM', '02:00 PM', '02:30 PM',
  '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM',
];

/* ===== 2. Seed data ============================================================= */

/* Today's queue is anchored to *now* with ago(mins) so the demo always looks live. */
function buildSeed() {
  /* Single-doctor clinic. Everything that used to fan out across rooms now points
     at this one practitioner; the signature block is editable from Settings. */
  const doctors = [
    {
      id: 'D-0001', name: 'Maria Elena Santos', title: 'MD', dept: 'family',
      specialty: 'Family Medicine', prc: '0098221', ptr: '2411056', s2: '00-12-3456',
      email: 'dr.santos@mediclinic.ph', mobile: '0917 100 2001', color: 'teal',
      /* Where this doctor holds clinic. Add, edit and re-order from Settings. */
      locations: [
        {
          id: 'L-0001', name: 'Katipunan (main)', primary: true,
          address: '2F Sampaguita Bldg., 128 Katipunan Ave., Brgy. San Roque, Quezon City 1109',
          phone: '(02) 8712-4455', room: 'Consultation Room',
          days: 'Mon · Wed · Fri', hours: '9:00 AM – 5:00 PM', fee: 500,
        },
        {
          id: 'L-0002', name: 'Commonwealth satellite', primary: false,
          address: 'Ground Flr., Dela Rosa Bldg., 455 Commonwealth Ave., Brgy. Holy Spirit, Quezon City 1127',
          phone: '(02) 8456-2210', room: 'Clinic 2',
          days: 'Tue · Thu', hours: '1:00 PM – 6:00 PM', fee: 450,
        },
      ],
    },
  ];

  const patients = [
    {
      id: 'P-0001', firstName: 'Juan Miguel', lastName: 'Reyes', sex: 'Male', dob: '1979-03-14',
      mobile: '0917 245 7781', email: 'jm.reyes@email.ph', civilStatus: 'Married',
      address: '14 Mabini St., Brgy. Pinyahan, Quezon City', philhealth: '12-345678901-2',
      bloodType: 'O+', allergies: ['Penicillin'], conditions: ['Hypertension'],
      emergency: { name: 'Ana Reyes', relation: 'Spouse', mobile: '0917 245 7782' },
      registeredAt: '2021-06-11',
    },
    {
      id: 'P-0002', firstName: 'Liezl Mae', lastName: 'Bautista', sex: 'Female', dob: '1992-07-22',
      mobile: '0918 553 1140', email: 'liezl.bautista@email.ph', civilStatus: 'Single',
      address: '7B Rosal St., Brgy. Holy Spirit, Quezon City', philhealth: '12-887654321-0',
      bloodType: 'A+', allergies: ['Sulfa drugs'], conditions: [],
      emergency: { name: 'Marites Bautista', relation: 'Mother', mobile: '0918 553 1141' },
      registeredAt: '2022-02-03',
    },
    {
      id: 'P-0003', firstName: 'Andres', lastName: 'Lim', sex: 'Male', dob: '1958-11-02',
      mobile: '0919 884 2213', email: 'andres.lim@email.ph', civilStatus: 'Married',
      address: '22 Narra Ave., Brgy. Project 6, Quezon City', philhealth: '12-112233445-6',
      bloodType: 'B+', allergies: [], conditions: ['Type 2 Diabetes Mellitus', 'Hypertension'],
      emergency: { name: 'Carmen Lim', relation: 'Spouse', mobile: '0919 884 2214' },
      registeredAt: '2019-09-18', seniorId: 'OSCA-QC-2018-04412',
    },
    {
      id: 'P-0004', firstName: 'Sofia', lastName: 'Marquez', sex: 'Female', dob: '2019-05-30',
      mobile: '0917 330 9087', email: 'marquez.family@email.ph', civilStatus: 'Single',
      address: '19 Ilang-Ilang St., Brgy. Teachers Village, Quezon City', philhealth: '12-556677889-1',
      bloodType: 'O+', allergies: [], conditions: [],
      emergency: { name: 'Paolo Marquez', relation: 'Father', mobile: '0917 330 9088' },
      registeredAt: '2020-01-22', guardian: 'Paolo Marquez (Father)',
    },
    {
      id: 'P-0005', firstName: 'Rowena', lastName: 'Castillo', sex: 'Female', dob: '1986-01-19',
      mobile: '0915 772 4410', email: 'rowena.castillo@email.ph', civilStatus: 'Married',
      address: '5 Camia St., Brgy. Bagong Pag-asa, Quezon City', philhealth: '12-443322110-9',
      bloodType: 'AB+', allergies: ['Aspirin'], conditions: ['Bronchial Asthma'],
      emergency: { name: 'Ramil Castillo', relation: 'Spouse', mobile: '0915 772 4411' },
      registeredAt: '2020-08-05',
    },
    {
      id: 'P-0006', firstName: 'Dante', lastName: 'Ocampo', sex: 'Male', dob: '1971-09-08',
      mobile: '0916 221 7788', email: 'dante.ocampo@email.ph', civilStatus: 'Married',
      address: '88 Kalachuchi St., Brgy. Tandang Sora, Quezon City', philhealth: '12-998877665-4',
      bloodType: 'A-', allergies: ['NSAIDs'], conditions: ['Dyslipidemia'],
      emergency: { name: 'Lita Ocampo', relation: 'Spouse', mobile: '0916 221 7789' },
      registeredAt: '2021-11-27',
    },
    {
      id: 'P-0007', firstName: 'Mark Anthony', lastName: 'Flores', sex: 'Male', dob: '2001-12-11',
      mobile: '0905 448 1120', email: 'markflores@email.ph', civilStatus: 'Single',
      address: '31 Sampaloc St., Brgy. Commonwealth, Quezon City', philhealth: '12-334455667-8',
      bloodType: 'O-', allergies: [], conditions: [],
      emergency: { name: 'Nenita Flores', relation: 'Mother', mobile: '0905 448 1121' },
      registeredAt: '2023-03-14',
    },
    {
      id: 'P-0008', firstName: 'Teresita', lastName: 'Gonzales', sex: 'Female', dob: '1953-04-25',
      mobile: '0920 667 3312', email: 'teresita.g@email.ph', civilStatus: 'Widowed',
      address: '3 Dahlia St., Brgy. Matandang Balara, Quezon City', philhealth: '12-776655443-2',
      bloodType: 'B-', allergies: ['Penicillin', 'Ibuprofen'], conditions: ['Hypertension', 'Osteoarthritis'],
      emergency: { name: 'Jerome Gonzales', relation: 'Son', mobile: '0920 667 3313' },
      registeredAt: '2018-05-30', seniorId: 'OSCA-QC-2013-00987',
    },
    {
      id: 'P-0009', firstName: 'Jomar', lastName: 'Pascual', sex: 'Male', dob: '1995-06-03',
      mobile: '0927 114 8890', email: 'jomar.pascual@email.ph', civilStatus: 'Single',
      address: '45 Acacia St., Brgy. Culiat, Quezon City', philhealth: '12-220099881-3',
      bloodType: 'A+', allergies: [], conditions: [],
      emergency: { name: 'Jenny Pascual', relation: 'Sister', mobile: '0927 114 8891' },
      registeredAt: '2024-01-09',
    },
    {
      id: 'P-0010', firstName: 'Angelica', lastName: 'Tan', sex: 'Female', dob: '1989-10-17',
      mobile: '0998 441 2207', email: 'angelica.tan@email.ph', civilStatus: 'Single',
      address: '12 Molave St., Brgy. Krus na Ligas, Quezon City', philhealth: '12-664455220-7',
      bloodType: 'O+', allergies: [], conditions: ['Migraine'],
      emergency: { name: 'Bryan Tan', relation: 'Brother', mobile: '0998 441 2208' },
      registeredAt: '2022-09-21', pwdId: 'PWD-QC-2021-00231',
    },
  ];

  const inventory = [
    { id: 'I-0001', name: 'Paracetamol', strength: '500 mg', form: 'Tablet', unit: 'tab', category: 'Analgesic', price: 3.5, stock: 420, reorderLevel: 100, brand: 'generic' },
    { id: 'I-0002', name: 'Ibuprofen', strength: '400 mg', form: 'Tablet', unit: 'tab', category: 'NSAID', price: 6, stock: 180, reorderLevel: 60, brand: 'generic' },
    { id: 'I-0003', name: 'Mefenamic acid', strength: '500 mg', form: 'Capsule', unit: 'cap', category: 'NSAID', price: 7.5, stock: 150, reorderLevel: 60, brand: 'generic' },
    { id: 'I-0004', name: 'Amoxicillin', strength: '500 mg', form: 'Capsule', unit: 'cap', category: 'Antibiotic', price: 9, stock: 264, reorderLevel: 80, brand: 'generic' },
    { id: 'I-0005', name: 'Co-amoxiclav', strength: '625 mg', form: 'Tablet', unit: 'tab', category: 'Antibiotic', price: 38, stock: 21, reorderLevel: 24, brand: 'generic' },
    { id: 'I-0006', name: 'Cefalexin', strength: '500 mg', form: 'Capsule', unit: 'cap', category: 'Antibiotic', price: 14, stock: 96, reorderLevel: 40, brand: 'generic' },
    { id: 'I-0007', name: 'Azithromycin', strength: '500 mg', form: 'Tablet', unit: 'tab', category: 'Antibiotic', price: 52, stock: 6, reorderLevel: 20, brand: 'generic' },
    { id: 'I-0008', name: 'Cotrimoxazole', strength: '800/160 mg', form: 'Tablet', unit: 'tab', category: 'Antibiotic', price: 12, stock: 70, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0009', name: 'Cetirizine', strength: '10 mg', form: 'Tablet', unit: 'tab', category: 'Antihistamine', price: 8, stock: 240, reorderLevel: 80, brand: 'generic' },
    { id: 'I-0010', name: 'Loratadine', strength: '10 mg', form: 'Tablet', unit: 'tab', category: 'Antihistamine', price: 9.5, stock: 120, reorderLevel: 40, brand: 'generic' },
    { id: 'I-0011', name: 'Salbutamol', strength: '2.5 mg/2.5 mL', form: 'Nebule', unit: 'neb', category: 'Bronchodilator', price: 22, stock: 44, reorderLevel: 20, brand: 'generic' },
    { id: 'I-0012', name: 'Salbutamol', strength: '100 mcg/dose', form: 'Inhaler (MDI)', unit: 'pc', category: 'Bronchodilator', price: 320, stock: 0, reorderLevel: 6, brand: 'generic' },
    { id: 'I-0013', name: 'Omeprazole', strength: '20 mg', form: 'Capsule', unit: 'cap', category: 'PPI', price: 11, stock: 186, reorderLevel: 60, brand: 'generic' },
    { id: 'I-0014', name: 'Metformin', strength: '500 mg', form: 'Tablet', unit: 'tab', category: 'Antidiabetic', price: 4.5, stock: 240, reorderLevel: 90, brand: 'generic' },
    { id: 'I-0015', name: 'Losartan', strength: '50 mg', form: 'Tablet', unit: 'tab', category: 'Antihypertensive', price: 10, stock: 250, reorderLevel: 90, brand: 'generic' },
    { id: 'I-0016', name: 'Amlodipine', strength: '5 mg', form: 'Tablet', unit: 'tab', category: 'Antihypertensive', price: 7, stock: 230, reorderLevel: 90, brand: 'generic' },
    { id: 'I-0017', name: 'Oral rehydration salts', strength: '20.5 g', form: 'Sachet', unit: 'sachet', category: 'Electrolyte', price: 18, stock: 86, reorderLevel: 30, brand: 'generic' },
    /* --- the rest of the clinic formulary -------------------------------------
       Generic names only (R.A. 6675). Strengths carry their own unit (mg, g, mcg,
       % or mg/mL) and each generic may appear as several variants — tablet,
       capsule, syrup, suspension, drops, nebule, ampule, cream and so on. */
    { id: 'I-0018', name: 'Paracetamol', strength: '250 mg/5 mL', form: 'Syrup (60 mL)', unit: 'bottle', category: 'Analgesic', price: 78, stock: 36, reorderLevel: 12, brand: 'generic' },
    { id: 'I-0019', name: 'Paracetamol', strength: '100 mg/mL', form: 'Drops (15 mL)', unit: 'bottle', category: 'Analgesic', price: 95, stock: 24, reorderLevel: 10, brand: 'generic' },
    { id: 'I-0020', name: 'Paracetamol', strength: '300 mg/2 mL', form: 'Ampule', unit: 'amp', category: 'Analgesic', price: 42, stock: 30, reorderLevel: 12, brand: 'generic' },
    { id: 'I-0021', name: 'Ibuprofen', strength: '200 mg', form: 'Tablet', unit: 'tab', category: 'NSAID', price: 4, stock: 220, reorderLevel: 80, brand: 'generic' },
    { id: 'I-0022', name: 'Ibuprofen', strength: '100 mg/5 mL', form: 'Suspension (60 mL)', unit: 'bottle', category: 'NSAID', price: 92, stock: 20, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0023', name: 'Mefenamic acid', strength: '250 mg', form: 'Capsule', unit: 'cap', category: 'NSAID', price: 5.5, stock: 120, reorderLevel: 40, brand: 'generic' },
    { id: 'I-0024', name: 'Naproxen', strength: '550 mg', form: 'Tablet', unit: 'tab', category: 'NSAID', price: 18, stock: 90, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0025', name: 'Diclofenac', strength: '50 mg', form: 'Tablet', unit: 'tab', category: 'NSAID', price: 9, stock: 140, reorderLevel: 50, brand: 'generic' },
    { id: 'I-0026', name: 'Diclofenac', strength: '1 %', form: 'Gel (20 g)', unit: 'tube', category: 'NSAID', price: 185, stock: 18, reorderLevel: 6, brand: 'generic' },
    { id: 'I-0027', name: 'Celecoxib', strength: '200 mg', form: 'Capsule', unit: 'cap', category: 'NSAID', price: 34, stock: 60, reorderLevel: 20, brand: 'generic' },
    { id: 'I-0028', name: 'Ketorolac', strength: '30 mg/mL', form: 'Ampule', unit: 'amp', category: 'NSAID', price: 48, stock: 24, reorderLevel: 10, brand: 'generic' },
    { id: 'I-0029', name: 'Tramadol', strength: '50 mg', form: 'Capsule', unit: 'cap', category: 'Analgesic', price: 22, stock: 40, reorderLevel: 15, brand: 'generic' },
    { id: 'I-0030', name: 'Aspirin', strength: '80 mg', form: 'Tablet', unit: 'tab', category: 'Antiplatelet', price: 2.5, stock: 300, reorderLevel: 100, brand: 'generic' },
    { id: 'I-0031', name: 'Amoxicillin', strength: '250 mg', form: 'Capsule', unit: 'cap', category: 'Antibiotic', price: 6, stock: 180, reorderLevel: 60, brand: 'generic' },
    { id: 'I-0032', name: 'Amoxicillin', strength: '250 mg/5 mL', form: 'Suspension (60 mL)', unit: 'bottle', category: 'Antibiotic', price: 115, stock: 28, reorderLevel: 10, brand: 'generic' },
    { id: 'I-0033', name: 'Amoxicillin', strength: '100 mg/mL', form: 'Drops (15 mL)', unit: 'bottle', category: 'Antibiotic', price: 135, stock: 16, reorderLevel: 6, brand: 'generic' },
    { id: 'I-0034', name: 'Co-amoxiclav', strength: '1 g', form: 'Tablet', unit: 'tab', category: 'Antibiotic', price: 62, stock: 40, reorderLevel: 16, brand: 'generic' },
    { id: 'I-0035', name: 'Co-amoxiclav', strength: '228 mg/5 mL', form: 'Suspension (60 mL)', unit: 'bottle', category: 'Antibiotic', price: 295, stock: 12, reorderLevel: 6, brand: 'generic' },
    { id: 'I-0036', name: 'Cloxacillin', strength: '500 mg', form: 'Capsule', unit: 'cap', category: 'Antibiotic', price: 12, stock: 90, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0037', name: 'Cefalexin', strength: '250 mg/5 mL', form: 'Suspension (60 mL)', unit: 'bottle', category: 'Antibiotic', price: 155, stock: 18, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0038', name: 'Cefuroxime', strength: '500 mg', form: 'Tablet', unit: 'tab', category: 'Antibiotic', price: 58, stock: 48, reorderLevel: 20, brand: 'generic' },
    { id: 'I-0039', name: 'Cefixime', strength: '200 mg', form: 'Capsule', unit: 'cap', category: 'Antibiotic', price: 46, stock: 40, reorderLevel: 16, brand: 'generic' },
    { id: 'I-0040', name: 'Azithromycin', strength: '200 mg/5 mL', form: 'Suspension (15 mL)', unit: 'bottle', category: 'Antibiotic', price: 265, stock: 10, reorderLevel: 5, brand: 'generic' },
    { id: 'I-0041', name: 'Clarithromycin', strength: '500 mg', form: 'Tablet', unit: 'tab', category: 'Antibiotic', price: 72, stock: 30, reorderLevel: 12, brand: 'generic' },
    { id: 'I-0042', name: 'Erythromycin', strength: '500 mg', form: 'Tablet', unit: 'tab', category: 'Antibiotic', price: 16, stock: 60, reorderLevel: 20, brand: 'generic' },
    { id: 'I-0043', name: 'Cotrimoxazole', strength: '200/40 mg per 5 mL', form: 'Suspension (60 mL)', unit: 'bottle', category: 'Antibiotic', price: 88, stock: 20, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0044', name: 'Ciprofloxacin', strength: '500 mg', form: 'Tablet', unit: 'tab', category: 'Antibiotic', price: 24, stock: 70, reorderLevel: 25, brand: 'generic' },
    { id: 'I-0045', name: 'Levofloxacin', strength: '500 mg', form: 'Tablet', unit: 'tab', category: 'Antibiotic', price: 45, stock: 50, reorderLevel: 20, brand: 'generic' },
    { id: 'I-0046', name: 'Metronidazole', strength: '500 mg', form: 'Tablet', unit: 'tab', category: 'Antibiotic', price: 8, stock: 120, reorderLevel: 40, brand: 'generic' },
    { id: 'I-0047', name: 'Doxycycline', strength: '100 mg', form: 'Capsule', unit: 'cap', category: 'Antibiotic', price: 14, stock: 80, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0048', name: 'Nitrofurantoin', strength: '100 mg', form: 'Capsule', unit: 'cap', category: 'Antibiotic', price: 26, stock: 44, reorderLevel: 18, brand: 'generic' },
    { id: 'I-0049', name: 'Cetirizine', strength: '5 mg/5 mL', form: 'Syrup (60 mL)', unit: 'bottle', category: 'Antihistamine', price: 98, stock: 26, reorderLevel: 10, brand: 'generic' },
    { id: 'I-0050', name: 'Cetirizine', strength: '2.5 mg/mL', form: 'Drops (10 mL)', unit: 'bottle', category: 'Antihistamine', price: 125, stock: 14, reorderLevel: 6, brand: 'generic' },
    { id: 'I-0051', name: 'Loratadine', strength: '5 mg/5 mL', form: 'Syrup (60 mL)', unit: 'bottle', category: 'Antihistamine', price: 105, stock: 18, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0052', name: 'Diphenhydramine', strength: '50 mg/mL', form: 'Ampule', unit: 'amp', category: 'Antihistamine', price: 38, stock: 20, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0053', name: 'Chlorphenamine', strength: '4 mg', form: 'Tablet', unit: 'tab', category: 'Antihistamine', price: 2, stock: 200, reorderLevel: 60, brand: 'generic' },
    { id: 'I-0054', name: 'Montelukast', strength: '10 mg', form: 'Tablet', unit: 'tab', category: 'Antiasthmatic', price: 38, stock: 60, reorderLevel: 20, brand: 'generic' },
    { id: 'I-0055', name: 'Montelukast', strength: '4 mg', form: 'Chewable tablet', unit: 'tab', category: 'Antiasthmatic', price: 32, stock: 40, reorderLevel: 16, brand: 'generic' },
    { id: 'I-0056', name: 'Salbutamol', strength: '2 mg', form: 'Tablet', unit: 'tab', category: 'Bronchodilator', price: 3, stock: 150, reorderLevel: 50, brand: 'generic' },
    { id: 'I-0057', name: 'Salbutamol + Ipratropium', strength: '2.5 mg/0.5 mg', form: 'Nebule', unit: 'neb', category: 'Bronchodilator', price: 38, stock: 30, reorderLevel: 12, brand: 'generic' },
    { id: 'I-0058', name: 'Budesonide', strength: '0.5 mg/2 mL', form: 'Respule', unit: 'respule', category: 'Corticosteroid', price: 115, stock: 16, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0059', name: 'Carbocisteine', strength: '500 mg', form: 'Capsule', unit: 'cap', category: 'Mucolytic', price: 11, stock: 140, reorderLevel: 50, brand: 'generic' },
    { id: 'I-0060', name: 'Carbocisteine', strength: '250 mg/5 mL', form: 'Syrup (60 mL)', unit: 'bottle', category: 'Mucolytic', price: 118, stock: 22, reorderLevel: 10, brand: 'generic' },
    { id: 'I-0061', name: 'Ambroxol', strength: '30 mg', form: 'Tablet', unit: 'tab', category: 'Mucolytic', price: 9, stock: 120, reorderLevel: 40, brand: 'generic' },
    { id: 'I-0062', name: 'Oxymetazoline', strength: '0.05 %', form: 'Nasal spray (15 mL)', unit: 'bottle', category: 'Decongestant', price: 165, stock: 14, reorderLevel: 6, brand: 'generic' },
    { id: 'I-0063', name: 'Prednisone', strength: '20 mg', form: 'Tablet', unit: 'tab', category: 'Corticosteroid', price: 7, stock: 100, reorderLevel: 40, brand: 'generic' },
    { id: 'I-0064', name: 'Dexamethasone', strength: '4 mg/mL', form: 'Ampule', unit: 'amp', category: 'Corticosteroid', price: 35, stock: 24, reorderLevel: 10, brand: 'generic' },
    { id: 'I-0065', name: 'Omeprazole', strength: '40 mg', form: 'Capsule', unit: 'cap', category: 'PPI', price: 19, stock: 90, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0066', name: 'Pantoprazole', strength: '40 mg', form: 'Tablet', unit: 'tab', category: 'PPI', price: 28, stock: 70, reorderLevel: 25, brand: 'generic' },
    { id: 'I-0067', name: 'Famotidine', strength: '40 mg', form: 'Tablet', unit: 'tab', category: 'H2 blocker', price: 13, stock: 80, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0068', name: 'Aluminium + Magnesium hydroxide', strength: '225/200 mg per 5 mL', form: 'Suspension (120 mL)', unit: 'bottle', category: 'Antacid', price: 112, stock: 20, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0069', name: 'Domperidone', strength: '10 mg', form: 'Tablet', unit: 'tab', category: 'Antiemetic', price: 12, stock: 90, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0070', name: 'Metoclopramide', strength: '10 mg/2 mL', form: 'Ampule', unit: 'amp', category: 'Antiemetic', price: 26, stock: 24, reorderLevel: 10, brand: 'generic' },
    { id: 'I-0071', name: 'Hyoscine-N-butylbromide', strength: '10 mg', form: 'Tablet', unit: 'tab', category: 'Antispasmodic', price: 17, stock: 80, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0072', name: 'Loperamide', strength: '2 mg', form: 'Capsule', unit: 'cap', category: 'Antidiarrhoeal', price: 7, stock: 100, reorderLevel: 35, brand: 'generic' },
    { id: 'I-0073', name: 'Lactulose', strength: '10 g/15 mL', form: 'Syrup (120 mL)', unit: 'bottle', category: 'Laxative', price: 198, stock: 12, reorderLevel: 6, brand: 'generic' },
    { id: 'I-0074', name: 'Bisacodyl', strength: '5 mg', form: 'Tablet', unit: 'tab', category: 'Laxative', price: 6, stock: 90, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0075', name: 'Amlodipine', strength: '10 mg', form: 'Tablet', unit: 'tab', category: 'Antihypertensive', price: 9, stock: 180, reorderLevel: 60, brand: 'generic' },
    { id: 'I-0076', name: 'Losartan', strength: '100 mg', form: 'Tablet', unit: 'tab', category: 'Antihypertensive', price: 15, stock: 160, reorderLevel: 60, brand: 'generic' },
    { id: 'I-0077', name: 'Telmisartan', strength: '40 mg', form: 'Tablet', unit: 'tab', category: 'Antihypertensive', price: 26, stock: 90, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0078', name: 'Metoprolol', strength: '50 mg', form: 'Tablet', unit: 'tab', category: 'Antihypertensive', price: 12, stock: 100, reorderLevel: 35, brand: 'generic' },
    { id: 'I-0079', name: 'Hydrochlorothiazide', strength: '25 mg', form: 'Tablet', unit: 'tab', category: 'Diuretic', price: 5, stock: 120, reorderLevel: 40, brand: 'generic' },
    { id: 'I-0080', name: 'Furosemide', strength: '40 mg', form: 'Tablet', unit: 'tab', category: 'Diuretic', price: 6, stock: 110, reorderLevel: 40, brand: 'generic' },
    { id: 'I-0081', name: 'Atorvastatin', strength: '20 mg', form: 'Tablet', unit: 'tab', category: 'Statin', price: 21, stock: 120, reorderLevel: 40, brand: 'generic' },
    { id: 'I-0082', name: 'Rosuvastatin', strength: '10 mg', form: 'Tablet', unit: 'tab', category: 'Statin', price: 33, stock: 70, reorderLevel: 25, brand: 'generic' },
    { id: 'I-0083', name: 'Metformin', strength: '850 mg', form: 'Tablet', unit: 'tab', category: 'Antidiabetic', price: 6, stock: 160, reorderLevel: 60, brand: 'generic' },
    { id: 'I-0084', name: 'Gliclazide', strength: '60 mg', form: 'MR tablet', unit: 'tab', category: 'Antidiabetic', price: 24, stock: 60, reorderLevel: 20, brand: 'generic' },
    { id: 'I-0085', name: 'Glimepiride', strength: '2 mg', form: 'Tablet', unit: 'tab', category: 'Antidiabetic', price: 15, stock: 70, reorderLevel: 25, brand: 'generic' },
    { id: 'I-0086', name: 'Clopidogrel', strength: '75 mg', form: 'Tablet', unit: 'tab', category: 'Antiplatelet', price: 29, stock: 60, reorderLevel: 20, brand: 'generic' },
    { id: 'I-0087', name: 'Isosorbide dinitrate', strength: '5 mg', form: 'Sublingual tablet', unit: 'tab', category: 'Antianginal', price: 8, stock: 80, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0088', name: 'Allopurinol', strength: '300 mg', form: 'Tablet', unit: 'tab', category: 'Antigout', price: 11, stock: 90, reorderLevel: 30, brand: 'generic' },
    { id: 'I-0089', name: 'Colchicine', strength: '500 mcg', form: 'Tablet', unit: 'tab', category: 'Antigout', price: 27, stock: 50, reorderLevel: 20, brand: 'generic' },
    { id: 'I-0090', name: 'Ascorbic acid', strength: '500 mg', form: 'Tablet', unit: 'tab', category: 'Vitamin', price: 3, stock: 400, reorderLevel: 120, brand: 'generic' },
    { id: 'I-0091', name: 'Ascorbic acid + Zinc', strength: '100 mg/mL', form: 'Drops (15 mL)', unit: 'bottle', category: 'Vitamin', price: 145, stock: 20, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0092', name: 'Ferrous sulfate', strength: '325 mg', form: 'Tablet', unit: 'tab', category: 'Haematinic', price: 4, stock: 200, reorderLevel: 70, brand: 'generic' },
    { id: 'I-0093', name: 'Ferrous sulfate', strength: '15 mg/0.6 mL', form: 'Drops (15 mL)', unit: 'bottle', category: 'Haematinic', price: 128, stock: 16, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0094', name: 'Folic acid', strength: '5 mg', form: 'Tablet', unit: 'tab', category: 'Vitamin', price: 2.5, stock: 240, reorderLevel: 80, brand: 'generic' },
    { id: 'I-0095', name: 'Vitamin B complex', strength: 'B1 100 mg / B6 5 mg / B12 50 mcg', form: 'Tablet', unit: 'tab', category: 'Vitamin', price: 9, stock: 180, reorderLevel: 60, brand: 'generic' },
    { id: 'I-0096', name: 'Calcium carbonate + Vitamin D3', strength: '500 mg / 400 IU', form: 'Tablet', unit: 'tab', category: 'Supplement', price: 12, stock: 140, reorderLevel: 50, brand: 'generic' },
    { id: 'I-0097', name: 'Zinc sulfate', strength: '55 mg/5 mL', form: 'Syrup (60 mL)', unit: 'bottle', category: 'Supplement', price: 110, stock: 20, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0098', name: 'Mupirocin', strength: '2 %', form: 'Ointment (5 g)', unit: 'tube', category: 'Topical antibiotic', price: 210, stock: 14, reorderLevel: 6, brand: 'generic' },
    { id: 'I-0099', name: 'Betamethasone valerate', strength: '0.1 %', form: 'Cream (5 g)', unit: 'tube', category: 'Topical steroid', price: 96, stock: 20, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0100', name: 'Hydrocortisone', strength: '1 %', form: 'Cream (5 g)', unit: 'tube', category: 'Topical steroid', price: 78, stock: 22, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0101', name: 'Clotrimazole', strength: '1 %', form: 'Cream (10 g)', unit: 'tube', category: 'Antifungal', price: 88, stock: 24, reorderLevel: 10, brand: 'generic' },
    { id: 'I-0102', name: 'Ketoconazole', strength: '2 %', form: 'Cream (15 g)', unit: 'tube', category: 'Antifungal', price: 132, stock: 18, reorderLevel: 8, brand: 'generic' },
    { id: 'I-0103', name: 'Silver sulfadiazine', strength: '1 %', form: 'Cream (25 g)', unit: 'tube', category: 'Burn care', price: 245, stock: 10, reorderLevel: 4, brand: 'generic' },
    { id: 'I-0104', name: 'Povidone-iodine', strength: '10 %', form: 'Solution (60 mL)', unit: 'bottle', category: 'Antiseptic', price: 85, stock: 26, reorderLevel: 10, brand: 'generic' },
    { id: 'I-0105', name: 'Tobramycin', strength: '0.3 %', form: 'Eye drops (5 mL)', unit: 'bottle', category: 'Ophthalmic', price: 175, stock: 12, reorderLevel: 6, brand: 'generic' },
    { id: 'I-0106', name: 'Ofloxacin', strength: '0.3 %', form: 'Otic drops (5 mL)', unit: 'bottle', category: 'Otic', price: 168, stock: 12, reorderLevel: 6, brand: 'generic' },
    { id: 'I-0107', name: 'Lidocaine', strength: '2 %', form: 'Ampule (5 mL)', unit: 'amp', category: 'Anaesthetic', price: 32, stock: 30, reorderLevel: 12, brand: 'generic' },
    { id: 'I-0108', name: 'Tetanus toxoid', strength: '0.5 mL', form: 'Vial', unit: 'vial', category: 'Vaccine', price: 320, stock: 8, reorderLevel: 4, brand: 'generic' },
  ];

  /* Medication rows carry itemId so billing can deduct stock on payment. */
  const med = (itemId, freq, days, instructions, overrides = {}) => {
    const item = inventory.find((i) => i.id === itemId);
    return {
      id: `M-${itemId.slice(2)}-${freq}-${days}`,
      itemId,
      name: item.name,
      strength: item.strength,
      form: item.form,
      route: item.form.includes('Nebule') ? 'Nebulization' : item.form.includes('Inhaler') ? 'Inhalation' : 'PO',
      freq,
      days,
      qty: autoQty(freq, days) || 1,
      instructions,
      ...overrides,
    };
  };

  const dx = (code) => {
    const row = ICD10.find((d) => d.code === code);
    return { code: row.code, label: row.label };
  };

  const encounters = [
    {
      id: 'E-0001', patientId: 'P-0003', doctorId: 'D-0001', date: inDays(-124), type: 'Appointment',
      chiefComplaint: 'Diabetes and hypertension follow-up',
      vitals: { bp: '138/86', hr: 78, rr: 18, temp: 36.6, spo2: 98, weight: 76, height: 168 },
      soap: {
        s: 'For routine follow-up. Compliant with maintenance. Denies polyuria, polydipsia, or blurring of vision. Diet partially controlled.',
        o: 'Awake, not in distress. Clear breath sounds. CBS, no murmur. Feet: intact sensation, no ulcers.',
        a: 'Type 2 diabetes mellitus, fair control. Essential hypertension, controlled.',
        p: 'Continue maintenance. Diabetic diet. Repeat FBS and HbA1c before next visit. Follow-up in 3 months.',
      },
      diagnoses: [dx('E11.9'), dx('I10')],
      meds: [med('I-0014', 'BID', 90, 'Take after meals.'), med('I-0015', 'OD', 90, 'Take in the morning.')],
      disposition: 'Home / outpatient', followUp: inDays(-34),
    },
    {
      id: 'E-0002', patientId: 'P-0001', doctorId: 'D-0001', date: inDays(-96), type: 'Walk-in',
      chiefComplaint: 'Elevated blood pressure readings at home',
      vitals: { bp: '152/94', hr: 84, rr: 18, temp: 36.7, spo2: 98, weight: 82, height: 172 },
      soap: {
        s: 'Home BP readings 150–160/90–100 for the past week. Occasional occipital headache. No chest pain or dyspnea.',
        o: 'Awake, not in distress. BP repeated after 10 minutes rest: 148/92. Clear breath sounds. CBS, no murmur. No bipedal edema.',
        a: 'Essential hypertension, uncontrolled.',
        p: 'Start Amlodipine 5 mg OD. Low-salt diet. Home BP monitoring twice daily. Follow-up in 2 weeks with BP diary.',
      },
      diagnoses: [dx('I10')],
      meds: [med('I-0016', 'OD', 30, 'Take in the morning. May cause ankle swelling.')],
      disposition: 'Home / outpatient', followUp: inDays(-82),
    },
    {
      id: 'E-0003', patientId: 'P-0005', doctorId: 'D-0001', date: inDays(-71), type: 'Walk-in',
      chiefComplaint: 'Difficulty of breathing, wheezing',
      vitals: { bp: '124/78', hr: 102, rr: 24, temp: 36.9, spo2: 94, weight: 58, height: 160 },
      soap: {
        s: 'Dyspnea and wheezing since last night, triggered by dust exposure. Used salbutamol MDI twice with partial relief.',
        o: 'Awake, mild respiratory distress, speaks in phrases. Bilateral expiratory wheezes. SpO₂ 94% at room air. Post-nebulization: RR 18, SpO₂ 98%, wheezes resolved.',
        a: 'Bronchial asthma in acute exacerbation, mild — responded to nebulization.',
        p: 'Salbutamol nebulization q6h PRN. Avoid dust and known triggers. Return immediately for persistent dyspnea or poor response.',
      },
      diagnoses: [dx('J45.9')],
      meds: [med('I-0011', 'Q6H', 5, 'Nebulize as needed for difficulty of breathing.')],
      disposition: 'Home / outpatient', followUp: '',
    },
    {
      id: 'E-0004', patientId: 'P-0004', doctorId: 'D-0001', date: inDays(-58), type: 'Appointment',
      chiefComplaint: 'Fever and cough x 2 days',
      vitals: { bp: '', hr: 112, rr: 26, temp: 38.4, spo2: 98, weight: 18, height: 106 },
      soap: {
        s: 'Fever (Tmax 38.9 °C) and productive cough x 2 days. Nasal congestion. Appetite slightly decreased. Active in between febrile episodes. No vomiting or diarrhea.',
        o: 'Awake, active, hydrated. Pharyngeal congestion, no exudates. Clear breath sounds, no retractions. Abdomen soft, non-tender.',
        a: 'Acute upper respiratory tract infection, viral.',
        p: 'Paracetamol for fever. Increase oral fluids. Tepid sponge bath. Return for fever beyond 3 days, difficulty of breathing, or poor intake.',
      },
      diagnoses: [dx('J06.9'), dx('R50.9')],
      meds: [med('I-0001', 'Q6H', 3, 'Give 1/2 tablet (250 mg) every 6 hours as needed for fever ≥ 37.8 °C.', { qty: 12 })],
      disposition: 'Home / outpatient', followUp: '',
    },
    {
      id: 'E-0005', patientId: 'P-0008', doctorId: 'D-0001', date: inDays(-45), type: 'Appointment',
      chiefComplaint: 'Knee pain and BP follow-up',
      vitals: { bp: '144/88', hr: 76, rr: 18, temp: 36.5, spo2: 97, weight: 64, height: 152 },
      soap: {
        s: 'Bilateral knee pain worse on stair climbing, ongoing for months. Compliant with BP maintenance. Denies chest pain.',
        o: 'Awake, ambulatory with slight antalgic gait. Knees: crepitus on flexion, no warmth or effusion. Clear breath sounds. CBS, no murmur.',
        a: 'Osteoarthritis, both knees. Essential hypertension, borderline controlled.',
        p: 'Paracetamol PRN for pain — NSAIDs withheld given documented allergy. Quadriceps strengthening exercises. Continue Losartan. Follow-up in 1 month.',
      },
      diagnoses: [dx('I10'), dx('M54.5')],
      meds: [med('I-0001', 'TID', 14, 'Take after meals as needed for pain.'), med('I-0015', 'OD', 60, 'Take in the morning.')],
      disposition: 'Home / outpatient', followUp: inDays(-15),
    },
    {
      id: 'E-0006', patientId: 'P-0002', doctorId: 'D-0001', date: inDays(-38), type: 'Walk-in',
      chiefComplaint: 'Dysuria and frequency',
      vitals: { bp: '116/74', hr: 88, rr: 18, temp: 37.6, spo2: 99, weight: 55, height: 158 },
      soap: {
        s: 'Burning sensation on urination with increased frequency x 3 days. No flank pain. No vaginal discharge.',
        o: 'Awake, not in distress. Abdomen soft, suprapubic tenderness. No costovertebral angle tenderness. Urinalysis: pyuria, WBC 25–30/hpf.',
        a: 'Uncomplicated urinary tract infection.',
        p: 'Cefalexin 500 mg QID x 7 days — cotrimoxazole avoided due to sulfa allergy. Increase oral fluid intake. Return if fever or flank pain develops.',
      },
      diagnoses: [dx('N39.0')],
      meds: [med('I-0006', 'QID', 7, 'Take every 6 hours. Complete the full course.')],
      disposition: 'Home / outpatient', followUp: '',
    },
    {
      id: 'E-0007', patientId: 'P-0007', doctorId: 'D-0001', date: inDays(-31), type: 'Walk-in',
      chiefComplaint: 'Loose stools since yesterday',
      vitals: { bp: '118/76', hr: 92, rr: 18, temp: 37.2, spo2: 99, weight: 68, height: 170 },
      soap: {
        s: 'Loose watery stools, 6 episodes since yesterday, non-bloody. Abdominal cramps. Ate street food two days ago. Tolerating oral intake.',
        o: 'Awake, hydrated, not in distress. Moist oral mucosa, good skin turgor. Abdomen soft, hyperactive bowel sounds, mild periumbilical tenderness.',
        a: 'Acute gastroenteritis, no signs of dehydration.',
        p: 'Oral rehydration salts after every loose stool. Soft diet, avoid dairy. Return for signs of dehydration, bloody stools, or persistent vomiting.',
      },
      diagnoses: [dx('A09')],
      meds: [med('I-0017', 'PRN', 3, 'Dissolve 1 sachet in 1 L of clean water. Take after every loose stool.', { qty: 6 })],
      disposition: 'Home / outpatient', followUp: '',
    },
    {
      id: 'E-0008', patientId: 'P-0006', doctorId: 'D-0001', date: inDays(-27), type: 'Appointment',
      chiefComplaint: 'Lipid profile review',
      vitals: { bp: '128/82', hr: 74, rr: 18, temp: 36.6, spo2: 98, weight: 88, height: 174 },
      soap: {
        s: 'For review of lipid profile. Asymptomatic. Sedentary work. Denies chest pain or exertional dyspnea.',
        o: 'Awake, not in distress. BMI 29.1. Clear breath sounds. CBS, no murmur. Lipid profile: TC 258, LDL 176, HDL 38, TG 212 mg/dL.',
        a: 'Dyslipidemia. Overweight, approaching obesity class I.',
        p: 'Therapeutic lifestyle change for 3 months — low-fat diet, 150 min/week moderate exercise. Repeat lipid profile after 3 months before considering statin.',
      },
      diagnoses: [dx('E78.5'), dx('E66.9')],
      meds: [],
      disposition: 'For labs, follow-up', followUp: inDays(63),
    },
    {
      id: 'E-0009', patientId: 'P-0010', doctorId: 'D-0001', date: inDays(-21), type: 'Teleconsult',
      chiefComplaint: 'Recurrent headache',
      vitals: { bp: '', hr: '', rr: '', temp: '', spo2: '', weight: '', height: '' },
      soap: {
        s: 'Recurrent unilateral throbbing headache, 2–3 episodes per month, with photophobia and nausea. Relieved partially by rest in a dark room. Triggers: lack of sleep, skipped meals.',
        o: 'Teleconsultation — physical examination limited. Alert, coherent, no slurring of speech. No reported focal weakness, visual loss, or neck stiffness.',
        a: 'Migraine without aura.',
        p: 'Headache diary. Sleep hygiene, regular meals, hydration. Paracetamol at onset of headache. Red flags discussed — advise in-person consult if sudden severe headache, fever with neck stiffness, or focal deficits.',
      },
      diagnoses: [dx('R51')],
      meds: [med('I-0001', 'PRN', 7, 'Take 1 tablet at onset of headache. Maximum 4 tablets in 24 hours.', { qty: 10 })],
      disposition: 'Home / outpatient', followUp: '',
    },
    {
      id: 'E-0010', patientId: 'P-0009', doctorId: 'D-0001', date: inDays(-14), type: 'Walk-in',
      chiefComplaint: 'Sore throat and colds',
      vitals: { bp: '120/78', hr: 84, rr: 18, temp: 37.8, spo2: 98, weight: 70, height: 173 },
      soap: {
        s: 'Sore throat, colds, and low-grade fever x 3 days. Painful swallowing. No cough. No dyspnea.',
        o: 'Awake, not in distress. Tonsils enlarged with exudates, anterior cervical lymphadenopathy. Clear breath sounds.',
        a: 'Acute bacterial pharyngotonsillitis.',
        p: 'Amoxicillin 500 mg TID x 7 days. Paracetamol for fever and throat pain. Warm saline gargle. Return if unable to swallow or fever persists.',
      },
      diagnoses: [dx('J02.9')],
      meds: [med('I-0004', 'TID', 7, 'Take after meals. Complete the full course.'), med('I-0001', 'Q6H', 3, 'Take as needed for fever or pain.', { qty: 12 })],
      disposition: 'Home / outpatient', followUp: '',
    },
    {
      id: 'E-0011', patientId: 'P-0001', doctorId: 'D-0001', date: inDays(-9), type: 'Appointment',
      chiefComplaint: 'Hypertension follow-up with BP diary',
      vitals: { bp: '132/84', hr: 76, rr: 18, temp: 36.6, spo2: 98, weight: 81, height: 172 },
      soap: {
        s: 'For BP follow-up. Compliant with Amlodipine. Home readings now 128–136/80–86. Denies headache, chest pain, or ankle swelling.',
        o: 'Awake, not in distress. BP 132/84. Clear breath sounds. CBS, no murmur. No bipedal edema.',
        a: 'Essential hypertension, now controlled on Amlodipine 5 mg OD.',
        p: 'Continue Amlodipine 5 mg OD. Maintain low-salt diet and regular walking. Repeat creatinine and lipid profile before next visit. Follow-up in 3 months.',
      },
      diagnoses: [dx('I10')],
      meds: [med('I-0016', 'OD', 90, 'Take in the morning.')],
      disposition: 'Home / outpatient', followUp: inDays(81),
    },
    {
      id: 'E-0012', patientId: 'P-0005', doctorId: 'D-0001', date: inDays(-6), type: 'Walk-in',
      chiefComplaint: 'Itchy rashes on both arms',
      vitals: { bp: '118/76', hr: 80, rr: 18, temp: 36.6, spo2: 99, weight: 58, height: 160 },
      soap: {
        s: 'Itchy erythematous rashes on both forearms x 2 days after using a new detergent. No fever. No dyspnea or lip swelling.',
        o: 'Awake, not in distress. Erythematous papular rashes on both forearms with excoriations. No wheals elsewhere. No angioedema.',
        a: 'Allergic contact dermatitis.',
        p: 'Cetirizine 10 mg OD at bedtime x 7 days. Discontinue the new detergent. Cool compress. Return for spreading rashes, lip swelling, or difficulty of breathing.',
      },
      diagnoses: [dx('L30.9'), dx('T78.4')],
      meds: [med('I-0009', 'HS', 7, 'Take at bedtime. May cause drowsiness.')],
      disposition: 'Home / outpatient', followUp: '',
    },
    {
      id: 'E-0013', patientId: 'P-0004', doctorId: 'D-0001', date: inDays(-3), type: 'Appointment',
      chiefComplaint: 'Well-child check-up',
      vitals: { bp: '', hr: 98, rr: 22, temp: 36.7, spo2: 99, weight: 19, height: 108 },
      soap: {
        s: 'For routine check-up. No fever, cough, or colds. Good appetite and activity. Immunizations up to date.',
        o: 'Awake, active, playful. Clear breath sounds. CBS, no murmur. Abdomen soft, non-tender. Weight and height appropriate for age.',
        a: 'Well child — age-appropriate growth and development.',
        p: 'Age-appropriate diet. Continue multivitamins. Next immunization as scheduled. Return for fever, poor intake, or difficulty of breathing.',
      },
      diagnoses: [dx('Z00.0')],
      meds: [],
      disposition: 'Home / outpatient', followUp: inDays(87),
    },
    {
      id: 'E-0014', patientId: 'P-0003', doctorId: 'D-0001', date: ymd(), type: 'Walk-in',
      chiefComplaint: 'Epigastric pain and acid reflux',
      vitals: { bp: '136/84', hr: 80, rr: 18, temp: 36.6, spo2: 98, weight: 75, height: 168 },
      soap: {
        s: 'Burning epigastric pain x 1 week, worse at night and on an empty stomach. Associated acid regurgitation. No vomiting, melena, or weight loss. Takes paracetamol occasionally.',
        o: 'Awake, not in distress. Abdomen soft, mild epigastric tenderness, no guarding or rebound. No palpable mass. Normoactive bowel sounds.',
        a: 'Gastritis / gastroesophageal reflux. No alarm features.',
        p: 'Omeprazole 20 mg OD before breakfast x 14 days. Avoid coffee, alcohol, spicy and fatty food. Small frequent meals, no late-night eating. Follow-up in 2 weeks; endoscopy if symptoms persist.',
      },
      diagnoses: [dx('K29.7')],
      meds: [med('I-0013', 'OD', 14, 'Take 30 minutes before breakfast.')],
      disposition: 'Home / outpatient', followUp: inDays(14),
    },
  ];

  /* Labs / procedures that were billed on top of the consultation fee. */
  const invoiceExtras = {
    'E-0001': [{ label: 'HbA1c', kind: 'lab', qty: 1, unitPrice: 750 }, { label: 'Creatinine', kind: 'lab', qty: 1, unitPrice: 250 }],
    'E-0003': [{ label: 'Nebulization (per session)', kind: 'service', qty: 2, unitPrice: 250 }],
    'E-0005': [{ label: 'Medical certificate', kind: 'service', qty: 1, unitPrice: 150 }],
    'E-0006': [{ label: 'Urinalysis', kind: 'lab', qty: 1, unitPrice: 180 }],
    'E-0008': [{ label: 'Lipid profile', kind: 'lab', qty: 1, unitPrice: 650 }, { label: 'Fasting blood sugar (FBS)', kind: 'lab', qty: 1, unitPrice: 150 }],
    'E-0010': [{ label: 'CBC with platelet count', kind: 'lab', qty: 1, unitPrice: 350 }],
    'E-0014': [{ label: 'Fecalysis', kind: 'lab', qty: 1, unitPrice: 180 }],
  };

  const invoices = encounters.map((enc, idx) => {
    const patient = patients.find((p) => p.id === enc.patientId);
    const doctor = doctors.find((d) => d.id === enc.doctorId);
    const isFollowUp = enc.type === 'Appointment';
    const consult = {
      id: `IT-${enc.id}-C`,
      label: enc.type === 'Teleconsult'
        ? 'Teleconsultation'
        : `Consultation — ${isFollowUp ? 'follow-up' : 'new patient'} (Dr. ${doctor.name.split(' ').pop()})`,
      kind: 'service',
      qty: 1,
      unitPrice: enc.type === 'Teleconsult' ? 400 : isFollowUp ? 350 : primaryLocation(doctor)?.fee ?? 500,
    };
    const extras = (invoiceExtras[enc.id] ?? []).map((e, i) => ({ ...e, id: `IT-${enc.id}-X${i}` }));
    const drugs = enc.meds.map((m, i) => {
      const item = inventory.find((it) => it.id === m.itemId);
      return {
        id: `IT-${enc.id}-D${i}`,
        label: `${m.name} ${m.strength} ${m.form}`,
        kind: 'drug',
        itemId: m.itemId,
        qty: Number(m.qty) || 1,
        unitPrice: item?.price ?? 0,
        /* Dispensed at the clinic pharmacy vs. bought outside. */
        dispense: i === 0,
      };
    });
    const items = [consult, ...extras, ...drugs];
    const pending = enc.id === 'E-0014';
    const draft = {
      id: `INV-${String(idx + 1).padStart(4, '0')}`,
      encounterId: enc.id,
      patientId: enc.patientId,
      doctorId: enc.doctorId,
      date: enc.date,
      items,
      discountType: isSenior(patient) ? 'Senior Citizen' : patient.pwdId ? 'PWD' : 'None',
      discountId: isSenior(patient) ? patient.seniorId : patient.pwdId || '',
      status: pending ? 'Pending' : 'Paid',
      method: pending ? '' : ['Cash', 'Cash', 'GCash', 'Maya', 'Card'][idx % 5],
      cashier: 'Front desk',
    };
    const { total } = invoiceTotals(draft);
    return {
      ...draft,
      amountPaid: pending ? 0 : total,
      tendered: pending ? 0 : Math.ceil(total / 50) * 50,
      paidAt: pending ? '' : `${enc.date}T10:20:00.000Z`,
    };
  });

  /* Today's board. Minutes-ago anchoring keeps the demo live whenever it is opened —
     but a plain `now - 96min` lands on *yesterday* when the app is opened just after
     midnight, and `isToday` would then hide most of the queue. Compress the spread so
     the whole board always falls on today, preserving the order. */
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const SEED_SPAN_MINS = 100;
  const squeeze = Math.min(1, Math.max(0, ((Date.now() - startOfToday.getTime()) / 60000 - 2) / SEED_SPAN_MINS));
  const seedAgo = (mins) => new Date(Date.now() - mins * 60000 * squeeze).toISOString();

  const queue = [
    {
      id: 'Q-0001', number: 1, patientId: 'P-0003', doctorId: 'D-0001', type: 'Walk-in',
      reason: 'Epigastric pain and acid reflux', priority: true, status: 'Completed',
      checkedInAt: seedAgo(96), startedAt: seedAgo(74), completedAt: seedAgo(52),
      vitals: { bp: '136/84', hr: 80, rr: 18, temp: 36.6, spo2: 98, weight: 75, height: 168 },
      encounterId: 'E-0014', invoiceId: 'INV-0014', draft: null,
    },
    {
      id: 'Q-0002', number: 2, patientId: 'P-0001', doctorId: 'D-0001', type: 'Appointment',
      reason: 'Hypertension follow-up', priority: false, status: 'In Consultation',
      checkedInAt: seedAgo(63), startedAt: seedAgo(11), completedAt: '',
      vitals: { bp: '134/86', hr: 78, rr: 18, temp: 36.5, spo2: 98, weight: 81, height: 172 },
      encounterId: '', invoiceId: '', draft: null, appointmentId: 'A-0001',
    },
    {
      id: 'Q-0003', number: 3, patientId: 'P-0005', doctorId: 'D-0001', type: 'Walk-in',
      reason: 'Follow-up — rashes improving, now with dry cough', priority: false, status: 'Waiting',
      checkedInAt: seedAgo(47), startedAt: '', completedAt: '',
      vitals: { bp: '120/78', hr: 86, rr: 20, temp: 37.1, spo2: 97, weight: 58, height: 160 },
      encounterId: '', invoiceId: '', draft: null,
    },
    {
      id: 'Q-0004', number: 4, patientId: 'P-0008', doctorId: 'D-0001', type: 'Walk-in',
      reason: 'BP check and knee pain', priority: true, status: 'Waiting',
      checkedInAt: seedAgo(36), startedAt: '', completedAt: '',
      vitals: { bp: '148/90', hr: 74, rr: 18, temp: 36.4, spo2: 97, weight: 64, height: 152 },
      encounterId: '', invoiceId: '', draft: null,
    },
    {
      id: 'Q-0005', number: 5, patientId: 'P-0004', doctorId: 'D-0001', type: 'Appointment',
      reason: 'Fever since last night', priority: false, status: 'Waiting',
      checkedInAt: seedAgo(24), startedAt: '', completedAt: '',
      vitals: { bp: '', hr: 118, rr: 26, temp: 38.6, spo2: 98, weight: 19, height: 108 },
      encounterId: '', invoiceId: '', draft: null, appointmentId: 'A-0002',
    },
    {
      id: 'Q-0006', number: 6, patientId: 'P-0007', doctorId: 'D-0001', type: 'Walk-in',
      reason: 'Medical certificate for work clearance', priority: false, status: 'Waiting',
      checkedInAt: seedAgo(13), startedAt: '', completedAt: '',
      vitals: { bp: '118/76', hr: 80, rr: 18, temp: 36.6, spo2: 99, weight: 70, height: 173 },
      encounterId: '', invoiceId: '', draft: null,
    },
    {
      id: 'Q-0007', number: 7, patientId: 'P-0010', doctorId: 'D-0001', type: 'Walk-in',
      reason: 'Headache, 3rd episode this month', priority: false, status: 'Waiting',
      checkedInAt: seedAgo(4), startedAt: '', completedAt: '',
      vitals: { bp: '', hr: '', rr: '', temp: '', spo2: '', weight: '', height: '' },
      encounterId: '', invoiceId: '', draft: null,
    },
  ];

  const appointments = [
    {
      id: 'A-0001', patientId: 'P-0001', doctorId: 'D-0001', dept: 'family', locationId: 'L-0001', date: ymd(),
      time: '09:30 AM', mode: 'In-clinic', complaint: 'Hypertension follow-up',
      status: 'Checked In', createdAt: ago(60 * 24 * 6), link: '',
    },
    {
      id: 'A-0002', patientId: 'P-0004', doctorId: 'D-0001', dept: 'pedia', locationId: 'L-0001', date: ymd(),
      time: '01:30 PM', mode: 'In-clinic', complaint: 'Fever since last night',
      status: 'Checked In', createdAt: ago(60 * 20), link: '',
    },
    {
      id: 'A-0003', patientId: 'P-0006', doctorId: 'D-0001', dept: 'internal', locationId: 'L-0002', date: ymd(),
      time: '03:30 PM', mode: 'In-clinic', complaint: 'Repeat lipid profile review',
      status: 'Confirmed', createdAt: ago(60 * 24 * 3), link: '',
    },
    {
      id: 'A-0004', patientId: 'P-0002', doctorId: 'D-0001', dept: 'family', date: inDays(2),
      time: '10:00 AM', mode: 'Teleconsult', complaint: 'Review of urinalysis results',
      status: 'Confirmed', createdAt: ago(60 * 24), link: 'https://meet.mediclinic.ph/room/a-0004',
    },
    {
      id: 'A-0005', patientId: 'P-0003', doctorId: 'D-0001', dept: 'internal', locationId: 'L-0001', date: inDays(14),
      time: '08:30 AM', mode: 'In-clinic', complaint: 'Gastritis follow-up and repeat FBS',
      status: 'Confirmed', createdAt: ago(30), link: '',
    },
  ];

  /* Front-desk team. Staff sign in as one of these from the header. */
  const staff = [
    { id: 'S-0001', name: 'Imelda Cruz', role: 'Receptionist', desk: 'Front desk', email: 'imelda.cruz@mediclinic.ph', mobile: '0917 100 3001' },
    { id: 'S-0002', name: 'Benjie Ramos', role: 'Pharmacy assistant', desk: 'Pharmacy', email: 'benjie.ramos@mediclinic.ph', mobile: '0917 100 3002' },
    { id: 'S-0003', name: 'Cherry Lim', role: 'Billing clerk', desk: 'Billing', email: 'cherry.lim@mediclinic.ph', mobile: '0917 100 3003' },
  ];

  const msg = (from, body, minsAgo, read = true) => ({
    id: `MSG-${from.id}-${minsAgo}`,
    from,
    body,
    at: ago(minsAgo),
    read,
  });

  /* Seeded conversations. Note every thread is doctor↔patient or doctor↔staff —
     patient↔staff is not a permitted pairing (see MESSAGING_RULES). */
  const threads = [
    {
      id: 'T-0001',
      participants: [{ kind: 'doctor', id: 'D-0001' }, { kind: 'patient', id: 'P-0001' }],
      subject: 'Home BP readings',
      createdAt: ago(60 * 30),
      updatedAt: ago(60 * 3),
      messages: [
        msg({ kind: 'patient', id: 'P-0001' }, 'Good morning Doc. My BP this week has been 128–136 over 80–86. Should I still come in on my scheduled follow-up?', 60 * 30),
        msg({ kind: 'doctor', id: 'D-0001' }, 'Good morning! Those readings are much better. Yes, please still come in so we can repeat your creatinine and lipid profile. Keep taking the Amlodipine in the morning.', 60 * 28),
        msg({ kind: 'patient', id: 'P-0001' }, 'Noted, Doc. Thank you po.', 60 * 3, false),
      ],
    },
    {
      id: 'T-0002',
      participants: [{ kind: 'doctor', id: 'D-0001' }, { kind: 'staff', id: 'S-0002' }],
      subject: 'Salbutamol MDI stock',
      createdAt: ago(60 * 8),
      updatedAt: ago(45),
      messages: [
        msg({ kind: 'doctor', id: 'D-0001' }, 'Benjie, are we really out of Salbutamol MDI? I have an asthmatic coming in this afternoon.', 60 * 8),
        msg({ kind: 'staff', id: 'S-0002' }, 'Yes Doc, zero on hand. Delivery is due Thursday. We still have 44 nebules if you want to nebulize here instead.', 45, false),
      ],
    },
    {
      id: 'T-0003',
      participants: [{ kind: 'doctor', id: 'D-0001' }, { kind: 'patient', id: 'P-0003' }],
      subject: 'Omeprazole and my maintenance',
      createdAt: ago(60 * 5),
      updatedAt: ago(60 * 5),
      messages: [
        msg({ kind: 'patient', id: 'P-0003' }, 'Doc, can I take the Omeprazole together with my Metformin in the morning?', 60 * 5, false),
      ],
    },
    {
      id: 'T-0004',
      participants: [{ kind: 'doctor', id: 'D-0001' }, { kind: 'staff', id: 'S-0001' }],
      subject: 'Afternoon pediatric slots',
      createdAt: ago(60 * 20),
      updatedAt: ago(60 * 19),
      messages: [
        msg({ kind: 'staff', id: 'S-0001' }, 'Doc, two parents are asking for 4:30 PM slots on Thursday. Can I open them?', 60 * 20),
        msg({ kind: 'doctor', id: 'D-0001' }, 'Yes, go ahead. Just keep the last slot free for walk-in febrile kids.', 60 * 19),
      ],
    },
  ];

  /* Follow-up reminders raised from encounters, plus a couple of other kinds.
     `status` is Scheduled until the desk sends it (simulated SMS). */
  const notifications = [
    {
      id: 'N-0001',
      to: { kind: 'patient', id: 'P-0003' },
      kind: 'follow-up',
      title: 'Gastritis follow-up',
      body: 'Follow-up with Dr. Santos in 2 weeks, and repeat your FBS before the visit.',
      dueDate: inDays(14),
      encounterId: 'E-0014',
      createdAt: ago(50),
      read: false,
      status: 'Scheduled',
    },
    {
      id: 'N-0002',
      to: { kind: 'patient', id: 'P-0001' },
      kind: 'follow-up',
      title: 'Hypertension follow-up',
      body: 'Repeat creatinine and lipid profile before your next visit with Dr. Santos.',
      dueDate: inDays(5),
      encounterId: 'E-0011',
      createdAt: ago(60 * 24 * 4),
      read: false,
      status: 'Sent',
      sentAt: ago(60 * 24 * 2),
    },
    {
      id: 'N-0003',
      to: { kind: 'patient', id: 'P-0006' },
      kind: 'follow-up',
      title: 'Repeat lipid profile',
      body: 'Three-month lifestyle review with Dr. Santos — repeat your lipid profile first.',
      dueDate: inDays(63),
      encounterId: 'E-0008',
      createdAt: ago(60 * 24 * 27),
      read: true,
      status: 'Scheduled',
    },
    {
      id: 'N-0005',
      to: { kind: 'patient', id: 'P-0005' },
      kind: 'follow-up',
      title: 'Dermatitis recheck',
      body: 'Dr. Santos wants to see how the rashes responded after stopping the new detergent.',
      dueDate: inDays(2),
      encounterId: 'E-0012',
      createdAt: ago(60 * 24 * 6),
      read: false,
      status: 'Scheduled',
    },
    {
      id: 'N-0006',
      to: { kind: 'patient', id: 'P-0008' },
      kind: 'follow-up',
      title: 'BP and knee pain follow-up',
      body: 'One-month review with Dr. Santos — bring your BP diary.',
      dueDate: inDays(-3),
      encounterId: 'E-0005',
      createdAt: ago(60 * 24 * 33),
      read: false,
      status: 'Scheduled',
    },
    {
      id: 'N-0004',
      to: { kind: 'patient', id: 'P-0002' },
      kind: 'appointment',
      title: 'Teleconsultation in 2 days',
      body: 'Review of your urinalysis results with Dr. Santos. Your room opens 10 minutes before the schedule.',
      dueDate: inDays(2),
      appointmentId: 'A-0004',
      createdAt: ago(60 * 24),
      read: false,
      status: 'Sent',
      sentAt: ago(60 * 24),
    },
  ];

  /* One account per person in the directories. */
  const users = [
    ...doctors.map((d) => ({ kind: 'doctor', refId: d.id, name: `Dr. ${d.name}`, email: d.email, mobile: d.mobile })),
    ...staff.map((s) => ({ kind: 'staff', refId: s.id, name: s.name, email: s.email, mobile: s.mobile })),
    ...patients.map((p) => ({ kind: 'patient', refId: p.id, name: patientName(p), email: p.email, mobile: p.mobile })),
  ].map((u, i) => ({
    ...u,
    id: `U-${String(i + 1).padStart(4, '0')}`,
    password: DEFAULT_PASSWORD,
    mustChangePassword: true,
    lastLoginAt: '',
    passwordResetAt: '',
  }));

  /* The letterhead every printed document shares, editable from Settings.
     `logo` is empty until someone uploads one; the default mark is drawn instead. */
  const clinic = { ...CLINIC, logo: '' };

  /* Prescription layout. The doctor owns this — see RxTemplateEditor. */
  const rxTemplate = {
    heading: 'Prescription',
    showWeight: true,
    showAllergies: true,
    showLicenses: true,
    showStandingInstructions: false,
    signatureLabel: 'Attending Physician',
    standingInstructions: 'Return immediately for difficulty of breathing, persistent vomiting, or worsening symptoms.',
    footerNote:
      'Generic names are written in compliance with R.A. 6675 (Generics Act of 1988). This prescription is valid for one (1) year from the date issued, except for regulated drugs.',
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    seededAt: new Date().toISOString(),
    doctors,
    patients,
    inventory,
    encounters,
    invoices,
    queue,
    appointments,
    staff,
    threads,
    notifications,
    users,
    clinic,
    rxTemplate,
  };
}

/* ===== 3. Store ================================================================= */

/* One pure reducer. IDs and timestamps are computed by callers via nextId() so that
   re-running a dispatch (React StrictMode double-invoke) can never shift them. */
function reducer(state, action) {
  switch (action.type) {
    /* Another tab wrote to localStorage — adopt its state verbatim. */
    case 'HYDRATE':
      return action.state;

    case 'RESET':
      return action.state;

    /* --- accounts ----------------------------------------------------------- */
    case 'SET_PASSWORD':
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.id
            ? { ...u, password: action.password, mustChangePassword: false, passwordResetAt: '' }
            : u,
        ),
      };

    /* A reset puts the account back on the default and forces a change at the
       next sign-in. Only the doctor and staff can do this. */
    case 'RESET_PASSWORD':
      return {
        ...state,
        users: state.users.map((u) =>
          u.id === action.id
            ? {
                ...u,
                password: DEFAULT_PASSWORD,
                mustChangePassword: true,
                passwordResetAt: action.at,
                resetBy: action.by ?? '',
              }
            : u,
        ),
      };

    case 'TOUCH_LOGIN':
      return {
        ...state,
        users: state.users.map((u) => (u.id === action.id ? { ...u, lastLoginAt: action.at } : u)),
      };

    /* --- clinic letterhead & prescription template --------------------------- */
    case 'UPDATE_CLINIC':
      return { ...state, clinic: { ...state.clinic, ...action.patch } };

    case 'UPDATE_RX_TEMPLATE':
      return { ...state, rxTemplate: { ...state.rxTemplate, ...action.patch } };

    case 'UPDATE_DOCTOR':
      return {
        ...state,
        doctors: state.doctors.map((d) => (d.id === action.id ? { ...d, ...action.patch } : d)),
      };

    case 'ADD_PATIENT':
      return { ...state, patients: [...state.patients, action.patient] };

    case 'UPDATE_PATIENT':
      return {
        ...state,
        patients: state.patients.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
      };

    case 'ADD_QUEUE':
      return { ...state, queue: [...state.queue, action.item] };

    case 'UPDATE_QUEUE':
      return {
        ...state,
        queue: state.queue.map((q) => (q.id === action.id ? { ...q, ...action.patch } : q)),
      };

    /* Consultation autosave — kept on the queue item so a reload resumes mid-consult. */
    case 'SAVE_DRAFT':
      return {
        ...state,
        queue: state.queue.map((q) =>
          q.id === action.id ? { ...q, draft: action.draft, draftSavedAt: action.savedAt } : q,
        ),
      };

    /* Doctor "Complete & discharge": encounter + pending invoice + queue closed. */
    case 'COMPLETE_CONSULT':
      return {
        ...state,
        encounters: [...state.encounters, action.encounter],
        invoices: [...state.invoices, action.invoice],
        /* A follow-up date on the note raises the patient's reminder right here,
           so nothing depends on the doctor remembering a second step. */
        notifications: action.followUpNotification
          ? [...state.notifications, action.followUpNotification]
          : state.notifications,
        queue: state.queue.map((q) =>
          q.id === action.queueId
            ? {
                ...q,
                status: 'Completed',
                completedAt: action.completedAt,
                encounterId: action.encounter.id,
                invoiceId: action.invoice.id,
                vitals: action.encounter.vitals,
                draft: null,
              }
            : q,
        ),
        appointments: state.appointments.map((a) =>
          a.id === action.appointmentId ? { ...a, status: 'Completed' } : a,
        ),
      };

    /* Amending an already-issued encounter (e.g. correcting a prescription). */
    case 'UPDATE_ENCOUNTER':
      return {
        ...state,
        encounters: state.encounters.map((e) => (e.id === action.id ? { ...e, ...action.patch } : e)),
      };

    case 'UPDATE_INVOICE':
      return {
        ...state,
        invoices: state.invoices.map((inv) => (inv.id === action.id ? { ...inv, ...action.patch } : inv)),
      };

    /* Payment is the only place stock leaves the shelf: dispensed drugs are deducted. */
    case 'PAY_INVOICE': {
      const invoice = state.invoices.find((inv) => inv.id === action.id);
      if (!invoice || invoice.status === 'Paid') return state;
      const dispensed = invoice.items.filter((it) => it.kind === 'drug' && it.dispense && it.itemId);
      return {
        ...state,
        invoices: state.invoices.map((inv) =>
          inv.id === action.id
            ? {
                ...inv,
                status: 'Paid',
                method: action.method,
                amountPaid: action.amountPaid,
                tendered: action.tendered,
                paidAt: action.paidAt,
                reference: action.reference || '',
              }
            : inv,
        ),
        inventory: state.inventory.map((item) => {
          const row = dispensed.find((d) => d.itemId === item.id);
          if (!row) return item;
          return { ...item, stock: Math.max(0, Number(item.stock) - Number(row.qty || 0)) };
        }),
      };
    }

    /* --- messaging ---------------------------------------------------------
       The pairing rule is re-checked here, not just in the UI: a patient and a
       staff member can never end up sharing a thread, whatever dispatches it. */
    case 'SEND_MESSAGE': {
      const { threadId, message, participants, subject } = action;
      const existing = threadId ? state.threads.find((t) => t.id === threadId) : null;
      const parties = existing ? existing.participants : participants;
      const [a, b] = parties ?? [];
      if (!a || !b || !canMessage(a.kind, b.kind) || !canMessage(b.kind, a.kind)) return state;

      if (existing) {
        return {
          ...state,
          threads: state.threads.map((t) =>
            t.id === threadId
              ? { ...t, messages: [...t.messages, message], updatedAt: message.at }
              : t,
          ),
        };
      }
      return {
        ...state,
        threads: [
          ...state.threads,
          {
            id: action.newThreadId,
            participants,
            subject: subject || '(no subject)',
            createdAt: message.at,
            updatedAt: message.at,
            messages: [message],
          },
        ],
      };
    }

    /* Mark everything in a thread that the viewer did not write as read. */
    case 'MARK_THREAD_READ':
      return {
        ...state,
        threads: state.threads.map((t) =>
          t.id === action.threadId
            ? {
                ...t,
                messages: t.messages.map((m) =>
                  samePartyAs(m.from, action.viewer) ? m : { ...m, read: true },
                ),
              }
            : t,
        ),
      };

    /* --- notifications ------------------------------------------------------ */
    case 'ADD_NOTIFICATION':
      return { ...state, notifications: [...state.notifications, action.notification] };

    case 'MARK_NOTIFICATION_READ':
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.id ? { ...n, read: true } : n,
        ),
      };

    case 'MARK_ALL_NOTIFICATIONS_READ':
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          samePartyAs(n.to, action.viewer) ? { ...n, read: true } : n,
        ),
      };

    /* The desk "sends" the reminder — simulated SMS, see CLAUDE.md gap 9. */
    case 'SEND_REMINDER':
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.id ? { ...n, status: 'Sent', sentAt: action.at } : n,
        ),
      };

    case 'ADD_APPOINTMENT':
      return { ...state, appointments: [...state.appointments, action.appointment] };

    case 'UPDATE_APPOINTMENT':
      return {
        ...state,
        appointments: state.appointments.map((a) => (a.id === action.id ? { ...a, ...action.patch } : a)),
      };

    case 'ADD_ITEM':
      return { ...state, inventory: [...state.inventory, action.item] };

    case 'UPDATE_ITEM':
      return {
        ...state,
        inventory: state.inventory.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i)),
      };

    case 'RESTOCK':
      return {
        ...state,
        inventory: state.inventory.map((i) =>
          i.id === action.id
            ? { ...i, stock: Number(i.stock) + Number(action.qty || 0), restockedAt: action.at }
            : i,
        ),
      };

    default:
      return state;
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return buildSeed();
    const parsed = JSON.parse(raw);
    /* Shape changed since this was written — discard rather than migrate. */
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return buildSeed();
    return parsed;
  } catch {
    return buildSeed();
  }
}

function usePersistentStore() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      /* Quota or private mode. The app keeps working in memory, but the write is
         lost on reload — say so rather than failing silently. */
      window.dispatchEvent(new CustomEvent('mc-persist-error', { detail: { message: String(err) } }));
    }
  }, [state]);

  /* Cross-tab sync: open Staff and Doctor side by side and watch the queue move. */
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORE_KEY || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue);
        if (next?.schemaVersion === SCHEMA_VERSION) dispatch({ type: 'HYDRATE', state: next });
      } catch {
        /* ignore malformed payloads from another tab */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return [state, dispatch];
}

const ClinicContext = createContext(null);
const useClinic = () => useContext(ClinicContext);

/* Selector helpers used all over the portals. */
const patientName = (p) => (p ? `${p.firstName} ${p.lastName}` : 'Unknown patient');
const doctorName = (d) => (d ? `Dr. ${d.name}` : 'Unassigned');
const findBy = (list, id) => list.find((row) => row.id === id);

/* ===== 4. PWA hooks & shell ===================================================== */

/* Real connectivity plus a demo switch, so offline behaviour can be shown on demand. */
function useNetwork() {
  const [realOnline, setRealOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [simulatedOffline, setSimulatedOffline] = useState(false);

  useEffect(() => {
    const up = () => setRealOnline(true);
    const down = () => setRealOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return {
    realOnline,
    simulatedOffline,
    setSimulatedOffline,
    online: realOnline && !simulatedOffline,
  };
}

/* main.jsx emits `mc-sw`; the registration is also polled in case the event fired
   before this component mounted. */
function useServiceWorkerState() {
  const [sw, setSw] = useState(() => (import.meta.env.PROD ? 'checking' : 'simulated'));

  useEffect(() => {
    const onEvent = (e) => setSw(e.detail?.state ?? 'unknown');
    window.addEventListener('mc-sw', onEvent);

    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => setSw(reg ? 'registered' : 'pending'))
        .catch(() => setSw('failed'));
    }
    return () => window.removeEventListener('mc-sw', onEvent);
  }, []);

  return sw;
}

function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,
  );

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return 'unavailable';
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome;
  }, [deferred]);

  return { canInstall: !!deferred, installed, promptInstall };
}

/* A ticking clock, isolated so the rest of the header doesn't re-render each second. */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hidden text-right leading-tight lg:block">
      <div className="nums text-sm font-semibold text-slate-800">
        {now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })}
      </div>
      <div className="text-[11px] text-slate-500">
        {now.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>
    </div>
  );
}

function PwaStatus() {
  const { online, realOnline, simulatedOffline, setSimulatedOffline, swState, outbox, resetDemo, toast } =
    useClinic();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const swLabel =
    swState === 'registered' ? 'Active' :
    swState === 'simulated' ? 'Simulated (dev)' :
    swState === 'failed' ? 'Failed' :
    swState === 'checking' ? 'Checking…' : 'Not registered';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'badge border transition',
          online
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{online ? 'Online' : 'Offline'}</span>
        {outbox > 0 && (
          <span className="nums ml-0.5 rounded-full bg-amber-600 px-1.5 text-[10px] font-bold text-white">
            {outbox}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Connection and app status"
          className="absolute right-0 z-40 mt-2 w-72 animate-pop-in rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">App status</span>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>

          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Network</dt>
              <dd className="font-semibold text-slate-800">{realOnline ? 'Connected' : 'No connection'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Service worker</dt>
              <dd className="font-semibold text-slate-800">{swLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Pending sync</dt>
              <dd className="nums font-semibold text-slate-800">
                {outbox > 0 ? `${outbox} change${outbox > 1 ? 's' : ''}` : 'Up to date'}
              </dd>
            </div>
          </dl>

          <label className="mt-3 flex cursor-pointer items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <CloudOff className="h-4 w-4 text-slate-400" /> Simulate offline
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal-600"
              checked={simulatedOffline}
              onChange={(e) => {
                setSimulatedOffline(e.target.checked);
                setOpen(false);
                toast(
                  e.target.checked ? 'Offline mode — changes will queue locally' : 'Back online — syncing…',
                  e.target.checked ? 'warn' : 'success',
                );
              }}
            />
          </label>

          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Writes made offline are held in a local outbox and replayed on reconnect.
          </p>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              resetDemo();
            }}
            className="btn-ghost btn-sm mt-3 w-full"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reset demo data
          </button>
        </div>
      )}
    </div>
  );
}

function InstallBanner() {
  const { canInstall, installed, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);
  const isIOS =
    typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  if (installed || dismissed) return null;
  if (!canInstall && !isIOS) return null;

  return (
    <div className="no-print border-b border-teal-200 bg-teal-50">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
        <Download className="h-4 w-4 shrink-0 text-teal-700" />
        <p className="flex-1 text-xs text-teal-900">
          {canInstall ? (
            <>Install MediClinic for offline access at the front desk.</>
          ) : (
            <>
              To install on iOS: tap <span className="font-semibold">Share</span> then{' '}
              <span className="font-semibold">Add to Home Screen</span>.
            </>
          )}
        </p>
        {canInstall && (
          <button type="button" onClick={promptInstall} className="btn-primary btn-sm">
            Install
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-teal-700 hover:text-teal-900"
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Toasts({ items, onDismiss }) {
  if (!items.length) return null;
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6">
      {items.map((t) => {
        const Icon = t.tone === 'error' ? AlertTriangle : t.tone === 'warn' ? Info : CheckCircle2;
        return (
          <div
            key={t.id}
            role="status"
            className={cx(
              'pointer-events-auto flex w-full max-w-sm animate-pop-in items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-lg',
              t.tone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : t.tone === 'warn'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-emerald-200 bg-white text-slate-800',
            )}
          >
            <Icon
              className={cx(
                'mt-0.5 h-4 w-4 shrink-0',
                t.tone === 'error' ? 'text-rose-600' : t.tone === 'warn' ? 'text-amber-600' : 'text-emerald-600',
              )}
            />
            <p className="flex-1 text-sm leading-snug">{t.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="text-slate-400 transition hover:text-slate-700"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Header() {
  const { state, role, currentUser, signOut, doctorId } = useClinic();
  const theme = ROLE_THEME[role] ?? ROLE_THEME.staff;
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const roleLabel = ROLES.find((r) => r.id === role)?.label ?? '';
  const subtitle =
    role === 'doctor'
      ? findBy(state.doctors, doctorId)?.specialty ?? roleLabel
      : role === 'staff'
        ? findBy(state.staff, currentUser.refId)?.role ?? roleLabel
        : roleLabel;

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <ClinicMark tone={theme.bg} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-bold text-slate-900">MediClinic</div>
            <div className="hidden truncate text-[11px] text-slate-500 sm:block">{state.clinic?.hours ?? CLINIC.hours}</div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <LiveClock />
          <NotificationBell />
          <PwaStatus />

          {/* Who is signed in, and the way out. */}
          <div className="relative" ref={ref}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition hover:bg-slate-100"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Avatar name={currentUser.name} tone={PARTY_TONE[role]} size="h-8 w-8 text-[10px]" />
              <span className="hidden min-w-0 text-left leading-tight md:block">
                <span className="block max-w-[11rem] truncate text-xs font-semibold text-slate-800">
                  {currentUser.name}
                </span>
                <span className="block truncate text-[10px] text-slate-500">{subtitle}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-40 mt-2 w-60 animate-pop-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
              >
                <div className="border-b border-slate-100 px-3 py-2.5">
                  <p className="truncate text-sm font-semibold text-slate-900">{currentUser.name}</p>
                  <p className="truncate text-[11px] text-slate-500">{currentUser.email}</p>
                  <p className="nums truncate text-[11px] text-slate-500">{currentUser.mobile}</p>
                  <Badge tone={PARTY_TONE[role]} className="mt-1.5">{roleLabel}</Badge>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); signOut(); }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  <LogOut className="h-4 w-4 text-slate-400" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function SubNav({ tabs, active, onChange, role }) {
  const theme = ROLE_THEME[role];
  return (
    <div className="no-print border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-2 sm:px-4">
        <nav className="thin-scroll flex gap-1 overflow-x-auto" aria-label="Section">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = t.id === active;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange(t.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cx('tab', isActive && cx('tab-active', theme.text))}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                {t.count > 0 && (
                  <span
                    className={cx(
                      'nums rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                      isActive ? cx(theme.bgSoft, theme.text) : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}


/* ===== 4b. Authentication ======================================================= */

/* The signed-in user id lives outside the store: localStorage when "remember me"
   is ticked (survives a browser restart), sessionStorage otherwise (dies with the
   tab). Either way the store itself never holds the session. */
function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.userId ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(session, remember) {
  try {
    const raw = JSON.stringify(session);
    if (remember) {
      localStorage.setItem(SESSION_KEY, raw);
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      sessionStorage.setItem(SESSION_KEY, raw);
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* private mode — the session just won't survive a reload */
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

function useSession() {
  const [session, setSession] = useState(readSession);

  const signIn = useCallback((userId, remember) => {
    const next = { userId, remember: !!remember, at: new Date().toISOString() };
    writeSession(next, remember);
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  return { session, signIn, signOut };
}

/* Sign-in by e-mail address or mobile number. */
function LoginScreen({ users, onSignIn, lastResetNote }) {
  const { state } = useClinic();
  const clinic = state?.clinic ?? CLINIC;
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  const submit = (e) => {
    e?.preventDefault();
    const user = users.find((u) => matchesIdentifier(u, identifier));
    if (!user || user.password !== password) {
      /* Don't say which half was wrong. */
      setError('We could not match that e-mail or mobile number and password.');
      return;
    }
    setError('');
    onSignIn(user, remember);
  };

  const demoAccounts = [
    { label: 'Doctor', user: users.find((u) => u.kind === 'doctor') },
    { label: 'Staff', user: users.find((u) => u.kind === 'staff') },
    { label: 'Patient', user: users.find((u) => u.kind === 'patient') },
  ].filter((r) => r.user);

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-5 flex flex-col items-center text-center">
            <ClinicMark size="h-14 w-14" rounded="rounded-2xl" icon="h-8 w-8" />
            <h1 className="text-xl font-bold text-slate-900">{clinic.name}</h1>
            <p className="text-xs text-slate-500">{clinic.tagline}</p>
          </div>

          <form onSubmit={submit} className="card card-pad space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Sign in</h2>

            {lastResetNote && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {lastResetNote}
              </p>
            )}

            <Field label="E-mail or mobile number" required>
              <input
                className="input"
                autoFocus
                autoComplete="username"
                inputMode="email"
                placeholder="you@email.ph or 0917 000 0000"
                value={identifier}
                onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
              />
            </Field>

            <Field label="Password" required>
              <input
                type="password"
                className="input"
                autoComplete="current-password"
                placeholder="••••••"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
              />
            </Field>

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="flex items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-teal-600"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember me
              </label>
              <button
                type="button"
                className="text-xs font-semibold text-teal-700 hover:underline"
                onClick={() => setForgotOpen(true)}
              >
                Forgot password?
              </button>
            </div>

            <button type="submit" className="btn-primary w-full py-2.5">
              <LogIn className="h-4 w-4" /> Sign in
            </button>

            <p className="text-center text-[11px] leading-snug text-slate-400">
              Demo build — accounts are stored in this browser only and are not secured.
              Do not use real patient details.
            </p>
          </form>

          {/* Demo convenience: the role switcher is gone, so show the way in. */}
          <div className="mt-3 text-center">
            <button
              type="button"
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
              onClick={() => setShowDemo((v) => !v)}
            >
              {showDemo ? 'Hide' : 'Show'} demo accounts
            </button>
            {showDemo && (
              <ul className="mt-2 space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 text-left">
                {demoAccounts.map((row) => (
                  <li key={row.label} className="flex items-center gap-2">
                    <Badge tone={PARTY_TONE[row.user.kind]}>{row.label}</Badge>
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-xs text-slate-600 hover:text-slate-900"
                      onClick={() => {
                        setIdentifier(row.user.email);
                        setPassword(row.user.password === DEFAULT_PASSWORD ? DEFAULT_PASSWORD : '');
                        setError('');
                      }}
                    >
                      {row.user.email}
                    </button>
                  </li>
                ))}
                <li className="border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
                  Default password <span className="nums font-bold text-slate-700">{DEFAULT_PASSWORD}</span> — you
                  will be asked to change it on first sign-in.
                </li>
              </ul>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        title="Forgot your password?"
        subtitle="The clinic resets it for you"
        size="sm"
        footer={
          <div className="flex justify-end">
            <button type="button" className="btn-primary btn-sm" onClick={() => setForgotOpen(false)}>
              Got it
            </button>
          </div>
        }
      >
        <div className="space-y-3 p-5 text-sm text-slate-700">
          <p>
            There is no self-service reset. Ask the front desk — or your doctor — to reset your
            account from their portal.
          </p>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
            They will set it back to the default password{' '}
            <span className="nums font-bold text-slate-900">{DEFAULT_PASSWORD}</span>. The next time you
            sign in you will be asked to choose a new one before you can go any further.
          </p>
          <p className="text-xs text-slate-500">
            Front desk · {clinic.phone} · {clinic.email}
          </p>
        </div>
      </Modal>
    </div>
  );
}

/* Shown over everything until a first-sign-in or reset password is replaced.
   There is no dismiss and no escape — that is the point of it. */
function ForcePasswordChange({ user, onChange, onSignOut, wasReset }) {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const submit = (e) => {
    e?.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (next === DEFAULT_PASSWORD) {
      setError('Choose something other than the default password.');
      return;
    }
    if (next !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    onChange(next);
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-sm animate-pop-in rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900">Choose a new password</h2>
            <p className="text-xs text-slate-500">
              {wasReset
                ? 'Your password was reset by the clinic. Set your own before continuing.'
                : 'You are signing in with the default password. Set your own before continuing.'}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <Field label="New password" required hint={`At least ${MIN_PASSWORD_LENGTH} characters, and not ${DEFAULT_PASSWORD}.`}>
            <input
              type="password"
              className="input"
              autoFocus
              autoComplete="new-password"
              value={next}
              onChange={(e) => { setNext(e.target.value); setError(''); }}
            />
          </Field>
          <Field label="Confirm new password" required>
            <input
              type="password"
              className="input"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(''); }}
            />
          </Field>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full py-2.5">
            <CheckCircle2 className="h-4 w-4" /> Save and continue
          </button>
          <button type="button" onClick={onSignOut} className="btn-ghost btn-sm w-full">
            Sign out instead
          </button>
        </div>

        <p className="mt-3 text-center text-[11px] text-slate-400">
          Signed in as {user?.name} · {user?.email}
        </p>
      </form>
    </div>
  );
}

/* Account list with the reset action. Doctor and staff both get this. */
function AccountsPanel({ accent = 'teal' }) {
  const { state, act, toast, me } = useClinic();
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(null);

  const q = query.trim().toLowerCase();
  const users = useMemo(() => {
    const list = state.users.slice().sort((a, b) => {
      const order = { doctor: 0, staff: 1, patient: 2 };
      return order[a.kind] - order[b.kind] || a.name.localeCompare(b.name);
    });
    if (!q) return list;
    return list.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        normalizeIdentifier(u.mobile).includes(normalizeIdentifier(q)),
    );
  }, [state.users, q]);

  const pending = state.users.filter((u) => u.mustChangePassword).length;

  const reset = (user) => {
    act({ type: 'RESET_PASSWORD', id: user.id, at: new Date().toISOString(), by: partyKey(me) });
    toast(`${user.name}'s password is back to ${DEFAULT_PASSWORD} — they must change it at next sign-in.`, 'success');
    setConfirming(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Accounts</h1>
          <p className="text-sm text-slate-500">
            Reset a password when someone is locked out. It goes back to{' '}
            <span className="nums font-semibold text-slate-700">{DEFAULT_PASSWORD}</span> and they must
            change it on their next sign-in.
          </p>
        </div>
        <Badge tone={pending ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}>
          {pending} awaiting first change
        </Badge>
      </div>

      <div className="card card-pad">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search name, e-mail or mobile number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                <th className="th">User</th>
                <th className="th">Signs in with</th>
                <th className="th">Status</th>
                <th className="th">Last sign-in</th>
                <th className="th text-right">Password</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.length === 0 && (
                <tr><td colSpan={5}><EmptyState icon={Search} title="No matching accounts" /></td></tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="row-hover">
                  <td className="td">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.name} tone={PARTY_TONE[u.kind]} size="h-8 w-8 text-[10px]" />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900">{u.name}</div>
                        <div className="text-xs capitalize text-slate-500">{u.kind}</div>
                      </div>
                    </div>
                  </td>
                  <td className="td">
                    <div className="truncate text-xs">{u.email}</div>
                    <div className="nums text-xs text-slate-500">{u.mobile}</div>
                  </td>
                  <td className="td">
                    {u.mustChangePassword ? (
                      <Badge tone="bg-amber-100 text-amber-800">
                        {u.passwordResetAt ? 'Reset — must change' : 'Default password'}
                      </Badge>
                    ) : (
                      <Badge tone="bg-emerald-100 text-emerald-700" icon={ShieldCheck}>Set</Badge>
                    )}
                  </td>
                  <td className="td text-xs">
                    {u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="text-slate-400">never</span>}
                  </td>
                  <td className="td text-right">
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(u)}>
                      <RefreshCw className="h-3.5 w-3.5" /> Reset
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title="Reset this password?"
        subtitle={confirming?.name}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(null)}>Cancel</button>
            <button type="button" className="btn-danger btn-sm" onClick={() => reset(confirming)}>
              <RefreshCw className="h-3.5 w-3.5" /> Reset password
            </button>
          </div>
        }
      >
        {confirming && (
          <div className="space-y-3 p-5 text-sm text-slate-700">
            <p>
              <strong>{confirming.name}</strong> will be signed out of nothing — but their password becomes{' '}
              <span className="nums font-bold text-slate-900">{DEFAULT_PASSWORD}</span> immediately.
            </p>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Tell them the default in person or by phone, not over chat. They will have to choose a new
              password before they can use the app again.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ===== 5. UI primitives ========================================================= */

function Badge({ children, tone = 'bg-slate-100 text-slate-600', className, icon: Icon }) {
  return (
    <span className={cx('badge', tone, className)}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

function StatusBadge({ status, className }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'bg-slate-100 text-slate-600'} className={className}>
      {status}
    </Badge>
  );
}

/* Overlays stack (a print preview opens over a chart slide-over). Escape must
   close only the topmost one, so they share a stack instead of each listening
   on the document and all firing at once. */
const escapeStack = [];

function useEscapeKey(onClose, active = true) {
  const handler = useRef(onClose);
  handler.current = onClose;

  useEffect(() => {
    if (!active) return undefined;
    const entry = { fire: () => handler.current?.() };
    escapeStack.push(entry);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (escapeStack[escapeStack.length - 1] !== entry) return;
      entry.fire();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = escapeStack.indexOf(entry);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active]);
}

function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEscapeKey(onClose, open);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size];

  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl animate-pop-in sm:rounded-2xl',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="thin-scroll flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-slate-100 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

function SlideOver({ open, onClose, title, subtitle, children, footer, width = 'max-w-2xl' }) {
  useEscapeKey(onClose, open);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="no-print fixed inset-0 z-40">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'absolute inset-y-0 right-0 flex w-full animate-slide-in flex-col bg-slate-50 shadow-2xl',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="thin-scroll flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        {footer && <div className="border-t border-slate-200 bg-white px-5 py-3">{footer}</div>}
      </aside>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone = 'slate', onClick }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    teal: 'bg-teal-50 text-teal-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    sky: 'bg-sky-50 text-sky-700',
    rose: 'bg-rose-50 text-rose-700',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx('card card-pad flex items-start gap-3 text-left', onClick && 'transition hover:shadow-md')}
    >
      <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tones[tone])}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="nums truncate text-xl font-bold leading-tight text-slate-900">{value}</div>
        {sub && <div className="truncate text-[11px] text-slate-500">{sub}</div>}
      </div>
    </Tag>
  );
}

function EmptyState({ icon: Icon = Info, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-slate-500">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function Field({ label, hint, children, className, required }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/* Deterministic pseudo-QR. Swap for a real QR library encoding a signed
   verification URL before this leaves the demo — see CLAUDE.md gap 5. */
function FakeQR({ value = '', size = 112, className }) {
  const cells = 21;
  const bits = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const out = [];
    for (let i = 0; i < cells * cells; i += 1) {
      h ^= h << 13; h >>>= 0;
      h ^= h >> 17;
      h ^= h << 5; h >>>= 0;
      out.push((h & 7) > 3);
    }
    return out;
  }, [value]);

  const isFinder = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= cells - 7) || (r >= cells - 7 && c < 7);

  const finderCell = (r, c) => {
    const rr = r >= cells - 7 ? r - (cells - 7) : r;
    const cc = c >= cells - 7 ? c - (cells - 7) : c;
    const ring = Math.max(Math.abs(rr - 3), Math.abs(cc - 3));
    return ring === 3 || ring <= 1;
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${cells} ${cells}`}
      className={cx('rounded bg-white', className)}
      role="img"
      aria-label="Verification QR code (demo)"
      shapeRendering="crispEdges"
    >
      <rect width={cells} height={cells} fill="#fff" />
      {Array.from({ length: cells }).map((_, r) =>
        Array.from({ length: cells }).map((__, c) => {
          const on = isFinder(r, c) ? finderCell(r, c) : bits[r * cells + c];
          return on ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#0f172a" /> : null;
        }),
      )}
    </svg>
  );
}

function VitalsStrip({ vitals, className, compact }) {
  if (!vitals) return null;
  const bp = bpFlag(vitals.bp);
  const temp = tempFlag(vitals.temp);
  const bmi = bmiOf(vitals);
  const shown = [
    vitals.bp && { label: 'BP', value: vitals.bp, unit: 'mmHg', flag: bp },
    vitals.hr && { label: 'HR', value: vitals.hr, unit: 'bpm' },
    vitals.rr && { label: 'RR', value: vitals.rr, unit: '/min' },
    vitals.temp && { label: 'Temp', value: vitals.temp, unit: '°C', flag: temp },
    vitals.spo2 && { label: 'SpO₂', value: vitals.spo2, unit: '%' },
    vitals.weight && { label: 'Wt', value: vitals.weight, unit: 'kg' },
    bmi && !compact && { label: 'BMI', value: bmi, unit: '' },
  ].filter(Boolean);

  if (!shown.length) {
    return <p className={cx('text-xs italic text-slate-400', className)}>No vitals recorded</p>;
  }

  return (
    <div className={cx('flex flex-wrap gap-x-4 gap-y-1.5', className)}>
      {shown.map((v) => (
        <div key={v.label} className="flex items-baseline gap-1">
          <span className="text-[11px] font-semibold uppercase text-slate-400">{v.label}</span>
          <span
            className={cx(
              'nums text-sm font-semibold',
              v.flag?.tone === 'rose' ? 'text-rose-600' : v.flag?.tone === 'amber' ? 'text-amber-600' : 'text-slate-800',
            )}
          >
            {v.value}
          </span>
          {v.unit && <span className="text-[10px] text-slate-400">{v.unit}</span>}
        </div>
      ))}
    </div>
  );
}

function AllergyBadges({ patient, className }) {
  const allergies = patient?.allergies ?? [];
  if (!allergies.length) {
    return (
      <Badge tone="bg-slate-100 text-slate-500" className={className} icon={ShieldCheck}>
        No known allergies
      </Badge>
    );
  }
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)}>
      {allergies.map((a) => (
        <Badge key={a} tone="bg-rose-100 text-rose-700" icon={AlertTriangle}>
          {a}
        </Badge>
      ))}
    </div>
  );
}

/* The clinic's mark: the uploaded logo when there is one, else the default cross. */
function ClinicMark({ size = 'h-9 w-9', rounded = 'rounded-lg', icon = 'h-5 w-5', tone = 'bg-teal-600' }) {
  const { state } = useClinic();
  const logo = state?.clinic?.logo;
  if (logo) {
    return <img src={logo} alt="" className={cx('shrink-0 bg-white object-contain', size, rounded)} />;
  }
  return (
    <span className={cx('grid shrink-0 place-items-center text-white', size, rounded, tone)}>
      <Plus className={icon} strokeWidth={3} />
    </span>
  );
}

function Avatar({ name, tone = 'bg-slate-200 text-slate-600', size = 'h-9 w-9 text-xs' }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-full font-bold', tone, size)}>
      {initials(name)}
    </span>
  );
}

/* Single-series magnitude-over-time: one hue, bars anchored to the baseline,
   rounded data-ends, 2px gaps, peak labelled directly (no legend for one series). */
function HourlyBars({ data, accent = 'teal' }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0] ?? { value: 0 });
  const fill = { teal: 'bg-teal-600', sky: 'bg-sky-600', indigo: 'bg-indigo-600' }[accent];

  return (
    <div>
      <div className="flex h-28 items-end gap-0.5" role="img" aria-label="Check-ins by hour">
        {data.map((d) => {
          const pct = (d.value / max) * 100;
          return (
            <div key={d.label} className="group relative flex h-full flex-1 flex-col justify-end">
              {d.value === peak.value && d.value > 0 && (
                <span className="nums mb-1 text-center text-[10px] font-bold text-slate-600">{d.value}</span>
              )}
              <div
                className={cx(
                  'w-full rounded-t transition-opacity',
                  d.value > 0 ? fill : 'bg-slate-100',
                  'group-hover:opacity-80',
                )}
                style={{ height: d.value > 0 ? `${Math.max(6, pct)}%` : '3px' }}
              />
              {/* Hover layer: an HTML chart is interactive by default. */}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-white group-hover:block">
                {d.label} · {d.value} check-in{d.value === 1 ? '' : 's'}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-0.5 border-t border-slate-100 pt-1.5">
        {data.map((d, i) => (
          <div key={d.label} className="flex-1 text-center text-[10px] text-slate-400">
            {i % 2 === 0 ? d.short : ''}
          </div>
        ))}
      </div>
    </div>
  );
}


/* ===== 5b. Messaging & notifications ============================================ */

/* Display name for a participant, whichever directory they live in. */
function partyName(state, party) {
  if (!party) return 'Unknown';
  if (party.kind === 'doctor') return doctorName(findBy(state.doctors, party.id));
  if (party.kind === 'patient') return patientName(findBy(state.patients, party.id));
  const s = findBy(state.staff, party.id);
  return s ? s.name : 'Front desk';
}

function partySubtitle(state, party) {
  if (!party) return '';
  if (party.kind === 'doctor') return findBy(state.doctors, party.id)?.specialty ?? '';
  if (party.kind === 'patient') {
    const p = findBy(state.patients, party.id);
    return p ? `${p.id} · ${ageLabel(p.dob)} · ${p.sex}` : '';
  }
  return findBy(state.staff, party.id)?.role ?? '';
}

const PARTY_TONE = {
  doctor: 'bg-teal-100 text-teal-700',
  patient: 'bg-indigo-100 text-indigo-700',
  staff: 'bg-sky-100 text-sky-700',
};

const threadsFor = (state, me) =>
  (state.threads ?? [])
    .filter((t) => t.participants.some((p) => samePartyAs(p, me)))
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const otherParty = (thread, me) => thread.participants.find((p) => !samePartyAs(p, me));

const unreadInThread = (thread, me) =>
  thread.messages.filter((m) => !m.read && !samePartyAs(m.from, me)).length;

const unreadThreadCount = (state, me) =>
  threadsFor(state, me).reduce((n, t) => n + (unreadInThread(t, me) > 0 ? 1 : 0), 0);

const notificationsFor = (state, me) =>
  (state.notifications ?? [])
    .filter((n) => samePartyAs(n.to, me))
    .slice()
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

/* Follow-ups the desk should be chasing: due within the lead window, or overdue. */
const dueReminders = (state) =>
  (state.notifications ?? [])
    .filter((n) => n.kind === 'follow-up' && n.status !== 'Sent' && daysUntil(n.dueDate) <= REMINDER_LEAD_DAYS)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

function NotificationBell() {
  const { state, me, act } = useClinic();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const items = useMemo(() => notificationsFor(state, me), [state, me]);
  const unread = items.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
      >
        {unread > 0 ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        {unread > 0 && (
          <span className="nums absolute -right-0.5 -top-0.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-80 animate-pop-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                className="text-[11px] font-semibold text-teal-700 hover:underline"
                onClick={() => act({ type: 'MARK_ALL_NOTIFICATIONS_READ', viewer: me }, { silent: true })}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="thin-scroll max-h-80 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-slate-400">Nothing yet.</p>
            )}
            {items.map((n) => {
              const meta = NOTIFICATION_KINDS[n.kind] ?? NOTIFICATION_KINDS.message;
              const Icon = meta.icon;
              const days = n.dueDate ? daysUntil(n.dueDate) : null;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => act({ type: 'MARK_NOTIFICATION_READ', id: n.id }, { silent: true })}
                  className={cx(
                    'flex w-full gap-2.5 border-b border-slate-50 px-3 py-2.5 text-left transition hover:bg-slate-50',
                    !n.read && 'bg-teal-50/40',
                  )}
                >
                  <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg', meta.tone)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-slate-900">{n.title}</span>
                      {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600" />}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-600">{n.body}</span>
                    {n.dueDate && (
                      <span
                        className={cx(
                          'mt-1 block text-[10px] font-semibold',
                          days < 0 ? 'text-rose-600' : days <= 3 ? 'text-amber-600' : 'text-slate-400',
                        )}
                      >
                        {days < 0
                          ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
                          : days === 0
                            ? 'Due today'
                            : `Due in ${days} day${days === 1 ? '' : 's'} · ${fmtDate(n.dueDate)}`}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <DeviceNotificationSetting />
        </div>
      )}
    </div>
  );
}

/* Two-pane inbox shared by all three portals. The recipient list is built from
   MESSAGING_RULES, so the patient↔staff pairing simply has nobody to pick. */
function MessagesPanel({ accent = 'teal' }) {
  const { state, me, act, toast } = useClinic();
  const threads = useMemo(() => threadsFor(state, me), [state, me]);

  const [activeId, setActiveId] = useState(null);
  const [body, setBody] = useState('');
  const [composing, setComposing] = useState(false);
  const [toKey, setToKey] = useState('');
  const [subject, setSubject] = useState('');
  const endRef = useRef(null);

  const active = threads.find((t) => t.id === activeId) ?? null;

  /* Opening a thread clears its unread marks — an autoread, so keep it silent. */
  useEffect(() => {
    if (!active) return;
    if (unreadInThread(active, me) > 0) {
      act({ type: 'MARK_THREAD_READ', threadId: active.id, viewer: me }, { silent: true });
    }
  }, [active, me, act]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [active?.messages.length, activeId]);

  /* Everyone this role is allowed to start a thread with. */
  const recipients = useMemo(() => {
    const kinds = MESSAGING_RULES[me.kind] ?? [];
    const out = [];
    if (kinds.includes('doctor')) {
      for (const d of state.doctors) out.push({ kind: 'doctor', id: d.id, label: `Dr. ${d.name}`, sub: d.specialty });
    }
    if (kinds.includes('patient')) {
      for (const p of state.patients) out.push({ kind: 'patient', id: p.id, label: patientName(p), sub: `${p.id} · ${ageLabel(p.dob)}` });
    }
    if (kinds.includes('staff')) {
      for (const s of state.staff) out.push({ kind: 'staff', id: s.id, label: s.name, sub: s.role });
    }
    return out.filter((r) => !samePartyAs(r, me));
  }, [state.doctors, state.patients, state.staff, me]);

  const send = () => {
    const text = body.trim();
    if (!text || !active) return;
    act({
      type: 'SEND_MESSAGE',
      threadId: active.id,
      message: { id: `MSG-${Date.now()}`, from: me, body: text, at: new Date().toISOString(), read: false },
    });
    setBody('');
  };

  const startThread = () => {
    const [kind, id] = toKey.split(':');
    if (!kind || !id) {
      toast('Pick who you want to message.', 'warn');
      return;
    }
    if (!body.trim()) {
      toast('Write a message first.', 'warn');
      return;
    }
    if (!canMessage(me.kind, kind)) {
      toast('That conversation is not allowed.', 'error');
      return;
    }
    const to = { kind, id };
    const existing = threads.find((t) => samePartyAs(otherParty(t, me), to));
    const message = { id: `MSG-${Date.now()}`, from: me, body: body.trim(), at: new Date().toISOString(), read: false };

    if (existing) {
      act({ type: 'SEND_MESSAGE', threadId: existing.id, message });
      setActiveId(existing.id);
    } else {
      const newThreadId = nextId('T', state.threads);
      act({
        type: 'SEND_MESSAGE',
        newThreadId,
        participants: [me, to],
        subject: subject.trim() || 'New conversation',
        message,
      });
      setActiveId(newThreadId);
    }
    setBody('');
    setSubject('');
    setToKey('');
    setComposing(false);
    toast(`Message sent to ${partyName(state, to)}`, 'success');
  };

  const btn = { teal: 'btn-primary', indigo: 'btn-indigo', sky: 'btn-sky' }[accent];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Messages</h1>
          <p className="text-sm text-slate-500">
            {me.kind === 'doctor' && 'Your patients and the clinic team.'}
            {me.kind === 'patient' && 'Your doctors. For billing or scheduling, call the front desk.'}
            {me.kind === 'staff' && 'The doctors. Patient questions go through their attending doctor.'}
          </p>
        </div>
        <button type="button" className={cx(btn, 'btn-sm')} onClick={() => { setComposing(true); setActiveId(null); }}>
          <Plus className="h-3.5 w-3.5" /> New message
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
        {/* Thread list */}
        <section className="card overflow-hidden">
          <div className="card-head">
            <h2 className="card-title">Inbox</h2>
            <Badge tone="bg-slate-100 text-slate-500">{threads.length}</Badge>
          </div>
          <ul className="thin-scroll max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
            {threads.length === 0 && (
              <li><EmptyState icon={MessageSquare} title="No conversations yet" hint="Start one with the button above." /></li>
            )}
            {threads.map((t) => {
              const who = otherParty(t, me);
              const unread = unreadInThread(t, me);
              const last = t.messages[t.messages.length - 1];
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => { setActiveId(t.id); setComposing(false); }}
                    className={cx(
                      'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-slate-50',
                      activeId === t.id && 'bg-slate-50',
                    )}
                  >
                    <Avatar name={partyName(state, who)} tone={PARTY_TONE[who?.kind]} size="h-8 w-8 text-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">{partyName(state, who)}</span>
                        <span className="shrink-0 text-[10px] text-slate-400">{fmtTime(t.updatedAt)}</span>
                      </span>
                      <span className="block truncate text-xs text-slate-500">{t.subject}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                        {samePartyAs(last.from, me) ? 'You: ' : ''}{last.body}
                      </span>
                    </span>
                    {unread > 0 && (
                      <span className="nums mt-1 grid h-4 min-w-[1rem] shrink-0 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                        {unread}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Conversation / composer */}
        <section className="card flex min-h-[28rem] flex-col overflow-hidden">
          {composing ? (
            <>
              <div className="card-head"><h2 className="card-title">New message</h2></div>
              <div className="space-y-3 p-4">
                <Field label="To" required>
                  <select className="input" value={toKey} onChange={(e) => setToKey(e.target.value)}>
                    <option value="">Select a recipient…</option>
                    {['doctor', 'patient', 'staff']
                      .filter((k) => recipients.some((r) => r.kind === k))
                      .map((kind) => (
                        <optgroup key={kind} label={kind === 'doctor' ? 'Doctors' : kind === 'patient' ? 'Patients' : 'Clinic team'}>
                          {recipients.filter((r) => r.kind === kind).map((r) => (
                            <option key={partyKey(r)} value={partyKey(r)}>{r.label} — {r.sub}</option>
                          ))}
                        </optgroup>
                      ))}
                  </select>
                </Field>
                <Field label="Subject">
                  <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Question about my maintenance" />
                </Field>
                <Field label="Message" required>
                  <textarea className="input min-h-[120px] resize-y" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type your message…" />
                </Field>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setComposing(false)}>Cancel</button>
                  <button type="button" className={cx(btn, 'btn-sm')} onClick={startThread}>
                    <Send className="h-3.5 w-3.5" /> Send
                  </button>
                </div>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-500">
                  {me.kind === 'patient'
                    ? 'You can only message doctors. Billing, scheduling and records requests are handled by the front desk over the phone or in person.'
                    : me.kind === 'staff'
                      ? 'The front desk can only message doctors. Anything a patient needs to hear goes through their attending doctor.'
                      : 'You can message your patients and the clinic team.'}
                </p>
              </div>
            </>
          ) : active ? (
            <>
              <div className="card-head">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={partyName(state, otherParty(active, me))} tone={PARTY_TONE[otherParty(active, me)?.kind]} size="h-8 w-8 text-[10px]" />
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-bold text-slate-900">{partyName(state, otherParty(active, me))}</h2>
                    <p className="truncate text-[11px] text-slate-500">{partySubtitle(state, otherParty(active, me))}</p>
                  </div>
                </div>
                <Badge tone="bg-slate-100 text-slate-500">{active.subject}</Badge>
              </div>

              <div className="thin-scroll flex-1 space-y-2.5 overflow-y-auto bg-slate-50 p-4">
                {active.messages.map((m) => {
                  const mine = samePartyAs(m.from, me);
                  return (
                    <div key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                      <div className={cx('max-w-[80%] rounded-2xl px-3.5 py-2 shadow-sm', mine ? 'bg-slate-900 text-white' : 'bg-white text-slate-800')}>
                        <p className="whitespace-pre-wrap text-sm leading-snug">{m.body}</p>
                        <p className={cx('mt-1 text-[10px]', mine ? 'text-slate-400' : 'text-slate-400')}>
                          {fmtDateTime(m.at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              <div className="flex items-end gap-2 border-t border-slate-100 p-3">
                <textarea
                  className="input min-h-[44px] resize-y"
                  rows={1}
                  placeholder="Write a reply…"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <button type="button" className={cx(btn, 'shrink-0')} onClick={send} disabled={!body.trim()}>
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="Select a conversation"
              hint="Or start a new one. Enter sends; Shift+Enter adds a line."
            />
          )}
        </section>
      </div>
    </div>
  );
}


/* Follow-up reminders the patient can see and act on. Raised by the doctor when a
   follow-up date is set on the consultation note. */
function PatientReminders({ patient }) {
  const { state, me, act } = useClinic();

  const reminders = useMemo(
    () =>
      notificationsFor(state, me)
        .filter((n) => n.kind === 'follow-up')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [state, me],
  );

  if (!reminders.length) return null;

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Follow-up reminders</h2>
        <Badge tone="bg-indigo-100 text-indigo-700">{reminders.length}</Badge>
      </div>
      <ul className="divide-y divide-slate-100">
        {reminders.map((n) => {
          const days = daysUntil(n.dueDate);
          const overdue = days < 0;
          const soon = days >= 0 && days <= 3;
          const encounter = findBy(state.encounters, n.encounterId);
          return (
            <li key={n.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <span
                className={cx(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                  overdue ? 'bg-rose-100 text-rose-700' : soon ? 'bg-amber-100 text-amber-800' : 'bg-indigo-50 text-indigo-700',
                )}
              >
                <CalendarClock className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                  {!n.read && <Badge tone="bg-teal-100 text-teal-700">New</Badge>}
                  {n.status === 'Sent' && (
                    <Badge tone="bg-slate-100 text-slate-500" icon={CheckCircle2}>Reminder sent</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-600">{n.body}</p>
                <p
                  className={cx(
                    'mt-1 text-[11px] font-semibold',
                    overdue ? 'text-rose-600' : soon ? 'text-amber-600' : 'text-slate-500',
                  )}
                >
                  {overdue
                    ? `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} — please book a visit`
                    : days === 0
                      ? 'Due today'
                      : `Due ${fmtDate(n.dueDate)} · in ${days} day${days === 1 ? '' : 's'}`}
                  {encounter ? ` · from your ${fmtDate(encounter.date)} visit` : ''}
                </p>
              </div>
              {!n.read && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => act({ type: 'MARK_NOTIFICATION_READ', id: n.id }, { silent: true })}
                >
                  Got it
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* The desk's chase list: follow-ups coming due (or overdue) that nobody has sent
   a reminder for yet. Sending is a simulated SMS — see CLAUDE.md gap 9. */
function FollowUpQueue() {
  const { state, act, toast } = useClinic();
  const due = useMemo(() => dueReminders(state), [state]);
  const upcoming = useMemo(
    () =>
      (state.notifications ?? [])
        .filter((n) => n.kind === 'follow-up' && daysUntil(n.dueDate) > REMINDER_LEAD_DAYS)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [state.notifications],
  );

  const sendOne = (n) => {
    const patient = findBy(state.patients, n.to.id);
    act({ type: 'SEND_REMINDER', id: n.id, at: new Date().toISOString() });
    toast(`Reminder sent to ${patientName(patient)} · ${patient?.mobile ?? ''} (simulated SMS)`, 'success');
  };

  const sendAll = () => {
    if (!due.length) return;
    const at = new Date().toISOString();
    for (const n of due) act({ type: 'SEND_REMINDER', id: n.id, at });
    toast(`${due.length} follow-up reminder${due.length > 1 ? 's' : ''} sent (simulated SMS)`, 'success');
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Follow-ups to chase</h2>
        <div className="flex items-center gap-2">
          <Badge tone={due.length ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}>
            {due.length} due
          </Badge>
          {due.length > 0 && (
            <button type="button" className="btn-sky btn-sm" onClick={sendAll}>
              <Send className="h-3.5 w-3.5" /> Send all
            </button>
          )}
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {due.length === 0 && (
          <li>
            <EmptyState
              icon={CalendarClock}
              title="Nothing due this week"
              hint={`Reminders appear ${REMINDER_LEAD_DAYS} days before the follow-up date.`}
            />
          </li>
        )}
        {due.map((n) => {
          const patient = findBy(state.patients, n.to.id);
          const days = daysUntil(n.dueDate);
          return (
            <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar name={patientName(patient)} tone="bg-sky-100 text-sky-700" size="h-8 w-8 text-[10px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{patientName(patient)}</p>
                <p className="truncate text-xs text-slate-500">{n.title}</p>
                <p className="nums text-[11px] text-slate-400">{patient?.mobile}</p>
              </div>
              <div className="text-right">
                <p className={cx('text-xs font-semibold', days < 0 ? 'text-rose-600' : 'text-amber-600')}>
                  {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `in ${days}d`}
                </p>
                <p className="text-[11px] text-slate-400">{fmtDate(n.dueDate)}</p>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => sendOne(n)}>
                <Send className="h-3.5 w-3.5" /> Send
              </button>
            </li>
          );
        })}
      </ul>

      {upcoming.length > 0 && (
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          {upcoming.length} more follow-up{upcoming.length > 1 ? 's' : ''} scheduled further out — next on{' '}
          {fmtDate(upcoming[0].dueDate)}.
        </p>
      )}
    </section>
  );
}


/* ===== 5c. Device notifications ================================================= */

/* Real system notifications, raised on the device by the page or its service
   worker. NOT web push: there is no server and no VAPID subscription, so these
   only fire while the app is open somewhere on that device — a backgrounded tab
   or an installed PWA counts, a closed browser does not (CLAUDE.md gap 9).
   On iOS the app must be installed to the Home Screen before this works at all. */
const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

function useDeviceNotifications() {
  const [permission, setPermission] = useState(() =>
    notificationsSupported() ? Notification.permission : 'unsupported',
  );

  const request = useCallback(async () => {
    if (!notificationsSupported()) return 'unsupported';
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch {
      return 'denied';
    }
  }, []);

  /* Prefer the service worker: its notifications outlive the page and can be
     clicked to bring the app back. Fall back to a page notification in dev. */
  const notify = useCallback(
    async ({ title, body, tag, url = '/', renotify = false }) => {
      if (!notificationsSupported() || Notification.permission !== 'granted') return false;
      const options = {
        body,
        tag,
        renotify,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url },
      };
      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            await reg.showNotification(title, options);
            return true;
          }
        }
        new Notification(title, options);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  return { permission, request, notify, supported: notificationsSupported() };
}

/* Watches the store for things addressed to the signed-in user and raises one
   device notification each. Everything already present when the hook mounts is
   marked seen, so a reload never replays the backlog. */
function DeviceNotifier() {
  const { state, me, role, deviceNotifications: device, toast } = useClinic();
  const seenReminders = useRef(null);
  const seenMessages = useRef(null);

  /* Follow-up reminders the clinic has actually sent. */
  useEffect(() => {
    const sent = (state.notifications ?? []).filter(
      (n) => samePartyAs(n.to, me) && n.status === 'Sent',
    );
    if (seenReminders.current === null) {
      seenReminders.current = new Set(sent.map((n) => n.id));
      return;
    }
    for (const n of sent) {
      if (seenReminders.current.has(n.id)) continue;
      seenReminders.current.add(n.id);
      const meta = NOTIFICATION_KINDS[n.kind] ?? NOTIFICATION_KINDS.message;
      device.notify({
        title: `${meta.label}: ${n.title}`,
        body: n.dueDate ? `${n.body} (due ${fmtDate(n.dueDate)})` : n.body,
        tag: `reminder-${n.id}`,
      });
      toast(`${n.title} — reminder received`, 'success');
    }
  }, [state.notifications, me, device, toast]);

  /* Incoming messages — anything in my threads that someone else wrote. */
  useEffect(() => {
    const mine = threadsFor(state, me);
    const incoming = mine.flatMap((t) =>
      t.messages.filter((m) => !samePartyAs(m.from, me)).map((m) => ({ ...m, thread: t })),
    );
    if (seenMessages.current === null) {
      seenMessages.current = new Set(incoming.map((m) => m.id));
      return;
    }
    for (const m of incoming) {
      if (seenMessages.current.has(m.id)) continue;
      seenMessages.current.add(m.id);
      const who = partyName(state, m.from);
      device.notify({
        title: `New message from ${who}`,
        body: m.body.length > 120 ? `${m.body.slice(0, 117)}…` : m.body,
        tag: `thread-${m.thread.id}`,
        renotify: true,
      });
      toast(`New message from ${who}`, 'success');
    }
  }, [state.threads, state, me, device, toast]);

  /* Rendered for its effects only. */
  return null;
}

/* The enable/disable control, shown inside the notification bell. */
function DeviceNotificationSetting() {
  const { deviceNotifications: device, toast } = useClinic();
  const { permission, request, notify, supported } = device;

  if (!supported) {
    return (
      <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
        This browser cannot show device notifications.
      </p>
    );
  }

  if (permission === 'denied') {
    return (
      <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-amber-700">
        Notifications are blocked for this site. Allow them in your browser&apos;s site settings to get
        follow-up reminders and messages on this device.
      </p>
    );
  }

  if (permission === 'granted') {
    return (
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
          <BellRing className="h-3.5 w-3.5" /> Device notifications on
        </span>
        <button
          type="button"
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
          onClick={async () => {
            const shown = await notify({
              title: 'MediClinic',
              body: 'Notifications are working on this device.',
              tag: 'test',
              renotify: true,
            });
            toast(shown ? 'Test notification sent' : 'Could not show a notification', shown ? 'success' : 'error');
          }}
        >
          Send a test
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        const result = await request();
        toast(
          result === 'granted'
            ? 'Device notifications enabled'
            : 'Notifications were not allowed — you will still see reminders in the app.',
          result === 'granted' ? 'success' : 'warn',
        );
      }}
      className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left transition hover:bg-slate-50"
    >
      <BellRing className="h-4 w-4 shrink-0 text-teal-600" />
      <span>
        <span className="block text-xs font-semibold text-slate-800">Turn on device notifications</span>
        <span className="block text-[11px] text-slate-500">
          Follow-up reminders and new messages pop up on this device.
        </span>
      </span>
    </button>
  );
}

/* ===== 6. Print Center & documents ============================================== */

/* Every printable document renders through PrintCenter so it lands in #print-root,
   which @media print promotes to the whole page. Do not print from the app tree. */

function DocLetterhead({ docTitle, meta }) {
  const { state } = useClinic();
  /* Portals preserve context, so this works inside #print-root too. */
  const clinic = state?.clinic ?? CLINIC;
  return (
    <header className="avoid-break mb-5 border-b-2 border-slate-800 pb-3">
      <div className="flex items-start gap-3">
        <ClinicMark size="h-12 w-12" icon="h-7 w-7" tone="bg-teal-700" />
        <div className="flex-1">
          <h1 className="font-serif text-xl font-bold leading-tight text-slate-900">{clinic.name}</h1>
          <p className="text-[11px] text-slate-600">{clinic.tagline}</p>
          <p className="mt-1 text-[10px] leading-snug text-slate-500">
            {clinic.address} · Tel {clinic.phone} · {clinic.email}
          </p>
          <p className="text-[10px] text-slate-500">
            DOH LTO No. {clinic.lto} · TIN {clinic.tin}
          </p>
        </div>
        {meta && <div className="text-right text-[10px] leading-snug text-slate-500">{meta}</div>}
      </div>
      {docTitle && (
        <h2 className="mt-3 text-center font-serif text-lg font-bold uppercase tracking-wide text-slate-900">
          {docTitle}
        </h2>
      )}
    </header>
  );
}

function DocSignature({ doctor, label = 'Attending Physician', showLicenses = true }) {
  return (
    <div className="avoid-break mt-10 flex justify-end">
      <div className="w-64 text-center">
        {/* Placeholder — no e-signature capture yet (CLAUDE.md gap 5). */}
        <div className="mb-1 h-10 border-b border-slate-400" />
        <p className="font-serif text-sm font-bold text-slate-900">
          {doctor ? `${doctor.name}, ${doctor.title}` : '—'}
        </p>
        <p className="text-[10px] text-slate-600">{doctor?.specialty}</p>
        <p className="text-[10px] text-slate-500">{label}</p>
        {showLicenses && doctor && (
          <p className="mt-1 text-[10px] leading-snug text-slate-500">
            PRC No. {doctor.prc} · PTR No. {doctor.ptr}
            <br />
            S2 No. {doctor.s2}
          </p>
        )}
      </div>
    </div>
  );
}

function DocPatientLine({ patient, extra }) {
  return (
    <dl className="avoid-break mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-4">
      <div className="col-span-2">
        <dt className="font-semibold uppercase tracking-wide text-slate-400">Patient</dt>
        <dd className="font-semibold text-slate-900">{patientName(patient)}</dd>
      </div>
      <div>
        <dt className="font-semibold uppercase tracking-wide text-slate-400">Age / Sex</dt>
        <dd className="text-slate-800">
          {patient ? `${ageFrom(patient.dob)} / ${patient.sex?.[0] ?? '—'}` : '—'}
        </dd>
      </div>
      <div>
        <dt className="font-semibold uppercase tracking-wide text-slate-400">Patient No.</dt>
        <dd className="nums text-slate-800">{patient?.id ?? '—'}</dd>
      </div>
      {extra}
    </dl>
  );
}

function PrescriptionDoc({ encounter, patient, doctor }) {
  const { state } = useClinic();
  const tpl = state?.rxTemplate ?? {};
  const meds = encounter?.meds ?? [];
  return (
    <article className="print-doc bg-white p-8 font-sans text-slate-900">
      <DocLetterhead
        docTitle={tpl.heading || 'Prescription'}
        meta={
          <>
            <div>Date: {fmtDate(encounter?.date)}</div>
            <div className="nums">Rx No. {encounter?.id ?? '—'}</div>
          </>
        }
      />
      <DocPatientLine
        patient={patient}
        extra={
          tpl.showWeight !== false ? (
            <div>
              <dt className="font-semibold uppercase tracking-wide text-slate-400">Weight</dt>
              <dd className="nums text-slate-800">
                {encounter?.vitals?.weight ? `${encounter.vitals.weight} kg` : '—'}
              </dd>
            </div>
          ) : null
        }
      />

      <div className="flex gap-4">
        <span className="font-serif text-5xl font-bold leading-none text-slate-900">℞</span>
        <ol className="flex-1 space-y-4">
          {meds.length === 0 && <li className="text-sm italic text-slate-400">No medications prescribed.</li>}
          {meds.map((m, i) => {
            const freq = FREQUENCIES.find((f) => f.code === m.freq);
            return (
              <li key={m.id ?? i} className="avoid-break border-b border-dashed border-slate-200 pb-3">
                <div className="flex items-baseline justify-between gap-4">
                  {/* Generic names per R.A. 6675 (Generics Act). */}
                  <p className="font-serif text-base font-bold text-slate-900">
                    {m.name} {m.strength}
                  </p>
                  <p className="nums shrink-0 text-sm font-semibold text-slate-700">
                    #{m.qty} {m.form?.toLowerCase()}
                    {Number(m.qty) > 1 ? 's' : ''}
                  </p>
                </div>
                <p className="mt-0.5 text-sm text-slate-700">
                  Sig: Take {m.route === 'PO' ? 'orally' : m.route?.toLowerCase()} {freq?.sig ?? m.freq}
                  {Number(m.days) > 0 && m.freq !== 'PRN' ? ` for ${m.days} day${Number(m.days) > 1 ? 's' : ''}` : ''}.
                </p>
                {m.instructions && <p className="text-[11px] italic text-slate-600">{m.instructions}</p>}
              </li>
            );
          })}
        </ol>
      </div>

      {tpl.showAllergies !== false && patient?.allergies?.length > 0 && (
        <p className="avoid-break mt-5 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
          <strong>Known allergies:</strong> {patient.allergies.join(', ')}
        </p>
      )}

      {encounter?.medsAmendedAt && (
        <p className="avoid-break mt-4 text-[11px] font-medium text-slate-700">
          Amended {fmtDate(ymd(new Date(encounter.medsAmendedAt)))}
          {encounter.medsAmendedBy ? ` by ${encounter.medsAmendedBy}` : ''} — this copy supersedes the
          prescription issued {fmtDate(encounter.date)}.
        </p>
      )}

      {tpl.showStandingInstructions && tpl.standingInstructions && (
        <p className="avoid-break mt-4 text-[11px] italic leading-snug text-slate-700">
          {tpl.standingInstructions}
        </p>
      )}

      <DocSignature
        doctor={doctor}
        label={tpl.signatureLabel || 'Attending Physician'}
        showLicenses={tpl.showLicenses !== false}
      />
      <footer className="mt-8 border-t border-slate-200 pt-2 text-center text-[9px] leading-snug text-slate-400">
        {tpl.footerNote}
      </footer>
    </article>
  );
}

function MedicalCertificateDoc({ encounter, patient, doctor, kind = 'certificate', restDays = 2, purpose = '' }) {
  const { state } = useClinic();
  const clinic = state?.clinic ?? CLINIC;
  const isAbstract = kind === 'abstract';
  const dx = (encounter?.diagnoses ?? []).map((d) => d.label).join('; ') || 'For evaluation';
  return (
    <article className="print-doc bg-white p-8 font-sans text-slate-900">
      <DocLetterhead
        docTitle={isAbstract ? 'Medical Abstract' : 'Medical Certificate'}
        meta={
          <>
            <div>Date issued: {fmtDate(ymd())}</div>
            <div className="nums">Ref. {encounter?.id ?? '—'}</div>
          </>
        }
      />

      {!isAbstract && <p className="mb-4 text-sm font-semibold text-slate-700">TO WHOM IT MAY CONCERN:</p>}

      <DocPatientLine
        patient={patient}
        extra={
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Date seen</dt>
            <dd className="text-slate-800">{fmtDate(encounter?.date)}</dd>
          </div>
        }
      />

      {isAbstract ? (
        <div className="space-y-3 text-[12px] leading-relaxed">
          {[
            ['Chief complaint', encounter?.chiefComplaint],
            ['History of present illness', encounter?.soap?.s],
            ['Physical examination', encounter?.soap?.o],
            ['Diagnosis', dx],
            ['Management', encounter?.soap?.p],
          ].map(([label, value]) => (
            <section key={label} className="avoid-break">
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</h3>
              <p className="whitespace-pre-wrap text-slate-800">{value || '—'}</p>
            </section>
          ))}
          {encounter?.meds?.length > 0 && (
            <section className="avoid-break">
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Medications given</h3>
              <ul className="list-inside list-disc text-slate-800">
                {encounter.meds.map((m, i) => (
                  <li key={m.id ?? i}>
                    {m.name} {m.strength} — {m.freq} x {m.days} day(s)
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-[13px] leading-relaxed text-slate-800">
          <p className="indent-8">
            This is to certify that <strong>{patientName(patient)}</strong>,{' '}
            {patient ? `${ageFrom(patient.dob)} years old, ${patient.sex?.toLowerCase()}` : '—'}, of{' '}
            {patient?.address ?? '—'}, was examined and treated at this clinic on{' '}
            <strong>{fmtLongDate(encounter?.date)}</strong>.
          </p>
          <p className="indent-8">
            Working impression: <strong>{dx}</strong>.
          </p>
          {restDays > 0 && (
            <p className="indent-8">
              The patient is advised to rest for <strong>{restDays} day{restDays > 1 ? 's' : ''}</strong> from{' '}
              {fmtLongDate(encounter?.date)}, and may resume normal duties thereafter barring any complication.
            </p>
          )}
          <p className="indent-8">
            This certification is issued upon the request of the patient{purpose ? ` for ${purpose}` : ''} and is
            not valid for medico-legal purposes.
          </p>
        </div>
      )}

      <DocSignature doctor={doctor} />
      <footer className="mt-8 border-t border-slate-200 pt-2 text-center text-[9px] text-slate-400">
        Issued electronically by {clinic.name}. Verify at {clinic.website}/verify using the reference number above.
      </footer>
    </article>
  );
}

function ReceiptDoc({ invoice, patient, encounter, doctor }) {
  const { state } = useClinic();
  const clinic = state?.clinic ?? CLINIC;
  const totals = invoiceTotals(invoice);
  const change = Math.max(0, Number(invoice?.tendered || 0) - totals.total);
  return (
    <article className="print-doc bg-white p-8 font-sans text-slate-900">
      <DocLetterhead
        docTitle="Billing Statement"
        meta={
          <>
            <div className="nums">No. {invoice?.id ?? '—'}</div>
            <div>{invoice?.paidAt ? fmtDate(ymd(new Date(invoice.paidAt))) : fmtDate(invoice?.date)}</div>
          </>
        }
      />

      <DocPatientLine
        patient={patient}
        extra={
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Attending</dt>
            <dd className="text-slate-800">{doctor ? `Dr. ${doctor.name}` : '—'}</dd>
          </div>
        }
      />

      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-y border-slate-300 bg-slate-50">
            <th className="py-1.5 pl-1 text-left font-semibold uppercase tracking-wide text-slate-500">
              Particulars
            </th>
            <th className="w-14 py-1.5 text-right font-semibold uppercase tracking-wide text-slate-500">Qty</th>
            <th className="w-24 py-1.5 text-right font-semibold uppercase tracking-wide text-slate-500">Unit</th>
            <th className="w-28 py-1.5 pr-1 text-right font-semibold uppercase tracking-wide text-slate-500">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {(invoice?.items ?? []).map((it) => (
            <tr key={it.id} className="border-b border-slate-100">
              <td className="py-1.5 pl-1 text-slate-800">
                {it.label}
                {it.kind === 'drug' && (
                  <span className="ml-1 text-[10px] text-slate-500">
                    ({it.dispense ? 'dispensed' : 'prescribed — not dispensed'})
                  </span>
                )}
              </td>
              <td className="nums py-1.5 text-right text-slate-700">{it.qty}</td>
              <td className="nums py-1.5 text-right text-slate-700">{peso(it.unitPrice)}</td>
              <td className="nums py-1.5 pr-1 text-right font-medium text-slate-900">
                {peso(Number(it.qty) * Number(it.unitPrice))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="py-1.5 pr-2 text-right text-slate-600">Subtotal</td>
            <td className="nums py-1.5 pr-1 text-right text-slate-900">{peso(totals.subtotal)}</td>
          </tr>
          {totals.discount > 0 && (
            <tr>
              <td colSpan={3} className="py-1.5 pr-2 text-right text-slate-600">
                {invoice.discountType} discount (20%)
                {invoice.discountId && <span className="ml-1 text-[10px] text-slate-500">ID {invoice.discountId}</span>}
              </td>
              <td className="nums py-1.5 pr-1 text-right text-slate-900">−{peso(totals.discount)}</td>
            </tr>
          )}
          <tr className="border-t-2 border-slate-800">
            <td colSpan={3} className="py-2 pr-2 text-right font-bold uppercase text-slate-900">Total due</td>
            <td className="nums py-2 pr-1 text-right text-base font-bold text-slate-900">{peso(totals.total)}</td>
          </tr>
          {invoice?.status === 'Paid' && (
            <>
              <tr>
                <td colSpan={3} className="py-1 pr-2 text-right text-slate-600">
                  Paid via {invoice.method}
                  {invoice.reference ? ` · Ref ${invoice.reference}` : ''}
                </td>
                <td className="nums py-1 pr-1 text-right text-slate-900">{peso(invoice.amountPaid)}</td>
              </tr>
              {invoice.method === 'Cash' && Number(invoice.tendered) > 0 && (
                <>
                  <tr>
                    <td colSpan={3} className="py-1 pr-2 text-right text-slate-600">Cash tendered</td>
                    <td className="nums py-1 pr-1 text-right text-slate-900">{peso(invoice.tendered)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="py-1 pr-2 text-right text-slate-600">Change</td>
                    <td className="nums py-1 pr-1 text-right text-slate-900">{peso(change)}</td>
                  </tr>
                </>
              )}
            </>
          )}
        </tfoot>
      </table>

      <div className="avoid-break mt-6 flex items-end justify-between gap-6">
        <div className="text-[10px] leading-snug text-slate-500">
          <p className="font-semibold text-slate-700">
            {invoice?.status === 'Paid' ? 'PAID' : 'UNPAID — payable at the front desk'}
          </p>
          <p>Received by: {invoice?.cashier || 'Front desk'}</p>
          {encounter && <p>Encounter ref. {encounter.id}</p>}
        </div>
        <FakeQR value={`${clinic.website}/verify/${invoice?.id ?? ''}`} size={76} />
      </div>

      {/* Not a BIR-registered Official Receipt — see CLAUDE.md gap 4. */}
      <footer className="mt-6 border-t border-slate-200 pt-2 text-center text-[9px] leading-snug text-slate-400">
        This is a billing statement / acknowledgement of payment and is <strong>not</strong> a BIR-registered
        Official Receipt. Please request an Official Receipt from the cashier for reimbursement or tax purposes.
      </footer>
    </article>
  );
}

function PrintCenter({ job, onClose }) {
  const printRoot = typeof document !== 'undefined' ? document.getElementById('print-root') : null;
  if (!job) return null;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={job.title}
        subtitle={job.subtitle}
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              Printed documents use the clinic letterhead. Save as PDF from the print dialog to share.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-ghost btn-sm">Close</button>
              <button type="button" onClick={() => window.print()} className="btn-primary btn-sm">
                <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
              </button>
            </div>
          </div>
        }
      >
        <div className="bg-slate-200 p-4 sm:p-6">
          <div className="mx-auto max-w-[210mm] overflow-hidden rounded shadow-lg ring-1 ring-slate-300">
            {job.doc}
          </div>
        </div>
      </Modal>
      {/* The same document, portalled outside #root so @media print can isolate it. */}
      {printRoot && createPortal(<div>{job.doc}</div>, printRoot)}
    </>
  );
}

/* Shared chart slide-over: Doctor records, Staff directory and the Patient portal all
   open this. Actions are gated by role — the data shown is the same. */
function PatientChart({ patientId, open, onClose, onCheckIn }) {
  const { state, role, openPrint } = useClinic();
  const [tab, setTab] = useState('summary');
  const [editingRx, setEditingRx] = useState(null);

  const patient = findBy(state.patients, patientId);
  const encounters = useMemo(
    () =>
      state.encounters
        .filter((e) => e.patientId === patientId)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date)),
    [state.encounters, patientId],
  );
  const invoices = useMemo(
    () =>
      state.invoices
        .filter((i) => i.patientId === patientId)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date)),
    [state.invoices, patientId],
  );
  const appointments = useMemo(
    () =>
      state.appointments
        .filter((a) => a.patientId === patientId && a.date >= ymd() && a.status !== 'Completed')
        .sort((a, b) => a.date.localeCompare(b.date)),
    [state.appointments, patientId],
  );

  useEffect(() => {
    if (open) setTab('summary');
  }, [open, patientId]);

  if (!patient) return null;

  const activeRx = encounters.flatMap((e) =>
    (e.meds ?? []).filter((m) => isRxActive(m, e.date)).map((m) => ({ med: m, encounter: e })),
  );
  const outstanding = invoices.filter((i) => i.status === 'Pending');
  const lastVisit = encounters[0];
  const tabs = [
    { id: 'summary', label: 'Summary', icon: User },
    { id: 'visits', label: 'Visits', icon: ClipboardList, count: encounters.length },
    { id: 'rx', label: 'Prescriptions', icon: Pill, count: activeRx.length },
    { id: 'billing', label: 'Billing', icon: PhilippinePeso, count: outstanding.length },
  ];

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={patientName(patient)}
      subtitle={`${patient.id} · ${ageLabel(patient.dob)} · ${patient.sex} · ${patient.bloodType}`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-slate-500">
            Registered {fmtDate(patient.registeredAt)} · PhilHealth {patient.philhealth || '—'}
          </div>
          <div className="flex flex-wrap gap-2">
            {role === 'staff' && onCheckIn && (
              <button type="button" className="btn-sky btn-sm" onClick={() => onCheckIn(patient)}>
                <LogIn className="h-3.5 w-3.5" /> Check in
              </button>
            )}
            {lastVisit && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() =>
                  openPrint({
                    title: 'Medical abstract',
                    subtitle: `${patientName(patient)} · ${fmtDate(lastVisit.date)}`,
                    doc: (
                      <MedicalCertificateDoc
                        kind="abstract"
                        encounter={lastVisit}
                        patient={patient}
                        doctor={findBy(state.doctors, lastVisit.doctorId)}
                      />
                    ),
                  })
                }
              >
                <FileText className="h-3.5 w-3.5" /> Abstract
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AllergyBadges patient={patient} />
        {patient.conditions?.map((c) => (
          <Badge key={c} tone="bg-amber-100 text-amber-800" icon={Activity}>{c}</Badge>
        ))}
        {isSenior(patient) && <Badge tone="bg-emerald-100 text-emerald-700" icon={BadgeCheck}>Senior Citizen</Badge>}
        {patient.pwdId && <Badge tone="bg-emerald-100 text-emerald-700" icon={BadgeCheck}>PWD</Badge>}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-white p-1 shadow-sm">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cx(
                'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold transition',
                tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.count > 0 && <span className="nums opacity-70">({t.count})</span>}
            </button>
          );
        })}
      </div>

      {tab === 'summary' && (
        <div className="space-y-3">
          <div className="card card-pad">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Contact</h3>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-slate-400" />
                <span className="nums">{patient.mobile}</span>
              </div>
              <div className="flex items-center gap-2 truncate">
                <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{patient.email}</span>
              </div>
              <div className="col-span-full flex items-start gap-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="text-slate-700">{patient.address}</span>
              </div>
              <div className="col-span-full flex items-start gap-2 border-t border-slate-100 pt-2">
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="text-slate-700">
                  <span className="font-medium">{patient.emergency?.name}</span>{' '}
                  <span className="text-slate-500">({patient.emergency?.relation})</span> ·{' '}
                  <span className="nums">{patient.emergency?.mobile}</span>
                </span>
              </div>
            </dl>
          </div>

          {lastVisit && (
            <div className="card card-pad">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Last visit</h3>
                <span className="text-xs text-slate-500">{fmtDate(lastVisit.date)}</span>
              </div>
              <p className="text-sm font-semibold text-slate-900">{lastVisit.chiefComplaint}</p>
              <p className="mt-0.5 text-xs text-slate-600">
                {(lastVisit.diagnoses ?? []).map((d) => `${d.code} ${d.label}`).join(' · ') || '—'}
              </p>
              <VitalsStrip vitals={lastVisit.vitals} className="mt-3 border-t border-slate-100 pt-2.5" />
            </div>
          )}

          {appointments.length > 0 && (
            <div className="card card-pad">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Upcoming</h3>
              <ul className="space-y-2">
                {appointments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="font-medium text-slate-800">{fmtDate(a.date)}</span>{' '}
                      <span className="nums text-slate-500">{a.time}</span>
                      <span className="block text-xs text-slate-500">
                        {doctorName(findBy(state.doctors, a.doctorId))} · {a.mode}
                      </span>
                    </span>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'visits' && (
        <div className="space-y-3">
          {encounters.length === 0 && <EmptyState icon={ClipboardList} title="No recorded visits yet" />}
          {encounters.map((e) => (
            <EncounterCard key={e.id} encounter={e} patient={patient} />
          ))}
        </div>
      )}

      {tab === 'rx' && (
        <div className="space-y-3">
          {encounters.filter((e) => (e.meds ?? []).length > 0).length === 0 && (
            <EmptyState icon={Pill} title="No prescriptions on file" />
          )}
          {encounters
            .filter((e) => (e.meds ?? []).length > 0)
            .map((e) => (
              <div key={e.id} className="card card-pad">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{fmtDate(e.date)}</p>
                    <p className="text-xs text-slate-500">{doctorName(findBy(state.doctors, e.doctorId))}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {/* Only the doctor may change what was prescribed. */}
                    {role === 'doctor' && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingRx(e)}>
                        <Pill className="h-3.5 w-3.5" /> Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() =>
                        openPrint({
                          title: 'Prescription',
                          subtitle: `${patientName(patient)} · ${fmtDate(e.date)}`,
                          doc: (
                            <PrescriptionDoc
                              encounter={e}
                              patient={patient}
                              doctor={findBy(state.doctors, e.doctorId)}
                            />
                          ),
                        })
                      }
                    >
                      <Printer className="h-3.5 w-3.5" /> Print
                    </button>
                  </div>
                </div>

                {e.medsAmendedAt && (
                  <p className="mb-2 text-[11px] font-medium text-amber-700">
                    Amended {fmtDateTime(e.medsAmendedAt)}
                    {e.medsAmendedBy ? ` by ${e.medsAmendedBy}` : ''}
                  </p>
                )}
                <ul className="space-y-1.5">
                  {e.meds.map((m, i) => (
                    <li key={m.id ?? i} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-slate-800">
                        {m.name} {m.strength}
                        <span className="block text-xs text-slate-500">
                          {m.freq} · {m.days} day{Number(m.days) > 1 ? 's' : ''} · #{m.qty}
                        </span>
                      </span>
                      <StatusBadge status={isRxActive(m, e.date) ? 'Active' : 'Expired'} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

      <PrescriptionEditor
        encounter={editingRx}
        patient={patient}
        onClose={() => setEditingRx(null)}
      />

      {tab === 'billing' && (
        <div className="space-y-3">
          {invoices.length === 0 && <EmptyState icon={PhilippinePeso} title="No billing history" />}
          {invoices.map((inv) => {
            const totals = invoiceTotals(inv);
            return (
              <div key={inv.id} className="card card-pad">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="nums text-sm font-semibold text-slate-900">{inv.id}</p>
                    <p className="text-xs text-slate-500">
                      {fmtDate(inv.date)} · {inv.items.length} item{inv.items.length > 1 ? 's' : ''}
                      {inv.method ? ` · ${inv.method}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="nums text-sm font-bold text-slate-900">{peso(totals.total)}</p>
                    <StatusBadge status={inv.status} />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-sm mt-2.5 w-full"
                  onClick={() =>
                    openPrint({
                      title: 'Billing statement',
                      subtitle: `${inv.id} · ${patientName(patient)}`,
                      doc: (
                        <ReceiptDoc
                          invoice={inv}
                          patient={patient}
                          encounter={findBy(state.encounters, inv.encounterId)}
                          doctor={findBy(state.doctors, inv.doctorId)}
                        />
                      ),
                    })
                  }
                >
                  <Printer className="h-3.5 w-3.5" /> View statement
                </button>
              </div>
            );
          })}
        </div>
      )}
    </SlideOver>
  );
}

/* Amend an already-issued prescription. Reuses MedicationBuilder, so the allergy
   and stock checks that apply during a consultation apply to a correction too.
   The change is stamped onto the encounter — an issued prescription should never
   be rewritten without a trace, even in a demo (CLAUDE.md gap 8). */
function PrescriptionEditor({ encounter, patient, onClose }) {
  const { state, act, toast, me, openPrint } = useClinic();
  const [meds, setMeds] = useState([]);

  useEffect(() => {
    setMeds(encounter?.meds ? encounter.meds.map((m) => ({ ...m })) : []);
  }, [encounter]);

  if (!encounter) return null;

  const doctor = findBy(state.doctors, encounter.doctorId);
  const original = encounter.meds ?? [];
  const changed =
    meds.length !== original.length ||
    meds.some((m, i) => {
      const o = original[i];
      return (
        !o ||
        o.itemId !== m.itemId ||
        String(o.freq) !== String(m.freq) ||
        String(o.days) !== String(m.days) ||
        String(o.qty) !== String(m.qty) ||
        String(o.route) !== String(m.route) ||
        String(o.instructions ?? '') !== String(m.instructions ?? '')
      );
    });

  const save = () => {
    if (!changed) {
      toast('Nothing changed on this prescription.', 'warn');
      return;
    }
    const at = new Date().toISOString();
    act({
      type: 'UPDATE_ENCOUNTER',
      id: encounter.id,
      patch: {
        meds,
        medsAmendedAt: at,
        medsAmendedBy: partyName(state, me),
        /* Keep what was first issued, so the amendment is auditable later. */
        medsOriginal: encounter.medsOriginal ?? original,
      },
    });
    toast(
      `Prescription for ${fmtDate(encounter.date)} amended — ${meds.length} medication${meds.length === 1 ? '' : 's'}`,
      'success',
    );
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit prescription"
      subtitle={`${patientName(patient)} · issued ${fmtDate(encounter.date)} · ${doctorName(doctor)}`}
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500">
            The amendment is recorded on the record and printed on the prescription.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() =>
                openPrint({
                  title: 'Prescription (unsaved preview)',
                  subtitle: patientName(patient),
                  doc: (
                    <PrescriptionDoc
                      encounter={{ ...encounter, meds }}
                      patient={patient}
                      doctor={doctor}
                    />
                  ),
                })
              }
            >
              <Printer className="h-3.5 w-3.5" /> Preview
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={!changed}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Save amendment
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        {encounter.medsAmendedAt && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This prescription was already amended {fmtDateTime(encounter.medsAmendedAt)}
            {encounter.medsAmendedBy ? ` by ${encounter.medsAmendedBy}` : ''}. The originally issued
            medicines are kept on the record.
          </p>
        )}

        <MedicationBuilder meds={meds} patient={patient} onChange={setMeds} />

        {meds.length === 0 && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Saving with no medicines leaves this visit with an empty prescription.
          </p>
        )}
      </div>
    </Modal>
  );
}

/* One past visit, expandable into full SOAP. Used by the chart and by Records.
   `showPatient` is for Records, where results span every patient. */
function EncounterCard({ encounter, patient, defaultOpen = false, showPatient = false }) {
  const { state, role, openPrint } = useClinic();
  const [open, setOpen] = useState(defaultOpen);
  const doctor = findBy(state.doctors, encounter.doctorId);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
          {encounter.type === 'Teleconsult' ? <Video className="h-4 w-4" /> : <Stethoscope className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            {showPatient && (
              <span className="text-sm font-semibold text-slate-900">{patientName(patient)}</span>
            )}
            <span className={cx('text-sm', showPatient ? 'text-slate-500' : 'font-semibold text-slate-900')}>
              {fmtDate(encounter.date)}
            </span>
            <Badge tone="bg-slate-100 text-slate-500">{encounter.type}</Badge>
          </span>
          <span className="mt-0.5 block truncate text-sm text-slate-700">{encounter.chiefComplaint}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{doctorName(doctor)}</span>
        </span>
        <ChevronDown className={cx('mt-1 h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
          <VitalsStrip vitals={encounter.vitals} className="mb-3" />

          <div className="space-y-2.5">
            {[
              ['Subjective', encounter.soap?.s],
              ['Objective', encounter.soap?.o],
              ['Assessment', encounter.soap?.a],
              ['Plan', encounter.soap?.p],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="whitespace-pre-wrap text-sm leading-snug text-slate-700">{value || '—'}</p>
              </div>
            ))}
          </div>

          {(encounter.diagnoses ?? []).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {encounter.diagnoses.map((d) => (
                <Badge key={d.code} tone="bg-teal-100 text-teal-800">
                  <span className="nums font-bold">{d.code}</span> {d.label}
                </Badge>
              ))}
            </div>
          )}

          {(encounter.meds ?? []).length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-slate-200 pt-2.5">
              {encounter.meds.map((m, i) => (
                <li key={m.id ?? i} className="flex items-center gap-2 text-sm text-slate-700">
                  <Pill className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span>
                    {m.name} {m.strength} — {m.freq} x {m.days}d (#{m.qty})
                  </span>
                </li>
              ))}
            </ul>
          )}

          {encounter.followUp && (
            <p className="mt-3 text-xs text-slate-500">
              <Calendar className="mr-1 inline h-3.5 w-3.5" />
              Follow-up advised {fmtDate(encounter.followUp)}
            </p>
          )}

          {role !== 'patient' && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
              {(encounter.meds ?? []).length > 0 && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() =>
                    openPrint({
                      title: 'Prescription',
                      subtitle: `${patientName(patient)} · ${fmtDate(encounter.date)}`,
                      doc: <PrescriptionDoc encounter={encounter} patient={patient} doctor={doctor} />,
                    })
                  }
                >
                  <Pill className="h-3.5 w-3.5" /> Prescription
                </button>
              )}
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() =>
                  openPrint({
                    title: 'Medical certificate',
                    subtitle: `${patientName(patient)} · ${fmtDate(encounter.date)}`,
                    doc: <MedicalCertificateDoc encounter={encounter} patient={patient} doctor={doctor} />,
                  })
                }
              >
                <FileText className="h-3.5 w-3.5" /> Certificate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/* A throwaway encounter so the template preview has something to render. */
const SAMPLE_RX_ENCOUNTER = {
  id: 'E-PREVIEW',
  date: ymd(),
  vitals: { weight: 62 },
  meds: [
    {
      id: 'M-preview-1', name: 'Amoxicillin', strength: '500 mg', form: 'Capsule',
      route: 'PO', freq: 'TID', days: 7, qty: 21, instructions: 'Take after meals. Complete the full course.',
    },
    {
      id: 'M-preview-2', name: 'Paracetamol', strength: '500 mg', form: 'Tablet',
      route: 'PO', freq: 'Q6H', days: 3, qty: 12, instructions: 'As needed for fever or pain.',
    },
  ],
};

/* Practice locations. A doctor may hold clinic at several sites; exactly one is
   primary, which supplies the default room and fee for walk-ins. */
function LocationsEditor({ doctor, onChange }) {
  const { toast } = useClinic();
  const locations = doctor?.locations ?? [];

  const patch = (id, changes) =>
    onChange(locations.map((l) => (l.id === id ? { ...l, ...changes } : l)));

  const makePrimary = (id) =>
    onChange(locations.map((l) => ({ ...l, primary: l.id === id })));

  const add = () => {
    const next = {
      id: nextId('L', locations),
      name: `Clinic ${locations.length + 1}`,
      primary: locations.length === 0,
      address: '',
      phone: '',
      room: '',
      days: '',
      hours: '',
      fee: primaryLocation(doctor)?.fee ?? 500,
    };
    onChange([...locations, next]);
  };

  const remove = (loc) => {
    if (locations.length === 1) {
      toast('Keep at least one location — it supplies the room and fee.', 'warn');
      return;
    }
    const rest = locations.filter((l) => l.id !== loc.id);
    /* Never leave the set without a primary. */
    if (loc.primary && rest.length) rest[0] = { ...rest[0], primary: true };
    onChange(rest);
    toast(`${loc.name || 'Location'} removed`, 'success');
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Clinic locations</h2>
        <div className="flex items-center gap-2">
          <Badge tone="bg-slate-100 text-slate-500">{locations.length}</Badge>
          <button type="button" className="btn-ghost btn-sm" onClick={add}>
            <Plus className="h-3.5 w-3.5" /> Add location
          </button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {locations.length === 0 && (
          <EmptyState icon={MapPin} title="No locations yet" hint="Add the clinic where you hold consultations." />
        )}

        {locations.map((loc) => (
          <div
            key={loc.id}
            className={cx(
              'rounded-xl border p-3',
              loc.primary ? 'border-teal-300 bg-teal-50/40' : 'border-slate-200',
            )}
          >
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <MapPin className={cx('h-4 w-4 shrink-0', loc.primary ? 'text-teal-600' : 'text-slate-400')} />
              <input
                className="input !w-auto min-w-0 flex-1 !py-1.5 text-sm font-semibold"
                placeholder="Location name"
                value={loc.name}
                onChange={(e) => patch(loc.id, { name: e.target.value })}
              />
              {loc.primary ? (
                <Badge tone="bg-teal-100 text-teal-800" icon={BadgeCheck}>Primary</Badge>
              ) : (
                <button type="button" className="btn-ghost btn-sm" onClick={() => makePrimary(loc.id)}>
                  Make primary
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(loc)}
                className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                aria-label={`Remove ${loc.name || 'location'}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Address" className="sm:col-span-2">
                <textarea
                  className="input min-h-[56px] resize-y"
                  placeholder="Street, barangay, city"
                  value={loc.address}
                  onChange={(e) => patch(loc.id, { address: e.target.value })}
                />
              </Field>
              <Field label="Telephone">
                <input className="input nums" value={loc.phone ?? ''} onChange={(e) => patch(loc.id, { phone: e.target.value })} />
              </Field>
              <Field label="Room">
                <input className="input" value={loc.room ?? ''} onChange={(e) => patch(loc.id, { room: e.target.value })} />
              </Field>
              <Field label="Clinic days">
                <input className="input" placeholder="Mon · Wed · Fri" value={loc.days ?? ''} onChange={(e) => patch(loc.id, { days: e.target.value })} />
              </Field>
              <Field label="Clinic hours">
                <input className="input" placeholder="9:00 AM – 5:00 PM" value={loc.hours ?? ''} onChange={(e) => patch(loc.id, { hours: e.target.value })} />
              </Field>
              <Field label="Consultation fee" className="sm:col-span-2">
                <input
                  type="number"
                  min="0"
                  className="input nums w-32"
                  value={loc.fee ?? 0}
                  onChange={(e) => patch(loc.id, { fee: Number(e.target.value) || 0 })}
                />
              </Field>
            </div>
          </div>
        ))}

        <p className="text-[11px] leading-snug text-slate-500">
          Patients choose a location when they book. Walk-ins are billed at the primary location&apos;s fee.
        </p>
      </div>
    </section>
  );
}

/* Logo upload. The file never goes anywhere: it is drawn into a canvas, scaled,
   re-encoded and the result stored on the clinic record. */
function LogoUploader() {
  const { state, act, toast } = useClinic();
  const logo = state.clinic?.logo ?? '';
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    /* Clear the input straight away so choosing the same file twice still fires. */
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const { dataUrl, width, height } = await processLogoFile(file);
      act({ type: 'UPDATE_CLINIC', patch: { logo: dataUrl } });
      toast(`Logo updated · ${width}×${height}px`, 'success');
    } catch (err) {
      toast(err.message || 'That image could not be used.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field
      label="Clinic logo"
      hint={`PNG, JPEG or WebP up to 5 MB. Scaled to ${LOGO_MAX_PX}px and stored in this browser — it prints on every document.`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
          {logo ? (
            <img src={logo} alt="Current clinic logo" className="h-full w-full object-contain" />
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-teal-600 text-white">
              <Plus className="h-6 w-6" strokeWidth={3} />
            </span>
          )}
        </span>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            {busy ? 'Processing…' : logo ? 'Replace logo' : 'Upload logo'}
          </button>
          {logo && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                act({ type: 'UPDATE_CLINIC', patch: { logo: '' } });
                toast('Logo removed — back to the default mark', 'success');
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={pick}
            aria-label="Upload clinic logo"
          />
        </div>
      </div>
    </Field>
  );
}

/* Doctor-owned settings: the signature block, the shared letterhead and the
   prescription layout, with the real document rendering alongside. */
function DoctorSettings() {
  const { state, doctorId, act, toast, openPrint } = useClinic();
  const doctor = findBy(state.doctors, doctorId);
  const template = state.rxTemplate;
  const clinic = state.clinic;
  const [tab, setTab] = useState('details');

  const samplePatient = state.patients[0];
  const setDoctor = (patch) => act({ type: 'UPDATE_DOCTOR', id: doctorId, patch });
  const setTemplate = (patch) => act({ type: 'UPDATE_RX_TEMPLATE', patch });
  const setClinic = (patch) => act({ type: 'UPDATE_CLINIC', patch });

  const tabs = [
    { id: 'details', label: 'My details', icon: User },
    { id: 'template', label: 'Prescription template', icon: FileText },
    { id: 'letterhead', label: 'Letterhead', icon: Hospital },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Settings</h1>
          <p className="text-sm text-slate-500">
            Everything here prints on your documents. Changes save as you type.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() =>
            openPrint({
              title: 'Prescription (template preview)',
              subtitle: 'Sample data — nothing is recorded',
              doc: <PrescriptionDoc encounter={SAMPLE_RX_ENCOUNTER} patient={samplePatient} doctor={doctor} />,
            })
          }
        >
          <Printer className="h-3.5 w-3.5" /> Print a test page
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px),1fr]">
        <div className="space-y-4">
          <div className="flex gap-1 overflow-x-auto rounded-lg bg-white p-1 shadow-sm">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cx(
                    'inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold transition',
                    tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {t.label}
                </button>
              );
            })}
          </div>

          {tab === 'details' && (
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Signature block</h2>
                <Badge tone="bg-slate-100 text-slate-500">prints on every document</Badge>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <Field label="Full name" required className="sm:col-span-2">
                  <input className="input" value={doctor?.name ?? ''} onChange={(e) => setDoctor({ name: e.target.value })} />
                </Field>
                <Field label="Title / fellowships" hint="e.g. MD, FPCP">
                  <input className="input" value={doctor?.title ?? ''} onChange={(e) => setDoctor({ title: e.target.value })} />
                </Field>
                <Field label="Specialty">
                  <input className="input" value={doctor?.specialty ?? ''} onChange={(e) => setDoctor({ specialty: e.target.value })} />
                </Field>
                <Field label="PRC licence no." required>
                  <input className="input nums" value={doctor?.prc ?? ''} onChange={(e) => setDoctor({ prc: e.target.value })} />
                </Field>
                <Field label="PTR no." required>
                  <input className="input nums" value={doctor?.ptr ?? ''} onChange={(e) => setDoctor({ ptr: e.target.value })} />
                </Field>
                <Field label="S2 licence no." hint="Required to prescribe dangerous drugs." className="sm:col-span-2">
                  <input className="input nums" value={doctor?.s2 ?? ''} onChange={(e) => setDoctor({ s2: e.target.value })} />
                </Field>

              </div>
            </section>
          )}

          {tab === 'details' && <LocationsEditor doctor={doctor} onChange={(locations) => setDoctor({ locations })} />}

          {tab === 'template' && (
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Prescription layout</h2>
              </div>
              <div className="space-y-3 p-4">
                <Field label="Heading">
                  <input className="input" value={template.heading} onChange={(e) => setTemplate({ heading: e.target.value })} />
                </Field>
                <Field label="Signature caption">
                  <input
                    className="input"
                    value={template.signatureLabel}
                    onChange={(e) => setTemplate({ signatureLabel: e.target.value })}
                  />
                </Field>

                <div className="space-y-1.5 rounded-lg bg-slate-50 p-3">
                  <p className="label !mb-1">Show on the prescription</p>
                  {[
                    ['showWeight', 'Patient weight', 'Useful for paediatric dosing.'],
                    ['showAllergies', 'Known allergies box', 'Red banner listing documented allergies.'],
                    ['showLicenses', 'PRC / PTR / S2 numbers', 'Required on most Philippine prescriptions.'],
                    ['showStandingInstructions', 'Standing instructions', 'A fixed note added under every prescription.'],
                  ].map(([key, label, hint]) => (
                    <label key={key} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1.5 hover:bg-white">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-teal-600"
                        checked={!!template[key]}
                        onChange={(e) => setTemplate({ [key]: e.target.checked })}
                      />
                      <span>
                        <span className="block text-xs font-semibold text-slate-800">{label}</span>
                        <span className="block text-[11px] text-slate-500">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>

                {template.showStandingInstructions && (
                  <Field label="Standing instructions">
                    <textarea
                      className="input min-h-[70px] resize-y"
                      value={template.standingInstructions}
                      onChange={(e) => setTemplate({ standingInstructions: e.target.value })}
                    />
                  </Field>
                )}

                <Field label="Footer note" hint="Printed in small type at the bottom of the page.">
                  <textarea
                    className="input min-h-[80px] resize-y"
                    value={template.footerNote}
                    onChange={(e) => setTemplate({ footerNote: e.target.value })}
                  />
                </Field>

                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setTemplate({
                      heading: 'Prescription',
                      signatureLabel: 'Attending Physician',
                      showWeight: true,
                      showAllergies: true,
                      showLicenses: true,
                      showStandingInstructions: false,
                      footerNote:
                        'Generic names are written in compliance with R.A. 6675 (Generics Act of 1988). This prescription is valid for one (1) year from the date issued, except for regulated drugs.',
                    });
                    toast('Prescription template reset to the clinic default', 'success');
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Reset to default
                </button>
              </div>
            </section>
          )}

          {tab === 'letterhead' && (
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Clinic letterhead</h2>
                <Badge tone="bg-amber-100 text-amber-800">shared by all documents</Badge>
              </div>
              <div className="grid gap-3 p-4">
                <LogoUploader />
                <Field label="Clinic name" required>
                  <input className="input" value={clinic.name} onChange={(e) => setClinic({ name: e.target.value })} />
                </Field>
                <Field label="Tagline">
                  <input className="input" value={clinic.tagline} onChange={(e) => setClinic({ tagline: e.target.value })} />
                </Field>
                <Field label="Address">
                  <textarea className="input min-h-[60px] resize-y" value={clinic.address} onChange={(e) => setClinic({ address: e.target.value })} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Telephone">
                    <input className="input nums" value={clinic.phone} onChange={(e) => setClinic({ phone: e.target.value })} />
                  </Field>
                  <Field label="E-mail">
                    <input className="input" value={clinic.email} onChange={(e) => setClinic({ email: e.target.value })} />
                  </Field>
                  <Field label="DOH LTO no." hint="Placeholder until the real licence is issued.">
                    <input className="input nums" value={clinic.lto} onChange={(e) => setClinic({ lto: e.target.value })} />
                  </Field>
                  <Field label="TIN">
                    <input className="input nums" value={clinic.tin} onChange={(e) => setClinic({ tin: e.target.value })} />
                  </Field>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Live preview of the real document component. */}
        <section className="card overflow-hidden">
          <div className="card-head">
            <h2 className="card-title">Preview</h2>
            <Badge tone="bg-slate-100 text-slate-500">sample patient &amp; medicines</Badge>
          </div>
          <div className="thin-scroll max-h-[40rem] overflow-auto bg-slate-200 p-4">
            <div className="mx-auto max-w-[210mm] overflow-hidden rounded shadow-lg ring-1 ring-slate-300">
              <PrescriptionDoc encounter={SAMPLE_RX_ENCOUNTER} patient={samplePatient} doctor={doctor} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ===== 7. Doctor portal ========================================================= */

function DoctorPortal() {
  const { state, doctorId, act, toast, me } = useClinic();
  const [tab, setTab] = useState('overview');
  const [chartId, setChartId] = useState(null);

  const myQueue = useMemo(
    () => state.queue.filter((q) => isToday(q.checkedInAt)).sort((a, b) => a.number - b.number),
    [state.queue],
  );
  const inConsult = myQueue.find((q) => q.status === 'In Consultation' && q.doctorId === doctorId);
  const waiting = myQueue.filter((q) => q.status === 'Waiting');

  const callIn = useCallback(
    (item) => {
      if (inConsult && inConsult.id !== item.id) {
        toast('Finish the current consultation before calling in another patient.', 'warn');
        return;
      }
      act({
        type: 'UPDATE_QUEUE',
        id: item.id,
        patch: { status: 'In Consultation', startedAt: new Date().toISOString(), doctorId },
      });
      setTab('consult');
    },
    [act, doctorId, inConsult, toast],
  );

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'consult', label: 'Consultation', icon: Stethoscope, count: inConsult ? 1 : 0 },
    { id: 'records', label: 'Records', icon: ClipboardList },
    { id: 'messages', label: 'Messages', icon: MessageSquare, count: unreadThreadCount(state, me) },
    { id: 'accounts', label: 'Accounts', icon: ShieldCheck },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ];

  return (
    <>
      <SubNav tabs={tabs} active={tab} onChange={setTab} role="doctor" />
      <main className="mx-auto max-w-7xl px-4 py-5">
        {tab === 'overview' && (
          <DoctorOverview queue={myQueue} waiting={waiting} onCallIn={callIn} onOpenChart={setChartId} />
        )}
        {tab === 'consult' && (
          <ConsultationWorkspace
            key={inConsult?.id ?? 'none'}
            item={inConsult}
            waiting={waiting}
            onCallIn={callIn}
            onDone={() => setTab('overview')}
            onOpenChart={setChartId}
          />
        )}
        {tab === 'records' && <RecordsSearch onOpenChart={setChartId} />}
        {tab === 'messages' && <MessagesPanel accent="teal" />}
        {tab === 'accounts' && <AccountsPanel accent="teal" />}
        {tab === 'settings' && <DoctorSettings />}
      </main>
      <PatientChart patientId={chartId} open={!!chartId} onClose={() => setChartId(null)} />
    </>
  );
}

function DoctorOverview({ queue, waiting, onCallIn, onOpenChart }) {
  const { state, doctorId } = useClinic();
  const doctor = findBy(state.doctors, doctorId);

  const todayEncounters = state.encounters.filter((e) => e.date === ymd());
  const mineToday = todayEncounters.filter((e) => e.doctorId === doctorId);
  const completed = queue.filter((q) => q.status === 'Completed');

  const avgWait = useMemo(() => {
    const seen = queue.filter((q) => q.startedAt);
    if (!seen.length) return 0;
    const total = seen.reduce(
      (sum, q) => sum + Math.max(0, (new Date(q.startedAt) - new Date(q.checkedInAt)) / 60000),
      0,
    );
    return Math.round(total / seen.length);
  }, [queue]);

  const revenueToday = state.invoices
    .filter((i) => i.date === ymd())
    .reduce((sum, i) => sum + invoiceTotals(i).total, 0);

  /* Check-ins bucketed by clinic hour (8 AM – 5 PM). */
  const byHour = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => {
      const hour = 8 + i;
      const h12 = hour > 12 ? hour - 12 : hour;
      const ampm = hour >= 12 ? 'PM' : 'AM';
      return { hour, label: `${h12}:00 ${ampm}`, short: `${h12}${ampm === 'AM' ? 'a' : 'p'}`, value: 0 };
    });
    for (const q of queue) {
      const h = new Date(q.checkedInAt).getHours();
      const bucket = buckets.find((b) => b.hour === h);
      if (bucket) bucket.value += 1;
    }
    return buckets;
  }, [queue]);

  const todayAppts = state.appointments
    .filter((a) => a.date === ymd() && a.doctorId === doctorId)
    .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Good day, Dr. {doctor?.name.split(' ').slice(-1)}</h1>
          <p className="text-sm text-slate-500">
            {doctor?.specialty}
            {primaryLocation(doctor) ? ` · ${primaryLocation(doctor).name} · ${primaryLocation(doctor).room}` : ''}
            {(doctor?.locations?.length ?? 0) > 1 ? ` · +${doctor.locations.length - 1} other site${doctor.locations.length > 2 ? 's' : ''}` : ''}
          </p>
        </div>
        <Badge tone="bg-teal-50 text-teal-700 border border-teal-200" icon={Calendar}>
          {fmtLongDate(ymd())}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Users} label="Waiting now" value={waiting.length} sub="in the clinic queue" tone="amber" />
        <StatCard icon={CheckCircle2} label="Completed today" value={completed.length} sub={`${mineToday.length} by you`} tone="emerald" />
        <StatCard icon={Clock} label="Average wait" value={avgWait ? fmtDuration(avgWait) : '—'} sub="check-in to call-in" tone="teal" />
        <StatCard icon={TrendingUp} label="Billed today" value={peso(revenueToday)} sub={`${state.invoices.filter((i) => i.date === ymd()).length} statements`} tone="indigo" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="card-head">
            <h2 className="card-title">Live queue</h2>
            <Badge tone="bg-slate-100 text-slate-500">{queue.length} today</Badge>
          </div>
          <div className="divide-y divide-slate-100">
            {queue.length === 0 && <EmptyState icon={Users} title="No one has checked in yet" hint="Staff check-ins appear here in real time." />}
            {queue.map((q) => {
              const patient = findBy(state.patients, q.patientId);
              const wait = minsSince(q.checkedInAt);
              return (
                <div key={q.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={cx(
                      'nums grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold',
                      q.status === 'In Consultation'
                        ? 'bg-teal-600 text-white'
                        : q.status === 'Completed'
                          ? 'bg-slate-100 text-slate-400'
                          : 'bg-amber-100 text-amber-800',
                    )}
                  >
                    {q.number}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenChart(q.patientId)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-slate-900">{patientName(patient)}</span>
                      {q.priority && <Badge tone="bg-rose-100 text-rose-700">Priority</Badge>}
                      {(patient?.allergies ?? []).length > 0 && (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-label="Has allergies" />
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-500">{q.reason}</p>
                  </button>
                  <div className="hidden text-right sm:block">
                    <div className="nums text-xs font-semibold text-slate-700">{fmtDuration(wait)}</div>
                    <div className="text-[10px] text-slate-400">waiting</div>
                  </div>
                  {q.status === 'Waiting' ? (
                    <button type="button" className="btn-primary btn-sm" onClick={() => onCallIn(q)}>
                      Call in <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <StatusBadge status={q.status} />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="space-y-5">
          <section className="card card-pad">
            <h2 className="card-title mb-3">Check-ins by hour</h2>
            <HourlyBars data={byHour} accent="teal" />
          </section>

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Your appointments today</h2>
              <Badge tone="bg-slate-100 text-slate-500">{todayAppts.length}</Badge>
            </div>
            <ul className="divide-y divide-slate-100">
              {todayAppts.length === 0 && (
                <li><EmptyState icon={Calendar} title="No appointments booked" /></li>
              )}
              {todayAppts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="nums w-16 shrink-0 text-xs font-semibold text-slate-700">{a.time}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-800">
                      {patientName(findBy(state.patients, a.patientId))}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{a.complaint}</span>
                  </span>
                  {a.mode === 'Teleconsult' && <Video className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

const emptyDraft = (item) => ({
  vitals: { ...(item?.vitals ?? {}) },
  soap: { s: '', o: '', a: '', p: '' },
  diagnoses: [],
  meds: [],
  disposition: 'Home / outpatient',
  followUp: '',
  restDays: 0,
});

const DISPOSITIONS = [
  'Home / outpatient',
  'For labs, follow-up',
  'Refer to specialist',
  'Refer to hospital / ER',
  'For observation',
];

function ConsultationWorkspace({ item, waiting, onCallIn, onDone, onOpenChart }) {
  const { state, doctorId, act, toast, openPrint } = useClinic();
  const patient = findBy(state.patients, item?.patientId);
  const doctor = findBy(state.doctors, doctorId);

  const [draft, setDraft] = useState(() => (item?.draft ? { ...emptyDraft(item), ...item.draft } : emptyDraft(item)));
  const [savedAt, setSavedAt] = useState(item?.draftSavedAt ?? '');
  const firstRun = useRef(true);

  /* Autosave the in-progress consultation onto the queue item (silent — an autosave
     is not a user action, so it must not land in the offline outbox). */
  useEffect(() => {
    if (!item) return undefined;
    if (firstRun.current) {
      firstRun.current = false;
      return undefined;
    }
    const t = setTimeout(() => {
      const at = new Date().toISOString();
      act({ type: 'SAVE_DRAFT', id: item.id, draft, savedAt: at }, { silent: true });
      setSavedAt(at);
    }, 700);
    return () => clearTimeout(t);
  }, [draft, item, act]);

  const set = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), []);
  const setSoap = useCallback((patch) => setDraft((d) => ({ ...d, soap: { ...d.soap, ...patch } })), []);
  const setVitals = useCallback((patch) => setDraft((d) => ({ ...d, vitals: { ...d.vitals, ...patch } })), []);

  if (!item) {
    return (
      <div className="space-y-4">
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">No one in the room</h2>
            <Badge tone="bg-amber-100 text-amber-800">{waiting.length} waiting</Badge>
          </div>
          {waiting.length === 0 ? (
            <EmptyState icon={Users} title="The queue is empty" hint="Patients appear here once the front desk checks them in." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {waiting.map((q) => {
                const p = findBy(state.patients, q.patientId);
                return (
                  <li key={q.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="nums grid h-9 w-9 place-items-center rounded-lg bg-amber-100 text-sm font-bold text-amber-800">
                      {q.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{patientName(p)}</p>
                      <p className="truncate text-xs text-slate-500">{q.reason}</p>
                    </div>
                    <span className="nums hidden text-xs text-slate-500 sm:block">
                      {fmtDuration(minsSince(q.checkedInAt))}
                    </span>
                    <button type="button" className="btn-primary btn-sm" onClick={() => onCallIn(q)}>
                      Call in
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const complete = () => {
    if (!draft.soap.a.trim() && draft.diagnoses.length === 0) {
      toast('Add an assessment or at least one diagnosis before discharging.', 'warn');
      return;
    }

    const now = new Date().toISOString();
    const encounter = {
      id: nextId('E', state.encounters),
      patientId: item.patientId,
      doctorId,
      date: ymd(),
      type: item.type,
      chiefComplaint: item.reason,
      vitals: draft.vitals,
      soap: draft.soap,
      diagnoses: draft.diagnoses,
      meds: draft.meds,
      disposition: draft.disposition,
      followUp: draft.followUp,
      createdAt: now,
    };

    const isFollowUp = item.type === 'Appointment';
    const consultItem = {
      id: `IT-${encounter.id}-C`,
      label:
        item.type === 'Teleconsult'
          ? 'Teleconsultation'
          : `Consultation — ${isFollowUp ? 'follow-up' : 'new patient'} (Dr. ${doctor?.name.split(' ').pop()})`,
      kind: 'service',
      qty: 1,
      unitPrice: item.type === 'Teleconsult' ? 400 : isFollowUp ? 350 : primaryLocation(doctor)?.fee ?? 500,
    };
    const drugItems = draft.meds.map((m, i) => {
      const stockItem = findBy(state.inventory, m.itemId);
      return {
        id: `IT-${encounter.id}-D${i}`,
        label: `${m.name} ${m.strength} ${m.form}`,
        kind: 'drug',
        itemId: m.itemId,
        qty: Number(m.qty) || 1,
        unitPrice: stockItem?.price ?? 0,
        /* Default to dispensing only what the pharmacy can actually cover. */
        dispense: !!stockItem && Number(stockItem.stock) >= (Number(m.qty) || 1),
      };
    });

    const invoice = {
      id: nextId('INV', state.invoices),
      encounterId: encounter.id,
      patientId: item.patientId,
      doctorId,
      date: ymd(),
      items: [consultItem, ...drugItems],
      discountType: isSenior(patient) ? 'Senior Citizen' : patient?.pwdId ? 'PWD' : 'None',
      discountId: isSenior(patient) ? patient?.seniorId ?? '' : patient?.pwdId ?? '',
      status: 'Pending',
      method: '',
      amountPaid: 0,
      tendered: 0,
      cashier: 'Front desk',
    };

    /* Setting a follow-up date on the note is all it takes to raise the patient's
       reminder — the desk then sees it in the follow-up queue to send. */
    const followUpNotification = draft.followUp
      ? {
          id: nextId('N', state.notifications),
          to: { kind: 'patient', id: item.patientId },
          kind: 'follow-up',
          title: `Follow-up with ${doctorName(doctor)}`,
          body:
            `${fmtDate(draft.followUp)} — ${draft.diagnoses[0]?.label || draft.soap.a.slice(0, 60) || 'review'}.` +
            (draft.disposition === 'For labs, follow-up' ? ' Please have your labs done before the visit.' : ''),
          dueDate: draft.followUp,
          encounterId: encounter.id,
          createdAt: now,
          read: false,
          status: 'Scheduled',
        }
      : null;

    act({
      type: 'COMPLETE_CONSULT',
      queueId: item.id,
      appointmentId: item.appointmentId,
      encounter,
      invoice,
      followUpNotification,
      completedAt: now,
    });
    toast(
      `${patientName(patient)} discharged · ${invoice.id} sent to billing` +
        (followUpNotification ? ` · follow-up reminder set for ${fmtDate(draft.followUp)}` : ''),
      'success',
    );
    onDone();
  };

  const waitedFor = item.startedAt
    ? Math.round((new Date(item.startedAt) - new Date(item.checkedInAt)) / 60000)
    : minsSince(item.checkedInAt);

  return (
    <div className="space-y-4">
      {/* Patient banner */}
      <div className="card card-pad">
        <div className="flex flex-wrap items-start gap-3">
          <Avatar name={patientName(patient)} tone="bg-teal-100 text-teal-700" size="h-11 w-11 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">{patientName(patient)}</h1>
              <Badge tone="bg-slate-100 text-slate-600">
                {patient?.id} · {ageLabel(patient?.dob)} · {patient?.sex}
              </Badge>
              {item.priority && <Badge tone="bg-rose-100 text-rose-700">Priority</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-slate-600">
              <span className="font-medium text-slate-800">Chief complaint:</span> {item.reason}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AllergyBadges patient={patient} />
              {patient?.conditions?.map((c) => (
                <Badge key={c} tone="bg-amber-100 text-amber-800">{c}</Badge>
              ))}
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <button
              type="button"
              className="btn-ghost btn-sm mb-1.5"
              onClick={() => onOpenChart?.(item.patientId)}
            >
              <ClipboardList className="h-3.5 w-3.5" /> Open chart
            </button>
            <div className="nums font-semibold text-slate-700">Queue #{item.number}</div>
            <div>waited {fmtDuration(waitedFor)}</div>
            {savedAt && (
              <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-600">
                <CheckCircle2 className="h-3 w-3" /> Draft saved {fmtTime(savedAt)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Vitals */}
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Vitals</h2>
              <span className="text-xs text-slate-500">
                {bmiOf(draft.vitals) ? `BMI ${bmiOf(draft.vitals)}` : 'Taken at triage'}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 p-4">
              {VITALS_FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="label">
                    {f.label} <span className="font-normal normal-case text-slate-400">{f.unit}</span>
                  </span>
                  <input
                    className={cx('input nums', f.width)}
                    placeholder={f.placeholder}
                    value={draft.vitals[f.key] ?? ''}
                    onChange={(e) => setVitals({ [f.key]: e.target.value })}
                    inputMode={f.key === 'bp' ? 'text' : 'decimal'}
                  />
                </label>
              ))}
            </div>
            {(bpFlag(draft.vitals.bp)?.tone === 'rose' || tempFlag(draft.vitals.temp)?.tone === 'rose') && (
              <p className="mx-4 mb-4 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {bpFlag(draft.vitals.bp)?.tone === 'rose' ? 'Blood pressure in crisis range. ' : ''}
                {tempFlag(draft.vitals.temp)?.tone === 'rose' ? 'Febrile — consider work-up.' : ''}
              </p>
            )}
          </section>

          {/* SOAP */}
          <section className="card">
            <div className="card-head flex-wrap">
              <h2 className="card-title">SOAP note</h2>
              <div className="flex flex-wrap gap-1.5">
                {SOAP_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="btn-subtle btn-sm"
                    onClick={() => {
                      setSoap({ s: t.s, o: t.o, a: t.a, p: t.p });
                      toast(`Template applied: ${t.label}`, 'success');
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3 p-4">
              {[
                ['s', 'Subjective', 'History, symptoms, duration, relevant negatives…'],
                ['o', 'Objective', 'Physical examination findings, lab results…'],
                ['a', 'Assessment', 'Working impression / differentials…'],
                ['p', 'Plan', 'Management, advice, red flags, follow-up…'],
              ].map(([key, label, placeholder]) => (
                <Field key={key} label={label}>
                  <textarea
                    className="input min-h-[76px] resize-y leading-snug"
                    placeholder={placeholder}
                    value={draft.soap[key]}
                    onChange={(e) => setSoap({ [key]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </section>

          <MedicationBuilder
            meds={draft.meds}
            patient={patient}
            onChange={(meds) => set({ meds })}
          />
        </div>

        <div className="space-y-4">
          <DiagnosisPicker diagnoses={draft.diagnoses} onChange={(diagnoses) => set({ diagnoses })} />

          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Disposition</h2>
            </div>
            <div className="space-y-3 p-4">
              <Field label="Outcome">
                <select className="input" value={draft.disposition} onChange={(e) => set({ disposition: e.target.value })}>
                  {DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Follow-up date" hint="Leave blank if none advised.">
                <input
                  type="date"
                  className="input"
                  value={draft.followUp}
                  min={ymd()}
                  onChange={(e) => set({ followUp: e.target.value })}
                />
              </Field>
              <Field label="Rest days (for certificate)">
                <input
                  type="number"
                  min={0}
                  max={30}
                  className="input nums w-24"
                  value={draft.restDays}
                  onChange={(e) => set({ restDays: Number(e.target.value) })}
                />
              </Field>
            </div>
          </section>

          <section className="card card-pad space-y-2">
            <h2 className="card-title">Documents</h2>
            <p className="text-xs text-slate-500">Preview now; the final copy prints after discharge.</p>
            <button
              type="button"
              className="btn-ghost btn-sm w-full"
              disabled={draft.meds.length === 0}
              onClick={() =>
                openPrint({
                  title: 'Prescription (preview)',
                  subtitle: patientName(patient),
                  doc: (
                    <PrescriptionDoc
                      encounter={{ id: 'DRAFT', date: ymd(), meds: draft.meds, vitals: draft.vitals }}
                      patient={patient}
                      doctor={doctor}
                    />
                  ),
                })
              }
            >
              <Pill className="h-3.5 w-3.5" /> Prescription
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm w-full"
              onClick={() =>
                openPrint({
                  title: 'Medical certificate (preview)',
                  subtitle: patientName(patient),
                  doc: (
                    <MedicalCertificateDoc
                      encounter={{
                        id: 'DRAFT', date: ymd(), diagnoses: draft.diagnoses,
                        chiefComplaint: item.reason, soap: draft.soap, meds: draft.meds, vitals: draft.vitals,
                      }}
                      patient={patient}
                      doctor={doctor}
                      restDays={draft.restDays}
                    />
                  ),
                })
              }
            >
              <FileText className="h-3.5 w-3.5" /> Medical certificate
            </button>
          </section>

          <button type="button" onClick={complete} className="btn-primary w-full py-3">
            <CheckCircle2 className="h-4 w-4" /> Complete &amp; discharge
          </button>
          <p className="text-center text-[11px] text-slate-500">
            Creates the encounter record and sends a pending statement to billing.
          </p>
        </div>
      </div>
    </div>
  );
}

function DiagnosisPicker({ diagnoses, onChange }) {
  const [query, setQuery] = useState('');

  /* The whole list scrolls, grouped by ICD-10 chapter. Searching filters across
     both the code and the term, and collapses to the chapters that still match. */
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? ICD10.filter((d) => d.code.toLowerCase().includes(q) || d.label.toLowerCase().includes(q))
      : ICD10;
    return ICD10_GROUPS.map((group) => ({
      group,
      rows: matches.filter((d) => d.group === group),
    })).filter((g) => g.rows.length > 0);
  }, [query]);

  const total = grouped.reduce((n, g) => n + g.rows.length, 0);

  const add = (d) => {
    if (diagnoses.some((x) => x.code === d.code)) return;
    onChange([...diagnoses, d]);
    setQuery('');
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Diagnosis (ICD-10)</h2>
        <Badge tone="bg-slate-100 text-slate-500">{diagnoses.length}</Badge>
      </div>
      <div className="p-4">
        {diagnoses.length > 0 && (
          <ul className="mb-3 space-y-1.5">
            {diagnoses.map((d) => (
              <li key={d.code} className="flex items-start gap-2 rounded-lg bg-teal-50 px-2.5 py-1.5">
                <span className="nums mt-0.5 text-xs font-bold text-teal-800">{d.code}</span>
                <span className="flex-1 text-xs leading-snug text-teal-900">{d.label}</span>
                <button
                  type="button"
                  onClick={() => onChange(diagnoses.filter((x) => x.code !== d.code))}
                  className="text-teal-600 hover:text-teal-900"
                  aria-label={`Remove ${d.code}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="input pl-8"
            placeholder="Search code or condition…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <p className="mt-1.5 text-[11px] text-slate-400">
          {total} of {ICD10.length} codes{query.trim() ? ' match' : ' — scroll the list'}
        </p>

        <div className="thin-scroll mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-100">
          {grouped.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-slate-400">
              No match in this subset. Record it in the assessment instead.
            </p>
          )}
          {grouped.map((g) => (
            <div key={g.group}>
              <p className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 backdrop-blur">
                {g.group}
              </p>
              <ul className="space-y-0.5 p-1">
                {g.rows.map((d) => {
                  const picked = diagnoses.some((x) => x.code === d.code);
                  return (
                    <li key={d.code}>
                      <button
                        type="button"
                        onClick={() => add(d)}
                        disabled={picked}
                        className={cx(
                          'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition',
                          picked ? 'cursor-default bg-teal-50/60 opacity-60' : 'hover:bg-slate-50',
                        )}
                      >
                        <span className="nums mt-0.5 w-14 shrink-0 text-xs font-bold text-slate-500">{d.code}</span>
                        <span className="flex-1 text-xs leading-snug text-slate-700">{d.label}</span>
                        {picked ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" />
                        ) : (
                          <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const emptyMedForm = { generic: '', itemId: '', freq: 'TID', days: 7, qty: '', route: 'PO', instructions: '', qtyTouched: false };

/* Units that are dispensed whole — one bottle, one tube — rather than per dose,
   so frequency x days is the wrong quantity to suggest for them. */
const WHOLE_PACK_UNITS = ['bottle', 'tube', 'vial', 'amp', 'pc', 'respule', 'sachet'];

/* The route a form implies, so picking a nebule doesn't leave the route on PO. */
const routeForForm = (form = '') => {
  const f = form.toLowerCase();
  if (f.includes('nebule') || f.includes('respule')) return 'Nebulization';
  if (f.includes('inhaler')) return 'Inhalation';
  if (f.includes('eye')) return 'Ophthalmic';
  if (f.includes('otic')) return 'Otic';
  if (f.includes('nasal')) return 'Inhalation';
  if (f.includes('cream') || f.includes('ointment') || f.includes('gel')) return 'Topical';
  if (f.includes('ampule') || f.includes('vial')) return 'IM';
  return 'PO';
};

function MedicationBuilder({ meds, patient, onChange }) {
  const { state, toast } = useClinic();
  const [form, setForm] = useState(emptyMedForm);
  const [acknowledged, setAcknowledged] = useState(false);

  /* Step 1 picks the generic; step 2 picks the strength + form variant stocked
     under it (500 mg tablet vs 250 mg/5 mL syrup vs 100 mg/mL drops…). */
  const generics = useMemo(() => {
    const byName = new Map();
    for (const i of state.inventory) {
      if (!byName.has(i.name)) byName.set(i.name, { name: i.name, category: i.category, variants: [] });
      byName.get(i.name).variants.push(i);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [state.inventory]);

  const genericGroups = useMemo(() => {
    const cats = [...new Set(generics.map((g) => g.category))].sort();
    return cats.map((c) => ({ category: c, rows: generics.filter((g) => g.category === c) }));
  }, [generics]);

  const variants = useMemo(
    () => generics.find((g) => g.name === form.generic)?.variants ?? [],
    [generics, form.generic],
  );

  const item = findBy(state.inventory, form.itemId);
  const flags = useMemo(() => allergyFlags(patient, item?.name || form.generic), [patient, item, form.generic]);
  const blocking = flags.filter((f) => f.severity === 'high');
  const stock = item ? stockStatus(item) : null;

  /* Quantity follows frequency x days until the doctor overrides it by hand —
     except for whole-pack units, where one pack is the sane default. */
  const wholePack = !!item && WHOLE_PACK_UNITS.includes(item.unit);
  const suggestedQty = wholePack ? 1 : autoQty(form.freq, form.days);
  const qty = form.qtyTouched ? form.qty : suggestedQty;
  const shortStock = item && Number(qty) > Number(item.stock);

  const reset = () => {
    setForm(emptyMedForm);
    setAcknowledged(false);
  };

  const add = () => {
    if (!item) {
      toast('Select a medication first.', 'warn');
      return;
    }
    if (blocking.length && !acknowledged) {
      toast('Acknowledge the allergy warning before prescribing.', 'error');
      return;
    }
    const finalQty = Number(qty) || 1;
    onChange([
      ...meds,
      {
        id: `M-${Date.now()}-${meds.length}`,
        itemId: item.id,
        name: item.name,
        strength: item.strength,
        form: item.form,
        route: form.route,
        freq: form.freq,
        days: Number(form.days) || 0,
        qty: finalQty,
        instructions: form.instructions.trim(),
        allergyOverride: blocking.length ? blocking.map((f) => f.allergy).join(', ') : '',
      },
    ]);
    reset();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Medications</h2>
        <Badge tone="bg-slate-100 text-slate-500">{meds.length} prescribed</Badge>
      </div>

      {meds.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {meds.map((m) => (
            <li key={m.id} className="flex items-start gap-3 px-4 py-2.5">
              <Pill className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  {m.name} {m.strength}{' '}
                  <span className="font-normal text-slate-500">{m.form}</span>
                </p>
                <p className="text-xs text-slate-600">
                  {m.freq} · {m.days} day{Number(m.days) === 1 ? '' : 's'} · dispense #{m.qty} · {m.route}
                </p>
                {m.instructions && <p className="text-xs italic text-slate-500">{m.instructions}</p>}
                {m.allergyOverride && (
                  <p className="mt-0.5 text-[11px] font-semibold text-rose-600">
                    Prescribed over documented {m.allergyOverride} allergy
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onChange(meds.filter((x) => x.id !== m.id))}
                className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                aria-label={`Remove ${m.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Medication (generic)" className="sm:col-span-2" hint={`${generics.length} generics · ${state.inventory.length} stocked variants`}>
            <select
              className="input"
              value={form.generic}
              onChange={(e) => {
                const generic = e.target.value;
                const first = generics.find((g) => g.name === generic)?.variants[0];
                setForm((f) => ({
                  ...f,
                  generic,
                  itemId: first?.id ?? '',
                  route: first ? routeForForm(first.form) : f.route,
                  qtyTouched: false,
                }));
                setAcknowledged(false);
              }}
            >
              <option value="">Select from formulary…</option>
              {genericGroups.map((g) => (
                <optgroup key={g.category} label={g.category}>
                  {g.rows.map((row) => (
                    <option key={row.name} value={row.name}>
                      {row.name}
                      {row.variants.length > 1 ? ` (${row.variants.length} variants)` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field
            label="Strength / variant"
            className="sm:col-span-2"
            hint={item ? `${item.stock} ${item.unit} on hand · ${peso(item.price)} per ${item.unit}` : 'Pick a generic first.'}
          >
            <select
              className="input"
              value={form.itemId}
              disabled={!form.generic}
              onChange={(e) => {
                const picked = findBy(state.inventory, e.target.value);
                setForm((f) => ({
                  ...f,
                  itemId: e.target.value,
                  route: picked ? routeForForm(picked.form) : f.route,
                  qtyTouched: false,
                }));
                setAcknowledged(false);
              }}
            >
              {!form.generic && <option value="">—</option>}
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.strength} · {v.form}
                  {stockStatus(v) === 'Out of Stock' ? ' — out of stock' : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Frequency">
            <select
              className="input"
              value={form.freq}
              onChange={(e) => setForm((f) => ({ ...f, freq: e.target.value }))}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.code} value={f.code}>{f.code} — {f.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Duration (days)">
            <input
              type="number"
              min={1}
              max={180}
              className="input nums"
              value={form.days}
              onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))}
            />
          </Field>

          <Field
            label={`Quantity to dispense${item ? ` (${item.unit})` : ''}`}
            hint={
              wholePack
                ? `Dispensed whole — defaults to 1 ${item.unit}`
                : suggestedQty
                  ? `Auto: ${suggestedQty} from ${form.freq} x ${form.days}d`
                  : 'PRN — enter manually'
            }
          >
            <input
              type="number"
              min={1}
              className="input nums"
              value={qty}
              onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value, qtyTouched: true }))}
            />
          </Field>

          <Field label="Route">
            <select
              className="input"
              value={form.route}
              onChange={(e) => setForm((f) => ({ ...f, route: e.target.value }))}
            >
              {ROUTES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>

          <Field label="Instructions (Sig)" className="sm:col-span-2">
            <input
              className="input"
              placeholder="e.g. Take after meals. Complete the full course."
              value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            />
          </Field>
        </div>

        {/* Keyword allergy screen — not a substitute for an interaction database. */}
        {flags.map((f) => (
          <div
            key={f.id}
            className={cx(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
              f.severity === 'high'
                ? 'border-rose-300 bg-rose-50 text-rose-900'
                : 'border-amber-300 bg-amber-50 text-amber-900',
            )}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-bold">
                {f.severity === 'high' ? 'Allergy conflict' : 'Caution'} — documented “{f.allergy}”
              </p>
              <p>{f.note}</p>
            </div>
          </div>
        ))}

        {blocking.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-800">
            <input
              type="checkbox"
              className="h-4 w-4 accent-rose-600"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I have reviewed the allergy history and accept responsibility for this prescription.
          </label>
        )}

        {item && stock !== 'In Stock' && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <Package className="h-4 w-4 shrink-0" />
            {stock === 'Out of Stock'
              ? 'Out of stock at the clinic pharmacy — patient will have to buy this outside.'
              : `Low stock: only ${item.stock} ${item.unit} left.`}
          </p>
        )}
        {item && stock === 'In Stock' && shortStock && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <Package className="h-4 w-4 shrink-0" />
            Pharmacy has {item.stock} {item.unit} — short of the {qty} needed for this course.
          </p>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={add} className="btn-primary btn-sm">
            <Plus className="h-3.5 w-3.5" /> Add medication
          </button>
          {form.itemId && (
            <button type="button" onClick={reset} className="btn-ghost btn-sm">Clear</button>
          )}
        </div>
      </div>
    </section>
  );
}

function RecordsSearch({ onOpenChart }) {
  const { state } = useClinic();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('patients');

  const q = query.trim().toLowerCase();

  const patients = useMemo(() => {
    if (scope !== 'patients') return [];
    const list = state.patients;
    if (!q) return list;
    return list.filter(
      (p) =>
        patientName(p).toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.mobile.replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
        (p.conditions ?? []).some((c) => c.toLowerCase().includes(q)),
    );
  }, [state.patients, q, scope]);

  const encounters = useMemo(() => {
    if (scope !== 'encounters') return [];
    const list = state.encounters.slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!q) return list.slice(0, 20);
    return list.filter((e) => {
      const p = findBy(state.patients, e.patientId);
      return (
        patientName(p).toLowerCase().includes(q) ||
        e.chiefComplaint.toLowerCase().includes(q) ||
        (e.diagnoses ?? []).some((d) => d.code.toLowerCase().includes(q) || d.label.toLowerCase().includes(q)) ||
        (e.meds ?? []).some((m) => m.name.toLowerCase().includes(q))
      );
    });
  }, [state.encounters, state.patients, q, scope]);

  return (
    <div className="space-y-4">
      <div className="card card-pad">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9"
              placeholder={
                scope === 'patients'
                  ? 'Search by name, patient number, mobile or condition…'
                  : 'Search by complaint, diagnosis, ICD-10 code or drug…'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {[
              { id: 'patients', label: 'Patients' },
              { id: 'encounters', label: 'Encounters' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id)}
                className={cx(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  scope === s.id ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {scope === 'patients' && (
        <div className="card overflow-hidden">
          <div className="card-head">
            <h2 className="card-title">Patients</h2>
            <Badge tone="bg-slate-100 text-slate-500">{patients.length}</Badge>
          </div>
          <div className="divide-y divide-slate-100">
            {patients.length === 0 && <EmptyState icon={Search} title="No matching patients" />}
            {patients.map((p) => {
              const visits = state.encounters.filter((e) => e.patientId === p.id);
              const last = visits.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onOpenChart(p.id)}
                  className="row-hover flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <Avatar name={patientName(p)} tone="bg-teal-100 text-teal-700" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-slate-900">{patientName(p)}</span>
                      {(p.allergies ?? []).length > 0 && (
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-500" aria-label="Has allergies" />
                      )}
                      {isSenior(p) && <Badge tone="bg-emerald-100 text-emerald-700">SC</Badge>}
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {p.id} · {ageLabel(p.dob)} · {p.sex}
                      {p.conditions?.length ? ` · ${p.conditions.join(', ')}` : ''}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="nums text-xs font-semibold text-slate-700">{visits.length} visits</div>
                    <div className="text-[11px] text-slate-400">{last ? fmtDate(last.date) : 'never seen'}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {scope === 'encounters' && (
        <div className="space-y-3">
          {encounters.length === 0 && (
            <div className="card"><EmptyState icon={Search} title="No matching encounters" /></div>
          )}
          {encounters.map((e) => (
            <EncounterCard
              key={e.id}
              encounter={e}
              patient={findBy(state.patients, e.patientId)}
              showPatient
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== 8. Patient portal ======================================================== */

function PatientPortal() {
  const { state, patientId, me } = useClinic();
  const [tab, setTab] = useState('home');
  const patient = findBy(state.patients, patientId);

  const upcoming = state.appointments.filter(
    (a) => a.patientId === patientId && a.date >= ymd() && !['Completed', 'Cancelled'].includes(a.status),
  );

  const tabs = [
    { id: 'home', label: 'My visit', icon: Home },
    { id: 'book', label: 'Book appointment', icon: CalendarPlus, count: upcoming.length },
    { id: 'records', label: 'My records', icon: FileText },
    { id: 'messages', label: 'Messages', icon: MessageSquare, count: unreadThreadCount(state, me) },
  ];

  return (
    <>
      <SubNav tabs={tabs} active={tab} onChange={setTab} role="patient" />
      <main className="mx-auto max-w-5xl px-4 py-5">
        {tab === 'home' && <PatientDashboard patient={patient} onBook={() => setTab('book')} />}
        {tab === 'book' && <BookAppointment patient={patient} onBooked={() => setTab('home')} />}
        {tab === 'records' && <PatientRecords patient={patient} />}
        {tab === 'messages' && <MessagesPanel accent="indigo" />}
      </main>
    </>
  );
}

function PatientDashboard({ patient, onBook }) {
  const { state, toast } = useClinic();

  const myQueue = state.queue.find(
    (q) => q.patientId === patient?.id && isToday(q.checkedInAt) && q.status !== 'Completed',
  );
  const waitingAhead = myQueue
    ? state.queue.filter(
        (q) =>
          isToday(q.checkedInAt) &&
          q.status === 'Waiting' &&
          (q.priority === myQueue.priority ? q.number < myQueue.number : q.priority),
      ).length
    : 0;
  const nowServing = state.queue
    .filter((q) => isToday(q.checkedInAt) && q.status === 'In Consultation')
    .sort((a, b) => a.number - b.number)[0];

  const nextAppt = state.appointments
    .filter((a) => a.patientId === patient?.id && a.date >= ymd() && !['Completed', 'Cancelled'].includes(a.status))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];

  const lastEncounter = state.encounters
    .filter((e) => e.patientId === patient?.id)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const openBalance = state.invoices
    .filter((i) => i.patientId === patient?.id && i.status === 'Pending')
    .reduce((sum, i) => sum + invoiceTotals(i).total, 0);

  const teleToday = nextAppt?.mode === 'Teleconsult' && nextAppt.date === ymd();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Hi, {patient?.firstName}</h1>
        <p className="text-sm text-slate-500">
          {patient?.id} · PhilHealth {patient?.philhealth || 'not on file'}
        </p>
      </div>

      {/* Live queue position */}
      {myQueue ? (
        <section className="card overflow-hidden border-indigo-200">
          <div className="bg-indigo-600 px-5 py-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-100">
              {myQueue.status === 'In Consultation' ? 'You are being seen now' : 'You are in the queue'}
            </p>
            <div className="mt-1 flex items-end gap-3">
              <span className="nums text-4xl font-bold leading-none">#{myQueue.number}</span>
              <span className="pb-1 text-sm text-indigo-100">
                {myQueue.status === 'In Consultation'
                  ? `with ${doctorName(findBy(state.doctors, myQueue.doctorId))}`
                  : waitingAhead === 0
                    ? 'You are next'
                    : `${waitingAhead} ahead of you`}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-100 text-center">
            <div className="px-2 py-3">
              <p className="nums text-lg font-bold text-slate-900">
                {nowServing ? `#${nowServing.number}` : '—'}
              </p>
              <p className="text-[11px] text-slate-500">Now serving</p>
            </div>
            <div className="px-2 py-3">
              <p className="nums text-lg font-bold text-slate-900">{fmtDuration(minsSince(myQueue.checkedInAt))}</p>
              <p className="text-[11px] text-slate-500">Since check-in</p>
            </div>
            <div className="px-2 py-3">
              <p className="nums text-lg font-bold text-slate-900">~{Math.max(5, waitingAhead * 12)}m</p>
              <p className="text-[11px] text-slate-500">Est. wait</p>
            </div>
          </div>
          {myQueue.priority && (
            <p className="border-t border-slate-100 bg-emerald-50 px-5 py-2 text-xs text-emerald-800">
              <BadgeCheck className="mr-1 inline h-3.5 w-3.5" />
              Priority lane — Senior Citizen / PWD, per R.A. 9994 and R.A. 10754.
            </p>
          )}
        </section>
      ) : (
        <section className="card card-pad flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">You are not in today&apos;s queue</h2>
            <p className="text-xs text-slate-500">Book ahead, or walk in and register at the front desk.</p>
          </div>
          <button type="button" className="btn-indigo btn-sm" onClick={onBook}>
            <CalendarPlus className="h-3.5 w-3.5" /> Book an appointment
          </button>
        </section>
      )}

      <PatientReminders patient={patient} />

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="card card-pad">
          <h2 className="card-title mb-2">Next appointment</h2>
          {nextAppt ? (
            <>
              <p className="text-sm font-semibold text-slate-900">
                {fmtLongDate(nextAppt.date)} · <span className="nums">{nextAppt.time}</span>
              </p>
              <p className="text-xs text-slate-600">{doctorName(findBy(state.doctors, nextAppt.doctorId))}</p>
              {nextAppt.mode !== 'Teleconsult' && locationById(findBy(state.doctors, nextAppt.doctorId), nextAppt.locationId) && (
                <p className="mt-0.5 flex items-start gap-1 text-xs text-slate-500">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                  <span>
                    <span className="font-medium text-slate-700">
                      {locationById(findBy(state.doctors, nextAppt.doctorId), nextAppt.locationId).name}
                    </span>
                    {/* A location added but not yet addressed shouldn't trail a dash. */}
                    {locationById(findBy(state.doctors, nextAppt.doctorId), nextAppt.locationId).address
                      ? ` — ${locationById(findBy(state.doctors, nextAppt.doctorId), nextAppt.locationId).address}`
                      : ''}
                  </span>
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500">{nextAppt.complaint}</p>
              <div className="mt-3 flex items-center gap-2">
                <StatusBadge status={nextAppt.status} />
                <Badge tone="bg-slate-100 text-slate-600" icon={nextAppt.mode === 'Teleconsult' ? Video : Hospital}>
                  {nextAppt.mode}
                </Badge>
              </div>
            </>
          ) : (
            <EmptyState icon={Calendar} title="Nothing booked" hint="Your next visit will show up here." />
          )}
        </section>

        <section className="card card-pad">
          <h2 className="card-title mb-2">Account</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Outstanding balance</dt>
              <dd className={cx('nums font-bold', openBalance > 0 ? 'text-amber-700' : 'text-emerald-700')}>
                {peso(openBalance)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Last visit</dt>
              <dd className="font-medium text-slate-800">{lastEncounter ? fmtDate(lastEncounter.date) : '—'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Allergies</dt>
              <dd className="text-right">
                {(patient?.allergies ?? []).length ? (
                  <span className="text-xs font-semibold text-rose-600">{patient.allergies.join(', ')}</span>
                ) : (
                  <span className="text-xs text-slate-500">None on file</span>
                )}
              </dd>
            </div>
          </dl>
          {openBalance > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              Settle your balance at the front desk before your next visit.
            </p>
          )}
        </section>
      </div>

      {/* Teleconsult waiting room */}
      <section className={cx('card card-pad', teleToday ? 'border-indigo-200 bg-indigo-50' : '')}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-600 text-white">
            <Video className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Teleconsult waiting room</h2>
            <p className="text-xs text-slate-600">
              {teleToday
                ? `Your room opens 10 minutes before ${nextAppt.time}.`
                : 'Opens on the day of a teleconsultation appointment.'}
            </p>
          </div>
          <button
            type="button"
            disabled={!teleToday}
            onClick={() => toast('Teleconsult links are simulated in this demo.', 'warn')}
            className="btn-indigo btn-sm"
          >
            <Monitor className="h-3.5 w-3.5" /> Enter room
          </button>
        </div>
        {teleToday && (
          <p className="mt-3 truncate rounded-lg bg-white px-3 py-2 font-mono text-[11px] text-slate-500">
            {nextAppt.link || `https://meet.mediclinic.ph/room/${nextAppt.id.toLowerCase()}`}
          </p>
        )}
      </section>
    </div>
  );
}

function BookAppointment({ patient, onBooked }) {
  const { state, act, toast } = useClinic();
  /* Single-doctor clinic: there is nobody to choose between, so booking starts
     at the calendar instead of a department and doctor step. */
  const doctor = state.doctors[0];
  const doctorId = doctor?.id ?? '';
  const dept = doctor?.dept ?? '';
  const locations = doctor?.locations ?? [];
  const [locationId, setLocationId] = useState(() => primaryLocation(doctor)?.id ?? '');
  const location = locationById(doctor, locationId);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [mode, setMode] = useState('In-clinic');
  const [complaint, setComplaint] = useState('');

  /* Slots already taken for that doctor on that date. Clinic days are display-only
     for now — booking does not enforce them yet (CLAUDE.md gap 9). */
  const taken = useMemo(
    () =>
      state.appointments
        .filter((a) => a.doctorId === doctorId && a.date === date && a.status !== 'Cancelled')
        .map((a) => a.time),
    [state.appointments, doctorId, date],
  );

  const ready = !!(doctorId && (locations.length === 0 || locationId) && date && time && complaint.trim());

  const book = () => {
    if (!ready) {
      toast('Complete every step before confirming.', 'warn');
      return;
    }
    const appointment = {
      id: nextId('A', state.appointments),
      patientId: patient.id,
      doctorId,
      dept,
      locationId: mode === 'Teleconsult' ? '' : locationId,
      date,
      time,
      mode,
      complaint: complaint.trim(),
      status: 'Confirmed',
      createdAt: new Date().toISOString(),
      link: mode === 'Teleconsult' ? `https://meet.mediclinic.ph/room/${Date.now().toString(36)}` : '',
    };
    act({ type: 'ADD_APPOINTMENT', appointment });
    toast(
      `Booked: ${fmtDate(date)} at ${time} with ${doctorName(doctor)}` +
        (mode === 'Teleconsult' ? ' (teleconsult)' : location ? ` · ${location.name}` : ''),
      'success',
    );
    onBooked();
  };

  const steps = [
    ...(locations.length > 1 ? [{ n: 0, label: 'Location', done: !!locationId }] : []),
    { n: 1, label: 'Date & time', done: !!(date && time) },
    { n: 2, label: 'Visit details', done: !!complaint.trim() },
  ].map((s, i) => ({ ...s, n: i + 1 }));

  return (
    <div className="space-y-4">
      <div className="card card-pad">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
          {steps.map((s, i) => (
            <li key={s.n} className="flex items-center gap-2">
              <span
                className={cx(
                  'nums grid h-6 w-6 place-items-center rounded-full font-bold',
                  s.done ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400',
                )}
              >
                {s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.n}
              </span>
              <span className={cx('font-semibold', s.done ? 'text-slate-800' : 'text-slate-400')}>{s.label}</span>
              {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
            </li>
          ))}
        </ol>
      </div>

      {/* With one doctor there is nothing to pick, so show who you will be seeing. */}
      <section className="card card-pad">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={doctor?.name ?? ''} tone="bg-indigo-100 text-indigo-700" size="h-11 w-11 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">{doctorName(doctor)}{doctor?.title ? `, ${doctor.title}` : ''}</p>
            <p className="text-xs text-slate-600">{doctor?.specialty}</p>
            <p className="text-[11px] text-slate-400">{location?.days} · {location?.hours}</p>
          </div>
          <span className="nums text-sm font-semibold text-slate-600">{peso(location?.fee ?? 0)}</span>
        </div>

        {locations.length > 1 && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="label">Where would you like to be seen?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => { setLocationId(loc.id); setTime(''); }}
                  className={cx(
                    'rounded-lg border px-3 py-2.5 text-left transition',
                    locationId === loc.id
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate text-sm font-semibold text-slate-900">{loc.name}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{loc.address}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    {loc.days} · {loc.hours} · {peso(loc.fee)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card card-pad">
          <h2 className="card-title mb-3">1. Pick a date and time</h2>
          <Field label="Date" className="mb-3 max-w-xs">
            <input
              type="date"
              className="input"
              min={ymd()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setTime('');
              }}
            />
          </Field>
          {date && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-8">
              {TIME_SLOTS.map((slot) => {
                const isTaken = taken.includes(slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={isTaken}
                    onClick={() => setTime(slot)}
                    className={cx(
                      'nums rounded-lg border px-2 py-2 text-xs font-semibold transition',
                      isTaken
                        ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300 line-through'
                        : time === slot
                          ? 'border-indigo-500 bg-indigo-600 text-white'
                          : 'border-slate-200 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50',
                    )}
                  >
                    {slot}
                  </button>
                );
              })}
            </div>
          )}
      </section>

      {time && (
        <section className="card card-pad">
          <h2 className="card-title mb-3">2. Visit details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Consultation mode">
              <div className="flex gap-2">
                {[
                  { id: 'In-clinic', icon: Hospital },
                  { id: 'Teleconsult', icon: Video },
                ].map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={cx(
                        'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition',
                        mode === m.id
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      <Icon className="h-4 w-4" /> {m.id}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Reason for visit" required className="sm:col-span-2">
              <textarea
                className="input min-h-[72px] resize-y"
                placeholder="Briefly describe your symptoms or the reason for the visit…"
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-600">
              <p className="font-semibold text-slate-800">
                {doctorName(doctor)} · {fmtDate(date)} at {time}
              </p>
              <p>
                {mode === 'Teleconsult' ? 'Teleconsult' : location?.name ?? 'In-clinic'} · estimated{' '}
                {peso(mode === 'Teleconsult' ? 400 : location?.fee ?? 500)} consultation fee
              </p>
              <p className="mt-0.5 text-slate-400">SMS reminders are simulated in this demo.</p>
            </div>
            <button type="button" onClick={book} disabled={!ready} className="btn-indigo">
              <CheckCircle2 className="h-4 w-4" /> Confirm booking
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function PatientRecords({ patient }) {
  const { state, openPrint } = useClinic();
  const [verifying, setVerifying] = useState(null);

  const encounters = useMemo(
    () =>
      state.encounters
        .filter((e) => e.patientId === patient?.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [state.encounters, patient],
  );

  const rx = useMemo(
    () =>
      encounters.flatMap((e) =>
        (e.meds ?? []).map((m) => ({ med: m, encounter: e, active: isRxActive(m, e.date) })),
      ),
    [encounters],
  );
  const active = rx.filter((r) => r.active);
  const past = rx.filter((r) => !r.active);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">My records</h1>
          <p className="text-sm text-slate-500">{encounters.length} visits on file</p>
        </div>
        {encounters[0] && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() =>
              openPrint({
                title: 'Medical abstract',
                subtitle: `${patientName(patient)} · ${fmtDate(encounters[0].date)}`,
                doc: (
                  <MedicalCertificateDoc
                    kind="abstract"
                    encounter={encounters[0]}
                    patient={patient}
                    doctor={findBy(state.doctors, encounters[0].doctorId)}
                  />
                ),
              })
            }
          >
            <Download className="h-3.5 w-3.5" /> Download latest summary
          </button>
        )}
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Active prescriptions</h2>
          <Badge tone="bg-emerald-100 text-emerald-700">{active.length} active</Badge>
        </div>
        <div className="divide-y divide-slate-100">
          {active.length === 0 && (
            <EmptyState icon={Pill} title="No active prescriptions" hint="Courses that have run their duration move to history below." />
          )}
          {active.map(({ med, encounter }) => (
            <div key={`${encounter.id}-${med.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                <Pill className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{med.name} {med.strength}</p>
                <p className="text-xs text-slate-600">
                  {FREQUENCIES.find((f) => f.code === med.freq)?.label ?? med.freq} · until{' '}
                  {fmtDate(rxEndDate(med, encounter.date))}
                </p>
                {med.instructions && <p className="text-[11px] italic text-slate-500">{med.instructions}</p>}
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setVerifying({ encounter, med })}
              >
                <QrCode className="h-3.5 w-3.5" /> Verify
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() =>
                  openPrint({
                    title: 'Prescription',
                    subtitle: `${patientName(patient)} · ${fmtDate(encounter.date)}`,
                    doc: (
                      <PrescriptionDoc
                        encounter={encounter}
                        patient={patient}
                        doctor={findBy(state.doctors, encounter.doctorId)}
                      />
                    ),
                  })
                }
              >
                <Printer className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
          ))}
        </div>
      </section>

      {past.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Prescription history</h2>
            <Badge tone="bg-slate-100 text-slate-500">{past.length}</Badge>
          </div>
          <ul className="divide-y divide-slate-100">
            {past.map(({ med, encounter }) => (
              <li key={`${encounter.id}-${med.id}`} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-700">{med.name} {med.strength}</span>
                  <span className="block text-xs text-slate-400">
                    {fmtDate(encounter.date)} · {doctorName(findBy(state.doctors, encounter.doctorId))}
                  </span>
                </span>
                <StatusBadge status="Expired" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Visit history</h2>
          <Badge tone="bg-slate-100 text-slate-500">{encounters.length}</Badge>
        </div>
        <div className="space-y-3 p-4">
          {encounters.length === 0 && <EmptyState icon={ClipboardList} title="No visits yet" />}
          {encounters.map((e) => (
            <EncounterCard key={e.id} encounter={e} patient={patient} />
          ))}
        </div>
      </section>

      {/* Simulated verification — FakeQR draws a deterministic pattern only. */}
      <Modal
        open={!!verifying}
        onClose={() => setVerifying(null)}
        title="Prescription verification"
        subtitle="Show this at the pharmacy"
        size="sm"
      >
        {verifying && (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <FakeQR
              value={`${CLINIC.website}/verify/rx/${verifying.encounter.id}/${verifying.med.id}`}
              size={160}
              className="ring-1 ring-slate-200"
            />
            <div>
              <p className="text-sm font-bold text-slate-900">
                {verifying.med.name} {verifying.med.strength}
              </p>
              <p className="text-xs text-slate-600">
                {doctorName(findBy(state.doctors, verifying.encounter.doctorId))} ·{' '}
                {fmtDate(verifying.encounter.date)}
              </p>
            </div>
            <Badge tone="bg-emerald-100 text-emerald-700" icon={ShieldCheck}>
              Valid until {fmtDate(rxEndDate(verifying.med, verifying.encounter.date))}
            </Badge>
            <p className="max-w-xs text-[11px] leading-snug text-slate-500">
              Demo only — the QR encodes a placeholder URL. A real build signs a verification
              endpoint that the pharmacy can check.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ===== 9. Staff portal ========================================================== */

function StaffPortal() {
  const { state, me } = useClinic();
  const [tab, setTab] = useState('queue');
  const [chartId, setChartId] = useState(null);
  const [checkInFor, setCheckInFor] = useState(undefined); // undefined = closed, null = new, patient = prefilled

  const todayQueue = state.queue.filter((q) => isToday(q.checkedInAt));
  const waiting = todayQueue.filter((q) => q.status === 'Waiting');
  const pending = state.invoices.filter((i) => i.status === 'Pending');
  const lowStock = state.inventory.filter((i) => stockStatus(i) !== 'In Stock');

  const tabs = [
    { id: 'queue', label: 'Reception', icon: Users, count: waiting.length },
    { id: 'patients', label: 'Patients', icon: ClipboardList },
    { id: 'pharmacy', label: 'Pharmacy', icon: Boxes, count: lowStock.length },
    { id: 'billing', label: 'Billing', icon: PhilippinePeso, count: pending.length },
    { id: 'followups', label: 'Follow-ups', icon: CalendarClock, count: dueReminders(state).length },
    { id: 'messages', label: 'Messages', icon: MessageSquare, count: unreadThreadCount(state, me) },
    { id: 'accounts', label: 'Accounts', icon: ShieldCheck },
  ];

  return (
    <>
      <SubNav tabs={tabs} active={tab} onChange={setTab} role="staff" />
      <main className="mx-auto max-w-7xl px-4 py-5">
        {tab === 'queue' && (
          <ReceptionQueue
            onOpenChart={setChartId}
            checkInFor={checkInFor}
            setCheckInFor={setCheckInFor}
          />
        )}
        {tab === 'patients' && (
          <PatientDirectory onOpenChart={setChartId} onCheckIn={(p) => setCheckInFor(p)} />
        )}
        {tab === 'pharmacy' && <Pharmacy />}
        {tab === 'billing' && <Billing />}
        {tab === 'followups' && <FollowUpQueue />}
        {tab === 'messages' && <MessagesPanel accent="sky" />}
        {tab === 'accounts' && <AccountsPanel accent="sky" />}
      </main>
      <PatientChart
        patientId={chartId}
        open={!!chartId}
        onClose={() => setChartId(null)}
        onCheckIn={(p) => {
          setChartId(null);
          setCheckInFor(p);
        }}
      />
    </>
  );
}

const QUEUE_FLOW = {
  Waiting: ['In Consultation', 'Cancelled'],
  'In Consultation': ['Completed', 'Waiting'],
  Completed: [],
  Cancelled: ['Waiting'],
};

function ReceptionQueue({ onOpenChart, checkInFor, setCheckInFor }) {
  const { state, act, toast } = useClinic();

  const todayQueue = useMemo(
    () => state.queue.filter((q) => isToday(q.checkedInAt)).sort((a, b) => a.number - b.number),
    [state.queue],
  );
  const waiting = todayQueue.filter((q) => q.status === 'Waiting');
  const serving = todayQueue.filter((q) => q.status === 'In Consultation');
  const done = todayQueue.filter((q) => q.status === 'Completed');

  /* The single now-serving board shows the lowest number currently in a room,
     with the head of the waiting line beneath it. */
  const nowServing = serving[0] ?? null;
  const upNext = waiting[0] ?? null;
  const servingDoctor = nowServing ? findBy(state.doctors, nowServing.doctorId) : null;

  const todayAppts = state.appointments
    .filter((a) => a.date === ymd() && !['Completed', 'Cancelled', 'Checked In'].includes(a.status))
    .sort((a, b) => a.time.localeCompare(b.time));

  const move = (item, status) => {
    const patch = { status };
    if (status === 'In Consultation') patch.startedAt = new Date().toISOString();
    if (status === 'Completed') patch.completedAt = new Date().toISOString();
    act({ type: 'UPDATE_QUEUE', id: item.id, patch });
    toast(`#${item.number} → ${status}`, 'success');
  };

  return (
    <div className="space-y-5">
      {/* Now-serving board */}
      <section className="card overflow-hidden">
        <div className="card-head">
          <h2 className="card-title">Now serving</h2>
          <div className="flex items-center gap-2">
            <Badge tone="bg-amber-100 text-amber-800">{waiting.length} waiting</Badge>
            <button type="button" className="btn-sky btn-sm" onClick={() => setCheckInFor(null)}>
              <UserPlus className="h-3.5 w-3.5" /> Check in patient
            </button>
          </div>
        </div>
        {/* One board for the whole clinic: whoever is in a room right now, and who
            is up next. `serving` and `waiting` are already ordered by queue number. */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
          <div className="min-w-0">
            <p className={cx('nums text-5xl font-bold leading-none', nowServing ? 'text-sky-700' : 'text-slate-300')}>
              {nowServing ? `#${nowServing.number}` : '—'}
            </p>
            {nowServing ? (
              <>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className="truncate">{patientName(findBy(state.patients, nowServing.patientId))}</span>
                  {nowServing.priority && <Badge tone="bg-rose-100 text-rose-700">Priority</Badge>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {doctorName(servingDoctor)}
                  {primaryLocation(servingDoctor)?.room ? ` · ${primaryLocation(servingDoctor).room}` : ''}
                  {nowServing.startedAt ? ` · in consultation ${fmtDuration(minsSince(nowServing.startedAt))}` : ''}
                </p>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-sm font-semibold text-slate-900">No one in consultation</p>
                <p className="text-xs text-slate-500">
                  {waiting.length ? 'The doctor calls in the next patient from the queue.' : 'The queue is clear.'}
                </p>
              </>
            )}
          </div>

          <div className="ml-auto text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Next in line</p>
            <p className={cx('nums text-xl font-bold leading-tight', upNext ? 'text-slate-800' : 'text-slate-300')}>
              {upNext ? `#${upNext.number}` : '—'}
            </p>
            <p className="truncate text-xs text-slate-500">
              {upNext ? patientName(findBy(state.patients, upNext.patientId)) : 'nobody waiting'}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Queue controller */}
        <section className="card lg:col-span-2">
          <div className="card-head">
            <h2 className="card-title">Today&apos;s queue</h2>
            <span className="text-xs text-slate-500">{done.length} completed · {todayQueue.length} total</span>
          </div>
          <div className="divide-y divide-slate-100">
            {todayQueue.length === 0 && (
              <EmptyState
                icon={Users}
                title="No one checked in yet"
                hint="Check in a walk-in or pull a booked appointment from the panel on the right."
                action={
                  <button type="button" className="btn-sky btn-sm" onClick={() => setCheckInFor(null)}>
                    <UserPlus className="h-3.5 w-3.5" /> Check in patient
                  </button>
                }
              />
            )}
            {todayQueue.map((q) => {
              const patient = findBy(state.patients, q.patientId);
              const doctor = findBy(state.doctors, q.doctorId);
              return (
                <div key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span
                    className={cx(
                      'nums grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-bold',
                      q.status === 'In Consultation'
                        ? 'bg-sky-600 text-white'
                        : q.status === 'Waiting'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-400',
                    )}
                  >
                    {q.number}
                  </span>

                  <button type="button" onClick={() => onOpenChart(q.patientId)} className="min-w-0 flex-1 text-left">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-slate-900">{patientName(patient)}</span>
                      {q.priority && <Badge tone="bg-rose-100 text-rose-700">Priority</Badge>}
                      {(patient?.allergies ?? []).length > 0 && (
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-500" aria-label="Has allergies" />
                      )}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {q.reason} · {doctorName(doctor)}
                    </span>
                  </button>

                  <div className="hidden text-right sm:block">
                    <div className="nums text-xs font-semibold text-slate-700">{fmtTime(q.checkedInAt)}</div>
                    <div className="text-[10px] text-slate-400">
                      {q.status === 'Completed' ? 'checked in' : `${fmtDuration(minsSince(q.checkedInAt))} ago`}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        act({ type: 'UPDATE_QUEUE', id: q.id, patch: { priority: !q.priority } });
                        toast(q.priority ? 'Priority removed' : 'Marked priority (SC/PWD/pregnant)', 'success');
                      }}
                      className={cx(
                        'rounded-lg border px-2 py-1.5 text-xs font-semibold transition',
                        q.priority
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50',
                      )}
                      title="Toggle priority lane"
                    >
                      <Zap className="h-3.5 w-3.5" />
                    </button>

                    {QUEUE_FLOW[q.status].length > 0 ? (
                      <select
                        className="input !w-auto !py-1.5 text-xs"
                        value=""
                        onChange={(e) => e.target.value && move(q, e.target.value)}
                        aria-label={`Change status for queue number ${q.number}`}
                      >
                        <option value="">{q.status}</option>
                        {QUEUE_FLOW[q.status].map((s) => (
                          <option key={s} value={s}>→ {s}</option>
                        ))}
                      </select>
                    ) : (
                      <StatusBadge status={q.status} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Booked appointments awaiting arrival */}
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Expected today</h2>
            <Badge tone="bg-slate-100 text-slate-500">{todayAppts.length}</Badge>
          </div>
          <ul className="divide-y divide-slate-100">
            {todayAppts.length === 0 && (
              <li><EmptyState icon={Calendar} title="No one else expected" hint="All booked appointments have arrived." /></li>
            )}
            {todayAppts.map((a) => {
              const patient = findBy(state.patients, a.patientId);
              return (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="nums w-16 shrink-0 text-xs font-bold text-slate-700">{a.time}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {patientName(patient)}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {doctorName(findBy(state.doctors, a.doctorId))}
                      </span>
                    </span>
                    {a.mode === 'Teleconsult' && <Video className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">{a.complaint}</p>
                  <button
                    type="button"
                    className="btn-ghost btn-sm mt-2 w-full"
                    onClick={() => setCheckInFor({ ...patient, _appointment: a })}
                  >
                    <LogIn className="h-3.5 w-3.5" /> Check in
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <CheckInForm
        open={checkInFor !== undefined}
        prefill={checkInFor}
        onClose={() => setCheckInFor(undefined)}
      />
    </div>
  );
}

const emptyNewPatient = {
  firstName: '', lastName: '', sex: 'Female', dob: '', mobile: '', email: '',
  address: '', philhealth: '', bloodType: '', allergies: '', conditions: '',
  emergencyName: '', emergencyRelation: '', emergencyMobile: '',
};

function CheckInForm({ open, prefill, onClose }) {
  const { state, act, toast } = useClinic();
  const [mode, setMode] = useState('existing');
  const [patientId, setPatientId] = useState('');
  const [search, setSearch] = useState('');
  const [doctorId, setDoctorId] = useState(state.doctors[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState(false);
  const [vitals, setVitals] = useState({ bp: '', hr: '', temp: '', weight: '' });
  const [form, setForm] = useState(emptyNewPatient);
  const [appointmentId, setAppointmentId] = useState('');

  /* Re-seed the form whenever the modal is opened for a different patient. */
  useEffect(() => {
    if (!open) return;
    if (prefill) {
      setMode('existing');
      setPatientId(prefill.id);
      setSearch('');
      setPriority(isSenior(prefill) || !!prefill.pwdId);
      setReason(prefill._appointment?.complaint ?? '');
      setDoctorId(prefill._appointment?.doctorId ?? state.doctors[0]?.id ?? '');
      setAppointmentId(prefill._appointment?.id ?? '');
    } else {
      setMode('existing');
      setPatientId('');
      setSearch('');
      setReason('');
      setPriority(false);
      setAppointmentId('');
      setDoctorId(state.doctors[0]?.id ?? '');
    }
    setVitals({ bp: '', hr: '', temp: '', weight: '' });
    setForm(emptyNewPatient);
  }, [open, prefill, state.doctors]);

  const selected = findBy(state.patients, patientId);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return state.patients.slice(0, 6);
    return state.patients
      .filter(
        (p) =>
          patientName(p).toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.mobile.replace(/\s/g, '').includes(q.replace(/\s/g, '')),
      )
      .slice(0, 8);
  }, [state.patients, search]);

  const nextNumber = useMemo(() => {
    const today = state.queue.filter((q) => isToday(q.checkedInAt));
    return today.reduce((max, q) => Math.max(max, Number(q.number) || 0), 0) + 1;
  }, [state.queue]);

  const submit = () => {
    let targetId = patientId;

    if (mode === 'new') {
      if (!form.firstName.trim() || !form.lastName.trim() || !form.dob || !form.mobile.trim()) {
        toast('First name, last name, birth date and mobile number are required.', 'warn');
        return;
      }
      targetId = nextId('P', state.patients);
      const patient = {
        id: targetId,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        sex: form.sex,
        dob: form.dob,
        mobile: form.mobile.trim(),
        email: form.email.trim(),
        civilStatus: '',
        address: form.address.trim(),
        philhealth: form.philhealth.trim(),
        bloodType: form.bloodType.trim(),
        allergies: form.allergies.split(',').map((s) => s.trim()).filter(Boolean),
        conditions: form.conditions.split(',').map((s) => s.trim()).filter(Boolean),
        emergency: {
          name: form.emergencyName.trim(),
          relation: form.emergencyRelation.trim(),
          mobile: form.emergencyMobile.trim(),
        },
        registeredAt: ymd(),
      };
      act({ type: 'ADD_PATIENT', patient });
    }

    if (!targetId) {
      toast('Select a patient to check in.', 'warn');
      return;
    }
    if (!reason.trim()) {
      toast('Enter the reason for the visit.', 'warn');
      return;
    }

    const item = {
      id: nextId('Q', state.queue),
      number: nextNumber,
      patientId: targetId,
      doctorId,
      type: appointmentId ? 'Appointment' : 'Walk-in',
      reason: reason.trim(),
      priority,
      status: 'Waiting',
      checkedInAt: new Date().toISOString(),
      startedAt: '',
      completedAt: '',
      vitals,
      encounterId: '',
      invoiceId: '',
      draft: null,
      appointmentId,
    };
    act({ type: 'ADD_QUEUE', item });
    if (appointmentId) act({ type: 'UPDATE_APPOINTMENT', id: appointmentId, patch: { status: 'Checked In' } });

    toast(`Checked in as #${nextNumber} — ${reason.trim()}`, 'success');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Check in patient"
      subtitle={`Queue number #${nextNumber} · ${fmtDate(ymd())}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-rose-600"
              checked={priority}
              onChange={(e) => setPriority(e.target.checked)}
            />
            Priority lane (Senior Citizen / PWD / pregnant)
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-sky btn-sm" onClick={submit}>
              <LogIn className="h-3.5 w-3.5" /> Add to queue
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {[
            { id: 'existing', label: 'Existing patient' },
            { id: 'new', label: 'New patient' },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cx(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                mode === m.id ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'existing' ? (
          <div>
            {selected ? (
              <div className="flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5">
                <Avatar name={patientName(selected)} tone="bg-sky-100 text-sky-700" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{patientName(selected)}</p>
                  <p className="truncate text-xs text-slate-600">
                    {selected.id} · {ageLabel(selected.dob)} · {selected.sex} · {selected.mobile}
                  </p>
                  {(selected.allergies ?? []).length > 0 && (
                    <p className="mt-0.5 text-[11px] font-semibold text-rose-600">
                      Allergies: {selected.allergies.join(', ')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setPatientId('');
                    setAppointmentId('');
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    className="input pl-9"
                    placeholder="Search name, patient number or mobile…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 thin-scroll">
                  {matches.length === 0 && (
                    <li className="px-3 py-4 text-center text-xs text-slate-400">
                      No match — switch to “New patient” to register.
                    </li>
                  )}
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPatientId(p.id);
                          setPriority(isSenior(p) || !!p.pwdId);
                        }}
                        className="row-hover flex w-full items-center gap-3 px-3 py-2 text-left"
                      >
                        <Avatar name={patientName(p)} size="h-8 w-8 text-[10px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">{patientName(p)}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {p.id} · {ageLabel(p.dob)} · {p.mobile}
                          </span>
                        </span>
                        {isSenior(p) && <Badge tone="bg-emerald-100 text-emerald-700">SC</Badge>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" required>
              <input className="input" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
            </Field>
            <Field label="Last name" required>
              <input className="input" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
            </Field>
            <Field label="Date of birth" required>
              <input type="date" max={ymd()} className="input" value={form.dob} onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))} />
            </Field>
            <Field label="Sex">
              <select className="input" value={form.sex} onChange={(e) => setForm((f) => ({ ...f, sex: e.target.value }))}>
                <option>Female</option>
                <option>Male</option>
              </select>
            </Field>
            <Field label="Mobile number" required>
              <input className="input nums" placeholder="0917 000 0000" value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} />
            </Field>
            <Field label="Email">
              <input type="email" className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <input className="input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </Field>
            <Field label="PhilHealth number">
              <input className="input nums" placeholder="12-345678901-2" value={form.philhealth} onChange={(e) => setForm((f) => ({ ...f, philhealth: e.target.value }))} />
            </Field>
            <Field label="Blood type">
              <input className="input" placeholder="O+" value={form.bloodType} onChange={(e) => setForm((f) => ({ ...f, bloodType: e.target.value }))} />
            </Field>
            <Field label="Known allergies" hint="Comma-separated — drives the prescribing safety check." className="sm:col-span-2">
              <input className="input" placeholder="Penicillin, Sulfa drugs" value={form.allergies} onChange={(e) => setForm((f) => ({ ...f, allergies: e.target.value }))} />
            </Field>
            <Field label="Chronic conditions" hint="Comma-separated." className="sm:col-span-2">
              <input className="input" placeholder="Hypertension, Asthma" value={form.conditions} onChange={(e) => setForm((f) => ({ ...f, conditions: e.target.value }))} />
            </Field>
            <Field label="Emergency contact">
              <input className="input" value={form.emergencyName} onChange={(e) => setForm((f) => ({ ...f, emergencyName: e.target.value }))} />
            </Field>
            <Field label="Relation">
              <input className="input" value={form.emergencyRelation} onChange={(e) => setForm((f) => ({ ...f, emergencyRelation: e.target.value }))} />
            </Field>
            <Field label="Emergency mobile" className="sm:col-span-2">
              <input className="input nums" value={form.emergencyMobile} onChange={(e) => setForm((f) => ({ ...f, emergencyMobile: e.target.value }))} />
            </Field>
          </div>
        )}

        <div className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <Field label="Attending doctor">
            {state.doctors.length > 1 ? (
              <select className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                {state.doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    Dr. {d.name} · {d.specialty}
                  </option>
                ))}
              </select>
            ) : (
              /* One doctor — assignment is automatic, so just say who. */
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <Avatar name={state.doctors[0]?.name ?? ''} tone="bg-teal-100 text-teal-700" size="h-7 w-7 text-[10px]" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">
                    {doctorName(state.doctors[0])}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">{state.doctors[0]?.specialty}</span>
                </span>
              </div>
            )}
          </Field>
          <Field label="Reason for visit" required>
            <input
              className="input"
              placeholder="e.g. Fever and cough x 2 days"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <span className="label">Triage vitals (optional)</span>
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'bp', placeholder: 'BP 120/80', width: 'w-28' },
                { key: 'hr', placeholder: 'HR', width: 'w-20' },
                { key: 'temp', placeholder: 'Temp °C', width: 'w-24' },
                { key: 'weight', placeholder: 'Weight kg', width: 'w-28' },
              ].map((f) => (
                <input
                  key={f.key}
                  className={cx('input nums', f.width)}
                  placeholder={f.placeholder}
                  value={vitals[f.key]}
                  onChange={(e) => setVitals((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PatientDirectory({ onOpenChart, onCheckIn }) {
  const { state } = useClinic();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const patients = useMemo(() => {
    const list = state.patients.slice().sort((a, b) => a.lastName.localeCompare(b.lastName));
    if (!q) return list;
    return list.filter(
      (p) =>
        patientName(p).toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.mobile.replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
        (p.philhealth ?? '').includes(q),
    );
  }, [state.patients, q]);

  return (
    <div className="space-y-4">
      <div className="card card-pad">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search by name, patient number, mobile or PhilHealth number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <h2 className="card-title">Patient directory</h2>
          <Badge tone="bg-slate-100 text-slate-500">{patients.length} registered</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                <th className="th">Patient</th>
                <th className="th">Contact</th>
                <th className="th">PhilHealth</th>
                <th className="th">Last visit</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {patients.length === 0 && (
                <tr>
                  <td colSpan={5}><EmptyState icon={Search} title="No matching patients" /></td>
                </tr>
              )}
              {patients.map((p) => {
                const visits = state.encounters.filter((e) => e.patientId === p.id);
                const last = visits.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
                const balance = state.invoices
                  .filter((i) => i.patientId === p.id && i.status === 'Pending')
                  .reduce((sum, i) => sum + invoiceTotals(i).total, 0);
                return (
                  <tr key={p.id} className="row-hover">
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={patientName(p)} tone="bg-sky-100 text-sky-700" size="h-8 w-8 text-[10px]" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-semibold text-slate-900">{patientName(p)}</span>
                            {(p.allergies ?? []).length > 0 && (
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-label="Has allergies" />
                            )}
                            {isSenior(p) && <Badge tone="bg-emerald-100 text-emerald-700">SC</Badge>}
                            {p.pwdId && <Badge tone="bg-emerald-100 text-emerald-700">PWD</Badge>}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {p.id} · {ageLabel(p.dob)} · {p.sex}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="td nums text-xs">{p.mobile}</td>
                    <td className="td nums text-xs">{p.philhealth || '—'}</td>
                    <td className="td text-xs">
                      {last ? fmtDate(last.date) : <span className="text-slate-400">never seen</span>}
                      {balance > 0 && (
                        <span className="nums ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          {peso(balance)} due
                        </span>
                      )}
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => onOpenChart(p.id)}>
                          Chart
                        </button>
                        <button type="button" className="btn-sky btn-sm" onClick={() => onCheckIn(p)}>
                          <LogIn className="h-3.5 w-3.5" /> Check in
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const emptyItemForm = { name: '', strength: '', form: 'Tablet', unit: 'tab', category: '', price: '', stock: '', reorderLevel: '' };

function Pharmacy() {
  const { state, act, toast } = useClinic();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [restocking, setRestocking] = useState(null);
  const [restockQty, setRestockQty] = useState('');
  const [adding, setAdding] = useState(false);
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [editingPrice, setEditingPrice] = useState(null);
  const [priceDraft, setPriceDraft] = useState('');

  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    let list = state.inventory.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (filter === 'low') list = list.filter((i) => stockStatus(i) === 'Low Stock');
    if (filter === 'out') list = list.filter((i) => stockStatus(i) === 'Out of Stock');
    if (q) list = list.filter((i) => `${i.name} ${i.strength} ${i.category}`.toLowerCase().includes(q));
    return list;
  }, [state.inventory, filter, q]);

  const lowCount = state.inventory.filter((i) => stockStatus(i) === 'Low Stock').length;
  const outCount = state.inventory.filter((i) => stockStatus(i) === 'Out of Stock').length;
  const stockValue = state.inventory.reduce((sum, i) => sum + Number(i.stock) * Number(i.price), 0);

  const commitRestock = () => {
    const qty = Number(restockQty);
    if (!qty || qty <= 0) {
      toast('Enter a quantity greater than zero.', 'warn');
      return;
    }
    act({ type: 'RESTOCK', id: restocking.id, qty, at: new Date().toISOString() });
    toast(`${restocking.name}: +${qty} ${restocking.unit} received`, 'success');
    setRestocking(null);
    setRestockQty('');
  };

  const commitPrice = (item) => {
    const price = Number(priceDraft);
    if (!Number.isFinite(price) || price < 0) {
      toast('Enter a valid price.', 'warn');
      return;
    }
    act({ type: 'UPDATE_ITEM', id: item.id, patch: { price } });
    setEditingPrice(null);
    toast(`${item.name} priced at ${peso(price)}`, 'success');
  };

  const addItem = () => {
    if (!itemForm.name.trim() || !itemForm.price) {
      toast('Generic name and price are required.', 'warn');
      return;
    }
    act({
      type: 'ADD_ITEM',
      item: {
        id: nextId('I', state.inventory),
        name: itemForm.name.trim(),
        strength: itemForm.strength.trim(),
        form: itemForm.form,
        unit: itemForm.unit.trim() || 'pc',
        category: itemForm.category.trim() || 'Uncategorized',
        price: Number(itemForm.price) || 0,
        stock: Number(itemForm.stock) || 0,
        reorderLevel: Number(itemForm.reorderLevel) || 0,
        brand: 'generic',
      },
    });
    toast(`${itemForm.name.trim()} added to the formulary`, 'success');
    setItemForm(emptyItemForm);
    setAdding(false);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Boxes} label="Formulary items" value={state.inventory.length} tone="sky" />
        <StatCard icon={AlertTriangle} label="Low stock" value={lowCount} sub="at or below reorder level" tone="amber" />
        <StatCard icon={Package} label="Out of stock" value={outCount} tone="rose" />
        <StatCard icon={PhilippinePeso} label="Stock value" value={peso(stockValue)} sub="at selling price" tone="emerald" />
      </div>

      <div className="card card-pad">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search medication or category…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {[
              { id: 'all', label: 'All' },
              { id: 'low', label: `Low (${lowCount})` },
              { id: 'out', label: `Out (${outCount})` },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cx(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  filter === f.id ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn-sky btn-sm" onClick={() => setAdding(true)}>
            <PackagePlus className="h-3.5 w-3.5" /> Add item
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                <th className="th">Medication</th>
                <th className="th">Category</th>
                <th className="th text-right">Price</th>
                <th className="th text-right">On hand</th>
                <th className="th">Status</th>
                <th className="th text-right">Restock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 && (
                <tr><td colSpan={6}><EmptyState icon={Boxes} title="Nothing matches that filter" /></td></tr>
              )}
              {items.map((i) => {
                const status = stockStatus(i);
                return (
                  <tr key={i.id} className="row-hover">
                    <td className="td">
                      <div className="font-semibold text-slate-900">{i.name} {i.strength}</div>
                      <div className="text-xs text-slate-500">{i.form} · {i.id}</div>
                    </td>
                    <td className="td text-xs">{i.category}</td>
                    <td className="td text-right">
                      {/* Inline price edit — the front desk adjusts these often. */}
                      {editingPrice === i.id ? (
                        <span className="flex items-center justify-end gap-1">
                          <input
                            className="input nums !w-24 !py-1 text-right text-xs"
                            type="number"
                            step="0.25"
                            min="0"
                            value={priceDraft}
                            autoFocus
                            onChange={(e) => setPriceDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitPrice(i);
                              if (e.key === 'Escape') setEditingPrice(null);
                            }}
                          />
                          <button type="button" className="btn-primary btn-sm !px-2" onClick={() => commitPrice(i)}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="nums rounded px-1.5 py-0.5 font-semibold text-slate-800 transition hover:bg-slate-100"
                          onClick={() => {
                            setEditingPrice(i.id);
                            setPriceDraft(String(i.price));
                          }}
                          title="Click to edit price"
                        >
                          {peso(i.price)}
                        </button>
                      )}
                    </td>
                    <td className="td nums text-right font-semibold">
                      {i.stock} <span className="text-xs font-normal text-slate-400">{i.unit}</span>
                      <div className="text-[10px] font-normal text-slate-400">reorder at {i.reorderLevel}</div>
                    </td>
                    <td className="td"><StatusBadge status={status} /></td>
                    <td className="td text-right">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          setRestocking(i);
                          setRestockQty('');
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" /> Receive
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!restocking}
        onClose={() => setRestocking(null)}
        title="Receive stock"
        subtitle={restocking ? `${restocking.name} ${restocking.strength} · ${restocking.form}` : ''}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setRestocking(null)}>Cancel</button>
            <button type="button" className="btn-sky btn-sm" onClick={commitRestock}>
              <PackagePlus className="h-3.5 w-3.5" /> Add to stock
            </button>
          </div>
        }
      >
        {restocking && (
          <div className="space-y-3 p-5">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">Current stock</span>
              <span className="nums font-bold text-slate-900">{restocking.stock} {restocking.unit}</span>
            </div>
            <Field label="Quantity received" required>
              <input
                type="number"
                min="1"
                className="input nums"
                value={restockQty}
                autoFocus
                onChange={(e) => setRestockQty(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && commitRestock()}
              />
            </Field>
            {Number(restockQty) > 0 && (
              <p className="text-xs text-slate-600">
                New stock level:{' '}
                <span className="nums font-bold text-slate-900">
                  {Number(restocking.stock) + Number(restockQty)} {restocking.unit}
                </span>
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add formulary item"
        subtitle="Generic names only (R.A. 6675)"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn-sky btn-sm" onClick={addItem}>
              <Plus className="h-3.5 w-3.5" /> Add item
            </button>
          </div>
        }
      >
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <Field label="Generic name" required className="sm:col-span-2">
            <input className="input" placeholder="e.g. Metoprolol" value={itemForm.name} onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Strength">
            <input className="input" placeholder="50 mg" value={itemForm.strength} onChange={(e) => setItemForm((f) => ({ ...f, strength: e.target.value }))} />
          </Field>
          <Field label="Form">
            <select className="input" value={itemForm.form} onChange={(e) => setItemForm((f) => ({ ...f, form: e.target.value }))}>
              {['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Nebule', 'Inhaler (MDI)', 'Ampule', 'Vial', 'Sachet', 'Cream', 'Drops'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <Field label="Unit" hint="tab, cap, mL, pc…">
            <input className="input" value={itemForm.unit} onChange={(e) => setItemForm((f) => ({ ...f, unit: e.target.value }))} />
          </Field>
          <Field label="Category">
            <input className="input" placeholder="Antibiotic" value={itemForm.category} onChange={(e) => setItemForm((f) => ({ ...f, category: e.target.value }))} />
          </Field>
          <Field label="Selling price" required>
            <input type="number" min="0" step="0.25" className="input nums" value={itemForm.price} onChange={(e) => setItemForm((f) => ({ ...f, price: e.target.value }))} />
          </Field>
          <Field label="Opening stock">
            <input type="number" min="0" className="input nums" value={itemForm.stock} onChange={(e) => setItemForm((f) => ({ ...f, stock: e.target.value }))} />
          </Field>
          <Field label="Reorder level" className="sm:col-span-2">
            <input type="number" min="0" className="input nums" value={itemForm.reorderLevel} onChange={(e) => setItemForm((f) => ({ ...f, reorderLevel: e.target.value }))} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function Billing() {
  const { state } = useClinic();
  const [filter, setFilter] = useState('Pending');
  const [openId, setOpenId] = useState(null);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const invoices = useMemo(() => {
    let list = state.invoices.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    if (filter !== 'All') list = list.filter((i) => i.status === filter);
    if (q) {
      list = list.filter((i) => {
        const p = findBy(state.patients, i.patientId);
        return i.id.toLowerCase().includes(q) || patientName(p).toLowerCase().includes(q);
      });
    }
    return list;
  }, [state.invoices, state.patients, filter, q]);

  const pending = state.invoices.filter((i) => i.status === 'Pending');
  const pendingTotal = pending.reduce((sum, i) => sum + invoiceTotals(i).total, 0);
  const paidToday = state.invoices.filter((i) => i.status === 'Paid' && i.paidAt && isToday(i.paidAt));
  const collectedToday = paidToday.reduce((sum, i) => sum + invoiceTotals(i).total, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={ClipboardList} label="Awaiting payment" value={pending.length} sub={peso(pendingTotal)} tone="amber" />
        <StatCard icon={Banknote} label="Collected today" value={peso(collectedToday)} sub={`${paidToday.length} transactions`} tone="emerald" />
        <StatCard
          icon={Syringe}
          label="To dispense"
          value={pending.reduce((n, i) => n + i.items.filter((it) => it.kind === 'drug' && it.dispense).length, 0)}
          sub="drug lines on open statements"
          tone="sky"
        />
        <StatCard icon={FlaskConical} label="Statements" value={state.invoices.length} sub="all time" tone="slate" />
      </div>

      <div className="card card-pad">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search statement number or patient…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            {['Pending', 'Paid', 'All'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cx(
                  'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  filter === f ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead className="border-b border-slate-100 bg-slate-50">
              <tr>
                <th className="th">Statement</th>
                <th className="th">Patient</th>
                <th className="th">Date</th>
                <th className="th text-right">Amount</th>
                <th className="th">Status</th>
                <th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={PhilippinePeso}
                      title={filter === 'Pending' ? 'Nothing awaiting payment' : 'No statements match'}
                      hint={filter === 'Pending' ? 'Completed consultations land here automatically.' : undefined}
                    />
                  </td>
                </tr>
              )}
              {invoices.map((inv) => {
                const totals = invoiceTotals(inv);
                const patient = findBy(state.patients, inv.patientId);
                return (
                  <tr key={inv.id} className="row-hover">
                    <td className="td nums font-semibold text-slate-900">{inv.id}</td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{patientName(patient)}</span>
                        {inv.discountType !== 'None' && (
                          <Badge tone="bg-emerald-100 text-emerald-700">
                            {inv.discountType === 'Senior Citizen' ? 'SC' : 'PWD'}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">{inv.items.length} items</div>
                    </td>
                    <td className="td text-xs">{fmtDate(inv.date)}</td>
                    <td className="td nums text-right font-bold text-slate-900">{peso(totals.total)}</td>
                    <td className="td"><StatusBadge status={inv.status} /></td>
                    <td className="td text-right">
                      <button
                        type="button"
                        className={inv.status === 'Pending' ? 'btn-sky btn-sm' : 'btn-ghost btn-sm'}
                        onClick={() => setOpenId(inv.id)}
                      >
                        {inv.status === 'Pending' ? (
                          <>
                            <Wallet className="h-3.5 w-3.5" /> Collect
                          </>
                        ) : (
                          'View'
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <InvoiceEditor invoiceId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function InvoiceEditor({ invoiceId, onClose }) {
  const { state, act, toast, openPrint } = useClinic();
  const invoice = findBy(state.invoices, invoiceId);
  const [method, setMethod] = useState('Cash');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [addKind, setAddKind] = useState('lab');

  const patient = findBy(state.patients, invoice?.patientId);
  const encounter = findBy(state.encounters, invoice?.encounterId);
  const doctor = findBy(state.doctors, invoice?.doctorId);
  const locked = invoice?.status === 'Paid';

  useEffect(() => {
    if (!invoiceId) return;
    setMethod('Cash');
    setTendered('');
    setReference('');
    setAddKind('lab');
  }, [invoiceId]);

  if (!invoice) return null;

  const totals = invoiceTotals(invoice);
  const change = Math.max(0, Number(tendered || 0) - totals.total);
  const seniorSuggested = isSenior(patient) && invoice.discountType === 'None';

  const patch = (changes) => act({ type: 'UPDATE_INVOICE', id: invoice.id, patch: changes });

  const setItem = (itemId, changes) =>
    patch({ items: invoice.items.map((it) => (it.id === itemId ? { ...it, ...changes } : it)) });

  const addLine = (preset) =>
    patch({
      items: [
        ...invoice.items,
        {
          id: `IT-${invoice.id}-${Date.now()}`,
          label: preset.label,
          kind: preset.kind ?? addKind,
          qty: 1,
          unitPrice: preset.price,
          ...(preset.itemId ? { itemId: preset.itemId, dispense: true } : {}),
        },
      ],
    });

  /* Lines flagged for dispensing that the shelf cannot actually cover. */
  const shortLines = invoice.items.filter((it) => {
    if (it.kind !== 'drug' || !it.dispense || !it.itemId) return false;
    const stockItem = findBy(state.inventory, it.itemId);
    return !stockItem || Number(stockItem.stock) < Number(it.qty);
  });

  const receivePayment = () => {
    if (totals.total <= 0) {
      toast('Add at least one line before collecting payment.', 'warn');
      return;
    }
    if (method === 'Cash' && Number(tendered || 0) < totals.total) {
      toast('Cash tendered is less than the amount due.', 'error');
      return;
    }
    if (shortLines.length) {
      toast('Un-tick the drug lines the pharmacy cannot dispense first.', 'error');
      return;
    }
    act({
      type: 'PAY_INVOICE',
      id: invoice.id,
      method,
      amountPaid: totals.total,
      tendered: method === 'Cash' ? Number(tendered || 0) : totals.total,
      reference: reference.trim(),
      paidAt: new Date().toISOString(),
    });
    const dispensed = invoice.items.filter((it) => it.kind === 'drug' && it.dispense).length;
    toast(
      `${peso(totals.total)} received via ${method}${dispensed ? ` · ${dispensed} drug line(s) dispensed` : ''}`,
      'success',
    );
    onClose();
  };

  const presets = addKind === 'lab' ? LAB_PRESETS : addKind === 'service' ? SERVICE_PRESETS : [];

  return (
    <Modal
      open={!!invoiceId}
      onClose={onClose}
      title={`Statement ${invoice.id}`}
      subtitle={`${patientName(patient)} · ${fmtDate(invoice.date)} · ${doctor ? `Dr. ${doctor.name}` : '—'}`}
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">Total due</p>
            <p className="nums text-xl font-bold text-slate-900">{peso(totals.total)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() =>
                openPrint({
                  title: 'Billing statement',
                  subtitle: `${invoice.id} · ${patientName(patient)}`,
                  doc: <ReceiptDoc invoice={invoice} patient={patient} encounter={encounter} doctor={doctor} />,
                })
              }
            >
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
            {!locked && (
              <button type="button" className="btn-sky" onClick={receivePayment}>
                <Banknote className="h-4 w-4" /> Receive payment &amp; dispense
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {locked && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            Paid {invoice.paidAt ? fmtDateTime(invoice.paidAt) : ''} via {invoice.method}
            {invoice.reference ? ` · Ref ${invoice.reference}` : ''}
          </p>
        )}

        {/* Line items */}
        <section>
          <h3 className="label">Line items</h3>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Particulars</th>
                  <th className="th w-20 text-right">Qty</th>
                  <th className="th w-28 text-right">Unit</th>
                  <th className="th w-28 text-right">Amount</th>
                  <th className="th w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.items.map((it) => {
                  const stockItem = it.itemId ? findBy(state.inventory, it.itemId) : null;
                  const short = it.kind === 'drug' && it.dispense && stockItem && Number(stockItem.stock) < Number(it.qty);
                  return (
                    <tr key={it.id} className={cx(short && 'bg-rose-50')}>
                      <td className="td">
                        <div className="text-sm text-slate-800">{it.label}</div>
                        {it.kind === 'drug' && (
                          <label className="mt-0.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 accent-sky-600"
                              disabled={locked}
                              checked={!!it.dispense}
                              onChange={(e) => setItem(it.id, { dispense: e.target.checked })}
                            />
                            Dispense from clinic pharmacy
                            {stockItem && (
                              <span className={cx('nums', short ? 'font-bold text-rose-600' : 'text-slate-400')}>
                                ({stockItem.stock} {stockItem.unit} on hand)
                              </span>
                            )}
                          </label>
                        )}
                      </td>
                      <td className="td text-right">
                        <input
                          type="number"
                          min="1"
                          disabled={locked}
                          className="input nums !w-16 !py-1 text-right text-xs"
                          value={it.qty}
                          onChange={(e) => setItem(it.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      </td>
                      <td className="td text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.25"
                          disabled={locked}
                          className="input nums !w-24 !py-1 text-right text-xs"
                          value={it.unitPrice}
                          onChange={(e) => setItem(it.id, { unitPrice: Number(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="td nums text-right font-semibold">
                        {peso(Number(it.qty) * Number(it.unitPrice))}
                      </td>
                      <td className="td text-right">
                        {!locked && (
                          <button
                            type="button"
                            onClick={() => patch({ items: invoice.items.filter((x) => x.id !== it.id) })}
                            className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label={`Remove ${it.label}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {shortLines.length > 0 && (
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Not enough stock for {shortLines.map((l) => l.label).join(', ')}. Un-tick “Dispense” so the patient can
              buy it outside, or receive stock in Pharmacy first.
            </p>
          )}
        </section>

        {/* Add charges */}
        {!locked && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="label !mb-0">Add charges</h3>
              <div className="flex rounded-lg bg-slate-100 p-0.5">
                {[
                  { id: 'lab', label: 'Labs' },
                  { id: 'service', label: 'Services' },
                  { id: 'custom', label: 'Custom' },
                ].map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setAddKind(k.id)}
                    className={cx(
                      'rounded-md px-2.5 py-1 text-[11px] font-semibold transition',
                      addKind === k.id ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500',
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            {addKind === 'custom' ? (
              <CustomChargeForm onAdd={(line) => addLine({ ...line, kind: 'service' })} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => addLine({ ...p, kind: addKind })}
                    className="btn-ghost btn-sm"
                  >
                    <Plus className="h-3 w-3" /> {p.label}
                    <span className="nums text-slate-400">{peso(p.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Discount + totals */}
        <section className="grid gap-4 sm:grid-cols-2">
          <div>
            <Field
              label="Discount"
              hint="Flat 20% of subtotal in this demo — real SC/PWD rules are VAT-exempt plus 20%."
            >
              <select
                className="input"
                disabled={locked}
                value={invoice.discountType}
                onChange={(e) => patch({ discountType: e.target.value })}
              >
                <option value="None">None</option>
                <option value="Senior Citizen">Senior Citizen (R.A. 9994)</option>
                <option value="PWD">PWD (R.A. 10754)</option>
              </select>
            </Field>
            {invoice.discountType !== 'None' && (
              <Field label="OSCA / PWD ID number" className="mt-2">
                <input
                  className="input nums"
                  disabled={locked}
                  placeholder="OSCA-QC-0000-00000"
                  value={invoice.discountId ?? ''}
                  onChange={(e) => patch({ discountId: e.target.value })}
                />
              </Field>
            )}
            {seniorSuggested && (
              <button
                type="button"
                onClick={() =>
                  patch({ discountType: 'Senior Citizen', discountId: patient?.seniorId ?? '' })
                }
                className="mt-2 flex w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-xs text-emerald-800 transition hover:bg-emerald-100"
              >
                <BadgeCheck className="h-4 w-4 shrink-0" />
                {patientName(patient)} is {ageFrom(patient.dob)} — apply the Senior Citizen discount?
              </button>
            )}
          </div>

          <dl className="space-y-1.5 self-start rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Subtotal</dt>
              <dd className="nums text-slate-900">{peso(totals.subtotal)}</dd>
            </div>
            {totals.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-600">{invoice.discountType} (20%)</dt>
                <dd className="nums text-emerald-700">−{peso(totals.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-1.5">
              <dt className="font-bold text-slate-900">Total due</dt>
              <dd className="nums text-lg font-bold text-slate-900">{peso(totals.total)}</dd>
            </div>
          </dl>
        </section>

        {/* Payment */}
        {!locked && (
          <section className="rounded-lg border border-slate-200 p-3">
            <h3 className="label">Payment</h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {PAYMENT_METHODS.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    className={cx(
                      'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition',
                      method === m.id
                        ? 'border-sky-500 bg-sky-50 text-sky-800'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {m.id}
                  </button>
                );
              })}
            </div>

            {method === 'Cash' ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Cash tendered">
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    className="input nums"
                    placeholder={String(Math.ceil(totals.total / 50) * 50)}
                    value={tendered}
                    onChange={(e) => setTendered(e.target.value)}
                  />
                </Field>
                <div className="self-end rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">Change</p>
                  <p className={cx('nums text-lg font-bold', change > 0 ? 'text-emerald-700' : 'text-slate-400')}>
                    {peso(change)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:col-span-2">
                  {[100, 200, 500, 1000].map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="btn-subtle btn-sm nums"
                      onClick={() => setTendered(String(Number(tendered || 0) + d))}
                    >
                      +{d}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn-subtle btn-sm"
                    onClick={() => setTendered(String(totals.total))}
                  >
                    Exact
                  </button>
                  <button type="button" className="btn-subtle btn-sm" onClick={() => setTendered('')}>
                    Clear
                  </button>
                </div>
              </div>
            ) : (
              <Field
                label={`${method} reference number`}
                hint="Recorded for reconciliation — no payment gateway is wired up yet."
                className="mt-3"
              >
                <input
                  className="input nums"
                  placeholder="e.g. 0123456789"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

function CustomChargeForm({ onAdd }) {
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Description" className="min-w-[200px] flex-1">
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Suture removal" />
      </Field>
      <Field label="Amount" className="w-32">
        <input type="number" min="0" step="0.25" className="input nums" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <button
        type="button"
        className="btn-sky btn-sm mb-0.5"
        onClick={() => {
          if (!label.trim() || !price) return;
          onAdd({ label: label.trim(), price: Number(price) });
          setLabel('');
          setPrice('');
        }}
      >
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    </div>
  );
}

/* ===== 10. App root ============================================================= */

export default function App() {
  const [state, dispatch] = usePersistentStore();
  const network = useNetwork();
  const swState = useServiceWorkerState();

  const { session, signIn, signOut } = useSession();
  const deviceNotifications = useDeviceNotifications();
  const [toasts, setToasts] = useState([]);
  const [printJob, setPrintJob] = useState(null);
  const [outbox, setOutbox] = useState(0);

  const toast = useCallback((message, tone = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);

  /* Every mutation goes through act(). Offline, a non-silent action increments a
     simulated outbox counter — this is the seam for a real Dexie/IndexedDB outbox
     with client_uuid idempotency keys (CLAUDE.md gap 3). */
  const act = useCallback(
    (action, { silent = false } = {}) => {
      dispatch(action);
      if (!network.online && !silent) setOutbox((n) => n + 1);
    },
    [dispatch, network.online],
  );

  /* "Sync" the outbox shortly after the connection comes back. */
  useEffect(() => {
    if (!network.online || outbox === 0) return undefined;
    const t = setTimeout(() => {
      toast(`Synced ${outbox} offline change${outbox > 1 ? 's' : ''}`, 'success');
      setOutbox(0);
    }, 1200);
    return () => clearTimeout(t);
  }, [network.online, outbox, toast]);

  /* A refused localStorage write means the change is memory-only — say so once. */
  const warnedRef = useRef(false);
  useEffect(() => {
    const onFail = () => {
      if (warnedRef.current) return;
      warnedRef.current = true;
      toast('This browser refused to save — recent changes will be lost on reload. A smaller logo may help.', 'error');
    };
    window.addEventListener('mc-persist-error', onFail);
    return () => window.removeEventListener('mc-persist-error', onFail);
  }, [toast]);

  const resetDemo = useCallback(() => {
    dispatch({ type: 'RESET', state: buildSeed() });
    setOutbox(0);
    toast('Demo data reset — today’s queue re-anchored to now', 'success');
  }, [dispatch, toast]);

  const openPrint = useCallback((job) => setPrintJob(job), []);

  /* The account is the identity. Resetting the demo rebuilds the user table, so
     a session pointing at a user that no longer exists simply signs out. */
  const currentUser = session ? state.users?.find((u) => u.id === session.userId) ?? null : null;
  const role = currentUser?.kind ?? null;
  const doctorId = role === 'doctor' ? currentUser.refId : state.doctors[0]?.id ?? '';
  const patientId = role === 'patient' ? currentUser.refId : '';
  const staffId = role === 'staff' ? currentUser.refId : '';

  useEffect(() => {
    if (session && !currentUser) signOut();
  }, [session, currentUser, signOut]);

  const handleSignIn = useCallback(
    (user, remember) => {
      signIn(user.id, remember);
      dispatch({ type: 'TOUCH_LOGIN', id: user.id, at: new Date().toISOString() });
    },
    [signIn, dispatch],
  );

  const changePassword = useCallback(
    (password) => {
      dispatch({ type: 'SET_PASSWORD', id: currentUser.id, password });
      toast('Password updated', 'success');
    },
    [dispatch, currentUser, toast],
  );

  const value = useMemo(
    () => ({
      state,
      act,
      role,
      doctorId,
      patientId,
      staffId,
      currentUser,
      signOut,
      /* Who the current portal is acting as, in messaging/notification terms. */
      me: { kind: role, id: role === 'doctor' ? doctorId : role === 'patient' ? patientId : staffId },
      toast,
      openPrint,
      deviceNotifications,
      outbox,
      swState,
      resetDemo,
      online: network.online,
      realOnline: network.realOnline,
      simulatedOffline: network.simulatedOffline,
      setSimulatedOffline: network.setSimulatedOffline,
    }),
    [state, act, role, doctorId, patientId, staffId, currentUser, signOut, toast, openPrint,
     deviceNotifications, outbox, swState, resetDemo, network],
  );

  /* Every hook above runs unconditionally; the gate comes after them. */
  if (!currentUser) {
    return (
      <ClinicContext.Provider value={value}>
        <LoginScreen users={state.users ?? []} onSignIn={handleSignIn} />
      </ClinicContext.Provider>
    );
  }

  return (
    <ClinicContext.Provider value={value}>
      <div className="min-h-screen bg-slate-100">
        <InstallBanner />
        <Header />

        {!network.online && (
          <div className="no-print bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-white">
            <CloudOff className="mr-1 inline h-3.5 w-3.5" />
            Offline — changes are saved on this device and will sync when the connection returns.
          </div>
        )}

        {/* Raises a device notification for anything new addressed to this user. */}
        <DeviceNotifier />

        {role === 'doctor' && <DoctorPortal />}
        {role === 'patient' && <PatientPortal />}
        {role === 'staff' && <StaffPortal />}

        <footer className="no-print mx-auto max-w-7xl px-4 py-8 text-center text-[11px] leading-relaxed text-slate-400">
          <p className="font-semibold text-slate-500">{state.clinic?.name ?? CLINIC.name}</p>
          <p>
            {state.clinic?.address ?? CLINIC.address} · {state.clinic?.phone ?? CLINIC.phone} ·{' '}
            {state.clinic?.email ?? CLINIC.email}
          </p>
          <p className="mt-2">
            Demo build — seeded sample data held in this browser only. No patient data leaves this device;
            there is no authentication, audit log, or consent capture yet, so do not enter real patient
            information (R.A. 10173).
          </p>
        </footer>

        <Toasts items={toasts} onDismiss={(id) => setToasts((list) => list.filter((t) => t.id !== id))} />
        <PrintCenter job={printJob} onClose={() => setPrintJob(null)} />

        {/* No way past this until the default (or reset) password is replaced. */}
        {currentUser.mustChangePassword && (
          <ForcePasswordChange
            user={currentUser}
            wasReset={!!currentUser.passwordResetAt}
            onChange={changePassword}
            onSignOut={signOut}
          />
        )}
      </div>
    </ClinicContext.Provider>
  );
}
