import { ArrowLeft, HeartHandshake, MessageCircle, ReceiptText, Users } from 'lucide-react';

type InfoPageProps = {
  onBack: () => void;
};

const infoCards = [
  {
    title: 'Experiential desk',
    description: 'Shape golf-day touchpoints like brand activations: memorable, direct, and designed to be talked about after the event.',
    icon: ReceiptText,
  },
  {
    title: 'Field-force control',
    description: 'Coordinate players, hosts, check-in teams, carts, and on-course moments with the same discipline as field marketing execution.',
    icon: Users,
  },
  {
    title: 'Sponsor visibility',
    description: 'Keep sponsor packages, logo assets, branded gifting, print needs, and event inventory moving together.',
    icon: HeartHandshake,
  },
  {
    title: 'Content & innovation',
    description: 'Support comms, digital touchpoints, AI-assisted planning, and post-event content from one registration backbone.',
    icon: MessageCircle,
  },
];

export function InfoPage({ onBack }: InfoPageProps) {
  return (
    <section className="relative min-h-screen overflow-hidden bg-navy-900 py-12 text-cream-100 lg:py-16">
      <div className="arrow-field arrow-field-right" />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <button
          type="button"
          onClick={onBack}
          className="mb-10 inline-flex items-center gap-2 rounded-full border border-cream-100/20 bg-cream-100/8 px-4 py-2 text-sm font-extrabold text-cream-100 hover:bg-cream-100/14"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to platform
        </button>

        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-signal-300">Registration command centre</p>
            <h1 className="display mt-3 max-w-[22rem] text-5xl leading-[1.02] text-cream-100 sm:max-w-xl sm:text-6xl">
              Where golf-day admin meets brand experience.
            </h1>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {infoCards.map((card) => {
              const Icon = card.icon;
              return (
                <article key={card.title} className="rounded-lg border border-cream-100/10 bg-cream-100/8 p-6">
                  <Icon className="h-7 w-7 text-signal-300" aria-hidden="true" />
                  <h2 className="mt-7 text-xl font-extrabold text-cream-100">{card.title}</h2>
                  <p className="mt-4 text-base leading-7 text-cream-100/70">{card.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
