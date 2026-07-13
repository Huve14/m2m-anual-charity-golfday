import { ArrowLeft, CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import m2mBlueLogo from '../assets/m2m-blue.png';

type PopiaPageProps = {
  onBack: () => void;
};

const popiaSections = [
  {
    title: 'What we collect',
    copy: 'Purchaser details, guest/player names, contact information, handicap or team allocation details, sponsor asset notes, dietary context where supplied, and event communication preferences.',
  },
  {
    title: 'Why we collect it',
    copy: 'To process bookings, allocate fourballs, prepare invoices, coordinate sponsorship commitments, communicate event updates, and run the golf day safely and professionally.',
  },
  {
    title: 'How it is protected',
    copy: 'Access is limited to authorised event, finance, and operations users. Records are kept only for the event administration lifecycle and reasonable post-event audit or finance follow-up.',
  },
  {
    title: 'Guest consent',
    copy: 'If you submit information on behalf of guests or players, you confirm that they know their information is being shared with M2M for event administration and communication.',
  },
];

const rights = [
  'Request access to personal information held for the booking.',
  'Ask for incorrect details to be corrected before event day.',
  'Withdraw optional communication consent where it is not required for event operations.',
  'Contact the M2M team about privacy, retention, or deletion requests.',
];

export function PopiaPage({ onBack }: PopiaPageProps) {
  return (
    <section className="relative min-h-screen overflow-hidden bg-cream-100">
      <div className="arrow-field arrow-field-red" />
      <div className="relative mx-auto max-w-7xl px-5 py-12 lg:px-8 lg:py-16">
        <button
          type="button"
          onClick={onBack}
          className="mb-10 inline-flex items-center gap-2 rounded-full border border-cream-300 bg-white px-4 py-2 text-sm font-extrabold text-navy-700 hover:bg-cream-200"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to platform
        </button>

        <div className="mb-12 grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
          <div>
            <img src={m2mBlueLogo} alt="M2M" className="mb-8 h-12 w-auto" />
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-navy-700">POPIA compliance</p>
            <h1 className="display mt-3 max-w-[24rem] text-5xl leading-[1.02] text-navy-900 sm:max-w-xl sm:text-6xl">
              Privacy and consent for guest bookings.
            </h1>
          </div>
          <div className="rounded-lg border border-cream-300 bg-white p-6">
            <ShieldCheck className="h-8 w-8 text-signal-300" aria-hidden="true" />
            <p className="mt-5 text-base leading-7 text-ink-soft">
              This page explains how personal information is handled for the M2M Annual Charity Golf Day in line with POPIA principles:
              purpose limitation, minimal collection, appropriate access, and transparent guest consent.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {popiaSections.map((section) => (
            <article key={section.title} className="rounded-lg border border-cream-300 bg-white p-5">
              <Lock className="h-5 w-5 text-navy-700" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-extrabold text-ink">{section.title}</h2>
              <p className="mt-3 text-sm leading-6 text-ink-soft">{section.copy}</p>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-cream-300 bg-cream-50 p-6">
          <h2 className="text-xl font-extrabold text-ink">Data subject rights</h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {rights.map((right) => (
              <li key={right} className="flex items-start gap-3 text-sm font-semibold leading-6 text-navy-700">
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-signal-300" aria-hidden="true" />
                <span>{right}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
