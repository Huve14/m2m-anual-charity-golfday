import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import m2mBlueLogo from '../assets/m2m-blue.png';

type HelpPageProps = {
  onBack: () => void;
};

const bookingSteps = [
  ['Submit booking', 'Purchaser details, package mix, add-ons, communication consent, and accepted terms.'],
  ['Issue invoice', 'Finance uploads the approved invoice, emails the purchaser, and tracks due dates.'],
  ['Collect players', 'A secure player-form token gathers names, emails, cell numbers, handicaps, and shirt sizes.'],
  ['Allocate fourballs', 'Players are assigned to fourballs with tee or hole details, carts, and published tee times.'],
  ['Confirm sponsors', 'Sponsor packages, logo assets, in-kind notes, and inventory are approved before event week.'],
  ['Run event day', 'Check-in, goodie bags, cart assignments, scorecards, and communications stay visible.'],
];

const supportNotes = [
  'Keep purchaser and player details current before event week.',
  'Finance and allocation actions are reflected across the operations console.',
  'Use the same booking reference when following up with the M2M team.',
];

export function HelpPage({ onBack }: HelpPageProps) {
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

        <div className="mb-12 grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
          <div>
            <img src={m2mBlueLogo} alt="M2M" className="mb-8 h-12 w-auto" />
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-navy-700">Booking journey</p>
            <h1 className="display mt-3 max-w-[24rem] text-5xl leading-[1.02] text-navy-900 sm:max-w-xl sm:text-6xl">
              From registration to scorecard in six controlled steps.
            </h1>
          </div>
          <div className="max-w-2xl">
            <p className="text-base leading-7 text-ink-soft">
              Each step maps to the existing backend surface: booking records, line items,
              player allocations, sponsor packages, invoices, communications, and audit logs.
            </p>
            <ul className="mt-6 grid gap-3">
              {supportNotes.map((note) => (
                <li key={note} className="flex items-start gap-3 text-sm font-semibold leading-6 text-navy-700">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-signal-300" aria-hidden="true" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <ol className="grid gap-x-7 gap-y-9 md:grid-cols-2 lg:grid-cols-3">
          {bookingSteps.map(([title, description], index) => (
            <li key={title} className="border-t-2 border-signal-300 pt-6">
              <span className="display text-5xl leading-none text-navy-700">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h2 className="mt-5 text-xl font-extrabold text-ink">{title}</h2>
              <p className="mt-3 text-base leading-7 text-ink-soft">{description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
