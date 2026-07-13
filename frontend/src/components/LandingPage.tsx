import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Database,
  Lock,
  ReceiptText,
  Sparkles,
} from 'lucide-react';
import m2mWhiteLogo from '../assets/m2m-white.png';
import { isSupabaseConfigured } from '../lib/supabase';

type HeroStar = {
  id: number;
  top: number;
  left: number;
  delay: string;
  duration: string;
  size?: number;
  color?: string;
};

type RegistrationFormState = {
  purchaserType: 'company' | 'individual';
  organisationName: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  fourballs: number;
  individualPlayers: number;
  sponsorPackage: SponsorPackageCode;
  cartBranding: number;
  giftingPacks: number;
  activationNotes: string;
  communicationConsent: boolean;
  popiaGuestConsent: boolean;
  termsAccepted: boolean;
};

type SponsorPackageCode = 'none' | 'hole' | 'activation' | 'headline';

type SubmittedRegistration = {
  reference: string;
  playerFormToken: string;
  payload: {
    booking: {
      reference: string;
      purchaser_type: string;
      organisation_name: string;
      contact_person: string;
      contact_email: string;
      contact_phone: string;
      status: 'submitted';
      total_amount: number;
      terms_accepted: boolean;
      consent_communication: boolean;
      consent_popia_guest_booking: boolean;
      player_form_token: string;
    };
    booking_line_items: Array<{
      item_type: string;
      quantity: number;
      unit_price: number;
      line_total: number;
    }>;
    booking_add_ons: Array<{
      code: string;
      quantity: number;
      line_total: number;
    }>;
    sponsorship: null | {
      package_code: SponsorPackageCode;
      quantity: number;
      amount: number;
      in_kind_description: string;
      status: 'submitted';
    };
    player_allocation: {
      slots_purchased: number;
      players_allocated: 0;
      players_submitted: 0;
      allocation_locked: false;
      last_updated_by: 'purchaser';
    };
  };
};

const eventFacts = [
  { label: 'Marketing engine', value: 'Full service' },
  { label: 'Format', value: 'Shotgun charity golf day' },
  { label: 'B-BBEE status', value: 'Level 1' },
  { label: 'Platform flow', value: 'Bookings · sponsors · players' },
];

const registrationDefaults: RegistrationFormState = {
  purchaserType: 'company',
  organisationName: 'M2M Partner Company',
  contactPerson: '',
  contactEmail: '',
  contactPhone: '',
  fourballs: 1,
  individualPlayers: 0,
  sponsorPackage: 'hole',
  cartBranding: 0,
  giftingPacks: 4,
  activationNotes: '',
  communicationConsent: true,
  popiaGuestConsent: false,
  termsAccepted: false,
};

const sponsorPackages: Array<{
  code: SponsorPackageCode;
  label: string;
  description: string;
  price: number;
}> = [
  {
    code: 'none',
    label: 'No sponsor package',
    description: 'Registration only, with player collection and invoice follow-up.',
    price: 0,
  },
  {
    code: 'hole',
    label: 'Hole sponsor',
    description: 'Sponsor a hole with signage, brand mention, and asset tracking.',
    price: 12000,
  },
  {
    code: 'activation',
    label: 'Activation moment',
    description: 'M2M-style on-course brand interaction with gifting or sampling notes.',
    price: 18000,
  },
  {
    code: 'headline',
    label: 'Headline partner',
    description: 'Premium visibility across registration, field teams, print, and event day.',
    price: 45000,
  },
];

const registrationPrices = {
  fourball: 8000,
  individualPlayer: 2000,
  cartBranding: 1200,
  giftingPack: 350,
};

const tinyHeroStars: HeroStar[] = Array.from({ length: 118 }, (_, index) => ({
  id: index,
  top: (index * 37 + 13) % 100,
  left: (index * 53 + 7) % 100,
  delay: `${((index * 0.17) % 5).toFixed(2)}s`,
  duration: `${(2 + (index * 0.13) % 3).toFixed(2)}s`,
  size: 1 + (index % 2),
}));

const mediumHeroStars: HeroStar[] = Array.from({ length: 34 }, (_, index) => ({
  id: index,
  top: (index * 61 + 23) % 100,
  left: (index * 43 + 17) % 100,
  delay: `${((index * 0.23) % 6).toFixed(2)}s`,
  duration: `${(3 + (index * 0.19) % 4).toFixed(2)}s`,
}));

const glowHeroStars: HeroStar[] = Array.from({ length: 10 }, (_, index) => ({
  id: index,
  top: (index * 71 + 31) % 90,
  left: (index * 67 + 11) % 90,
  delay: `${((index * 0.41) % 4).toFixed(2)}s`,
  duration: `${(4 + (index * 0.3) % 5).toFixed(2)}s`,
  color: ['#ffffff', '#dcddde', '#ed1c24', '#ffffff', '#dcddde'][index % 5],
}));

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    currency: 'ZAR',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(value);
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function buildBookingReference() {
  const timestamp = Date.now().toString(36).toUpperCase().slice(-5);
  const random = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `M2M-2026-${timestamp}${random}`;
}

function buildPlayerToken(reference: string) {
  return `${reference.toLowerCase()}-players`;
}

function getSponsorPackage(code: SponsorPackageCode) {
  return sponsorPackages.find((sponsorPackage) => sponsorPackage.code === code) ?? sponsorPackages[0];
}

function getRegistrationTotals(form: RegistrationFormState) {
  const sponsorPackage = getSponsorPackage(form.sponsorPackage);
  const fourballTotal = form.fourballs * registrationPrices.fourball;
  const playerTotal = form.individualPlayers * registrationPrices.individualPlayer;
  const sponsorTotal = sponsorPackage.price;
  const cartBrandingTotal = form.cartBranding * registrationPrices.cartBranding;
  const giftingTotal = form.giftingPacks * registrationPrices.giftingPack;
  const total = fourballTotal + playerTotal + sponsorTotal + cartBrandingTotal + giftingTotal;
  const slotsPurchased = form.fourballs * 4 + form.individualPlayers;

  return {
    cartBrandingTotal,
    fourballTotal,
    giftingTotal,
    playerTotal,
    slotsPurchased,
    sponsorPackage,
    sponsorTotal,
    total,
  };
}

function buildRegistrationPayload(form: RegistrationFormState): SubmittedRegistration {
  const reference = buildBookingReference();
  const playerFormToken = buildPlayerToken(reference);
  const totals = getRegistrationTotals(form);
  const bookingLineItems = [
    {
      item_type: 'fourball',
      quantity: form.fourballs,
      unit_price: registrationPrices.fourball,
      line_total: totals.fourballTotal,
    },
    {
      item_type: 'individual_player',
      quantity: form.individualPlayers,
      unit_price: registrationPrices.individualPlayer,
      line_total: totals.playerTotal,
    },
  ].filter((item) => item.quantity > 0);

  const bookingAddOns = [
    {
      code: 'cart_branding',
      quantity: form.cartBranding,
      line_total: totals.cartBrandingTotal,
    },
    {
      code: 'm2m_gifting_pack',
      quantity: form.giftingPacks,
      line_total: totals.giftingTotal,
    },
  ].filter((item) => item.quantity > 0);

  return {
    reference,
    playerFormToken,
    payload: {
      booking: {
        reference,
        purchaser_type: form.purchaserType,
        organisation_name: form.organisationName.trim(),
        contact_person: form.contactPerson.trim(),
        contact_email: form.contactEmail.trim(),
        contact_phone: form.contactPhone.trim(),
        status: 'submitted',
        total_amount: totals.total,
        terms_accepted: form.termsAccepted,
        consent_communication: form.communicationConsent,
        consent_popia_guest_booking: form.popiaGuestConsent,
        player_form_token: playerFormToken,
      },
      booking_line_items: bookingLineItems,
      booking_add_ons: bookingAddOns,
      sponsorship:
        form.sponsorPackage === 'none'
          ? null
          : {
              package_code: form.sponsorPackage,
              quantity: 1,
              amount: totals.sponsorTotal,
              in_kind_description: form.activationNotes.trim(),
              status: 'submitted',
            },
      player_allocation: {
        slots_purchased: totals.slotsPurchased,
        players_allocated: 0,
        players_submitted: 0,
        allocation_locked: false,
        last_updated_by: 'purchaser',
      },
    },
  };
}

type LandingPageProps = {
  onOpenHelp: () => void;
  onOpenInfo: () => void;
  onOpenPopia: () => void;
};

export function LandingPage({ onOpenHelp, onOpenInfo, onOpenPopia }: LandingPageProps) {
  return (
    <>
      <section
        id="event"
        className="m2m-space-hero relative isolate overflow-hidden bg-navy-900 text-cream-100"
      >
        <HeroSpaceBackground />
        <div className="hero-to-score-gradient" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl px-5 pb-8 pt-16 lg:px-8 lg:pb-10 lg:pt-20">
          <div className="max-w-[22rem] sm:max-w-4xl">
            <img src={m2mWhiteLogo} alt="M2M" className="mb-8 h-12 w-auto sm:h-16" />
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cream-100/25 bg-cream-100/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-cream-100">
              <Sparkles className="h-4 w-4 text-signal-300" aria-hidden="true" />
              Inspired experiential registration
            </div>
            <h1 className="display max-w-[22rem] break-words text-[3rem] leading-[0.98] text-cream-100 sm:max-w-4xl sm:text-6xl sm:leading-[0.96] lg:text-7xl">
              A good Hole A Day Keeps The Bogeys Away
            </h1>
            <p className="mt-6 max-w-[22rem] text-base leading-7 text-cream-100/78 sm:max-w-2xl sm:text-lg">
              M2M turns brand interactions into personal, high-impact experiences.
              This registration site brings that same energy to bookings, sponsors,
              fourballs, field teams, branded assets, and event-day execution.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onOpenHelp}
                className="inline-flex items-center gap-2 rounded-full border border-cream-100/40 px-5 py-3 text-sm font-bold text-cream-100 hover:bg-cream-100/10"
              >
                View booking journey help
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onOpenInfo}
                className="inline-flex items-center gap-2 rounded-full border border-cream-100/40 px-5 py-3 text-sm font-bold text-cream-100 hover:bg-cream-100/10"
              >
                View command centre info
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onOpenPopia}
                className="inline-flex items-center gap-2 rounded-full border border-cream-100/40 px-5 py-3 text-sm font-bold text-cream-100 hover:bg-cream-100/10"
              >
                POPIA compliance
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <a
                href="#score-transition"
                className="inline-flex items-center gap-2 rounded-full bg-signal-300 px-5 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-signal-500"
              >
                Start registration
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>

          <dl className="mt-12 hidden gap-3 border-t border-cream-100/15 pt-6 sm:grid sm:grid-cols-2 lg:grid-cols-4">
            {eventFacts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-[11px] font-bold uppercase tracking-[0.16em] text-cream-100/58">
                  {fact.label}
                </dt>
                <dd className="display mt-2 text-3xl leading-none text-cream-100">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <RegistrationHandoff />

      <RegistrationSection />

      <section className="relative overflow-hidden border-b border-cream-300 bg-cream-100">
        <div className="arrow-field arrow-field-navy" />
        <div className="relative mx-auto grid max-w-7xl gap-8 px-5 py-10 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-navy-700">System shape</p>
            <h2 className="display mt-3 max-w-[22rem] text-4xl leading-tight text-navy-900 sm:max-w-none">
              Built for inspired execution, not generic ticketing.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Detail icon={CalendarDays} label="Event DNA" value="Experiential, energetic, memorable" />
            <Detail icon={Database} label="M2M stack" value="Bookings, players, sponsors, assets" />
            <Detail
              icon={Lock}
              label="Environment"
              value={isSupabaseConfigured ? 'Supabase env found' : 'Supabase env pending'}
            />
          </div>
        </div>
      </section>

    </>
  );
}

function RegistrationHandoff() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const touchYRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const gateStateRef = useRef<'idle' | 'active' | 'released'>('idle');
  const hasSnappedToGateRef = useRef(false);
  const gateProgress = useMotionValue(0);
  const smoothProgress = useSpring(gateProgress, {
    damping: 30,
    mass: 0.18,
    stiffness: 300,
  });
  const textOpacity = useTransform(smoothProgress, [0, 0.1, 0.72, 0.9, 1], [0.22, 1, 1, 0.12, 0]);
  const textScale = useTransform(smoothProgress, [0, 0.12, 0.72, 1], [0.985, 1, 1, 1.04]);
  const textY = useTransform(smoothProgress, [0, 0.12, 0.72, 1], [22, 0, 0, -40]);
  const textFilter = useTransform(smoothProgress, [0, 0.16, 0.72, 0.92, 1], ['blur(4px)', 'blur(0px)', 'blur(0px)', 'blur(2px)', 'blur(4px)']);
  const gridOpacity = useTransform(smoothProgress, [0, 0.18, 0.78, 1], [0.22, 0.43, 0.34, 0.04]);
  const gridY = useTransform(smoothProgress, [0, 1], [-24, 70]);
  const gridScale = useTransform(smoothProgress, [0, 1], [1, 1.055]);
  const fadeOpacity = useTransform(smoothProgress, [0.72, 0.92, 1], [0, 0.58, 1]);

  useEffect(() => {
    const clampProgress = (value: number) => Math.min(Math.max(value, 0), 1);

    const releaseToRegistration = () => {
      const registration = document.getElementById('register');
      gateStateRef.current = 'released';
      hasSnappedToGateRef.current = false;
      progressRef.current = 1;
      gateProgress.set(1);

      window.requestAnimationFrame(() => {
        window.scrollTo({
          behavior: 'smooth',
          top: registration ? registration.offsetTop + 40 : window.scrollY + window.innerHeight * 0.9,
        });
      });
    };

    const releaseToHero = () => {
      const section = sectionRef.current;
      if (!section) return;

      gateStateRef.current = 'idle';
      hasSnappedToGateRef.current = false;
      progressRef.current = 0;
      gateProgress.set(0);

      window.requestAnimationFrame(() => {
        window.scrollTo({
          behavior: 'smooth',
          top: Math.max(0, section.offsetTop - window.innerHeight + 24),
        });
      });
    };

    const updateGate = (delta: number) => {
      const section = sectionRef.current;
      if (!section) return false;

      const rect = section.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const sectionTop = section.offsetTop;
      const isPinned = rect.top <= 1 && rect.bottom > viewportHeight * 0.78;
      const isApproachingPin = delta > 0 && rect.top <= viewportHeight * 0.18 && rect.bottom > viewportHeight * 0.78;
      const isAboveHandoff = window.scrollY < sectionTop - 12;

      if (isAboveHandoff && !isApproachingPin) {
        gateStateRef.current = 'idle';
        hasSnappedToGateRef.current = false;
        progressRef.current = 0;
        gateProgress.set(0);
        return false;
      }

      if (gateStateRef.current === 'released' && delta > 0) {
        return false;
      }

      if (!isPinned && !isApproachingPin && gateStateRef.current !== 'active') {
        return false;
      }

      if (delta > 0 && gateStateRef.current === 'idle' && (isPinned || isApproachingPin)) {
        gateStateRef.current = 'active';
      }

      if (delta < 0 && gateStateRef.current === 'released' && isPinned) {
        gateStateRef.current = 'active';
      }

      if (gateStateRef.current !== 'active') {
        return false;
      }

      if (!hasSnappedToGateRef.current && (Math.abs(rect.top) > 1 || Math.abs(window.scrollY - sectionTop) > 1)) {
        hasSnappedToGateRef.current = true;
        window.scrollTo({ behavior: 'auto', top: sectionTop });
      }

      const gateDistance = window.innerWidth < 640 ? 620 : 740;
      const rawProgressDelta = delta / gateDistance;
      const easedProgressDelta = Math.min(Math.max(rawProgressDelta, -0.24), 0.24);
      const nextProgress = clampProgress(progressRef.current + easedProgressDelta);
      progressRef.current = nextProgress;
      gateProgress.set(nextProgress);

      if (nextProgress >= 0.965 && delta > 0) {
        releaseToRegistration();
      }

      if (nextProgress <= 0.015 && delta < 0) {
        releaseToHero();
      }

      return true;
    };

    const onWheel = (event: WheelEvent) => {
      if (updateGate(event.deltaY)) {
        event.preventDefault();
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      touchYRef.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (touchYRef.current === null || currentY === undefined) return;
      const delta = touchYRef.current - currentY;
      touchYRef.current = currentY;

      if (updateGate(delta * 1.7)) {
        event.preventDefault();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const keyDeltas: Record<string, number> = {
        ArrowDown: 120,
        ArrowUp: -120,
        PageDown: 420,
        PageUp: -420,
        Space: event.shiftKey ? -420 : 420,
      };
      const delta = keyDeltas[event.code];
      if (delta !== undefined && updateGate(delta)) {
        event.preventDefault();
      }
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [gateProgress]);

  return (
    <section
      id="score-transition"
      ref={sectionRef}
      className="registration-handoff relative isolate overflow-hidden bg-navy-900 text-cream-100"
    >
      <div className="handoff-sticky relative flex items-center justify-center px-5 text-center">
        <div className="film-grain" aria-hidden="true" />
        <motion.div
          className="handoff-grid absolute inset-0"
          style={{ opacity: gridOpacity, y: gridY, scale: gridScale }}
          aria-hidden="true"
        />
        <motion.div className="handoff-white-wash absolute inset-x-0 bottom-0" style={{ opacity: fadeOpacity }} aria-hidden="true" />

        <motion.div
          className="handoff-copy mx-auto max-w-6xl"
          style={{
            opacity: textOpacity,
            scale: textScale,
            y: textY,
          }}
        >
          <h2 className="handoff-title text-[clamp(2.95rem,11vw,5.25rem)] font-extrabold leading-[1.28] sm:text-[clamp(4.1rem,7.6vw,6.8rem)] sm:leading-[1.22]">
            <motion.span className="handoff-title-white mb-3 block sm:mb-4" style={{ filter: textFilter }}>
              TRACK THE SCORE,
            </motion.span>
            <motion.span className="handoff-title-silver block pb-5" style={{ filter: textFilter }}>
              NOT HOW YOU GOT THERE
            </motion.span>
          </h2>
        </motion.div>
      </div>
    </section>
  );
}

function HeroSpaceBackground() {
  return (
    <div className="m2m-space-bg absolute inset-0" aria-hidden="true">
      <div className="m2m-space-wash" />
      <div className="m2m-milky-way" />

      <div className="stars-layer">
        {tinyHeroStars.map((star) => (
          <span
            key={star.id}
            className="star star-tiny"
            style={{
              animationDelay: star.delay,
              animationDuration: star.duration,
              height: star.size,
              left: `${star.left}%`,
              top: `${star.top}%`,
              width: star.size,
            }}
          />
        ))}
      </div>

      <div className="stars-layer stars-drift">
        {mediumHeroStars.map((star) => (
          <span
            key={star.id}
            className="star star-medium"
            style={{
              animationDelay: star.delay,
              animationDuration: star.duration,
              left: `${star.left}%`,
              top: `${star.top}%`,
            }}
          />
        ))}
      </div>

      <div className="stars-layer">
        {glowHeroStars.map((star) => (
          <span
            key={star.id}
            className="star star-glow"
            style={{
              '--glow-color': star.color,
              animationDelay: star.delay,
              animationDuration: star.duration,
              left: `${star.left}%`,
              top: `${star.top}%`,
            } as CSSProperties}
          />
        ))}
      </div>

      <div className="shooting-stars">
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} className={`shooting-star shooting-star-${star}`} />
        ))}
      </div>

      <div className="paper-grain absolute inset-0 opacity-45" />
    </div>
  );
}

function RegistrationSection() {
  const [form, setForm] = useState<RegistrationFormState>(registrationDefaults);
  const [submittedRegistration, setSubmittedRegistration] = useState<SubmittedRegistration | null>(null);
  const totals = useMemo(() => getRegistrationTotals(form), [form]);

  function updateField<Key extends keyof RegistrationFormState>(
    field: Key,
    value: RegistrationFormState[Key],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setSubmittedRegistration(null);
  }

  function updateQuantity(
    field: 'fourballs' | 'individualPlayers' | 'cartBranding' | 'giftingPacks',
    value: string,
    max = 40,
  ) {
    updateField(field, clampNumber(Number(value), 0, max));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedRegistration(buildRegistrationPayload(form));
  }

  return (
    <section id="register" className="relative -mt-24 overflow-hidden border-b border-cream-300 bg-cream-50 pb-14 pt-24">
      <motion.div
        className="relative mx-auto grid min-w-0 max-w-7xl gap-10 px-5 xl:grid-cols-[1.35fr_0.85fr] xl:px-8"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        viewport={{ once: true, amount: 0.02 }}
      >
        <div className="order-1 w-full min-w-0 max-w-[calc(100vw-2.5rem)] xl:order-2 xl:sticky xl:top-36 xl:max-w-none xl:self-start">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-navy-700">Register</p>
          <h2 className="display mt-3 max-w-full break-words text-4xl leading-tight text-ink sm:max-w-none sm:text-5xl">
            Submit your M2M booking.
          </h2>
          <p className="mt-5 max-w-full break-words text-sm leading-6 text-ink-soft sm:max-w-xl">
            The form follows the booking journey: purchaser details, package mix,
            sponsorship, add-ons, consent, then a player-allocation token for the
            next step.
          </p>

          <div className="hidden xl:block">
            <RegistrationTotalCard totals={totals} />
          </div>

          {submittedRegistration ? (
            <div className="mt-5 rounded-lg border border-signal-300 bg-white p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-signal-300" aria-hidden="true" />
                <div>
                  <p className="font-extrabold text-navy-900">Booking captured</p>
                  <p className="mt-1 text-sm leading-6 text-ink-soft">
                    Reference {submittedRegistration.reference}. Player token {submittedRegistration.playerFormToken}.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <form
          onSubmit={handleSubmit}
          className="order-2 w-full min-w-0 max-w-[calc(100vw-2.5rem)] rounded-lg border border-cream-300 bg-white p-5 shadow-sm sm:p-6 xl:order-1 xl:max-w-none"
        >
          <div className="grid gap-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(22rem,1fr)]">
              <fieldset className="grid gap-2">
                <legend className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-soft">Purchaser type</legend>
                <div className="grid h-12 grid-cols-2 gap-1 rounded-lg border border-cream-300 bg-cream-50 p-1">
                  {(['company', 'individual'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => updateField('purchaserType', type)}
                      className={`rounded-md px-5 text-sm font-extrabold transition ${
                        form.purchaserType === type
                          ? 'bg-signal-300 text-white shadow-sm'
                          : 'text-ink-soft hover:bg-cream-200 hover:text-navy-900'
                      }`}
                    >
                      {type === 'company' ? 'Company' : 'Individual'}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="grid gap-2">
                <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-soft">Company or name</span>
                <input
                  required
                  value={form.organisationName}
                  onChange={(event) => updateField('organisationName', event.target.value)}
                  className="h-12 rounded-lg border border-cream-300 bg-cream-50 px-4 text-sm font-semibold text-ink outline-none focus:border-signal-300"
                />
              </label>
            </div>

            <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
              <label className="grid gap-2 sm:col-span-1">
                <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-soft">Contact person</span>
                <input
                  required
                  value={form.contactPerson}
                  onChange={(event) => updateField('contactPerson', event.target.value)}
                  className="h-12 rounded-lg border border-cream-300 bg-cream-50 px-4 text-sm font-semibold text-ink outline-none focus:border-signal-300"
                />
              </label>

              <label className="grid gap-2 sm:col-span-1">
                <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-soft">Email</span>
                <input
                  required
                  type="email"
                  value={form.contactEmail}
                  onChange={(event) => updateField('contactEmail', event.target.value)}
                  className="h-12 rounded-lg border border-cream-300 bg-cream-50 px-4 text-sm font-semibold text-ink outline-none focus:border-signal-300"
                />
              </label>

              <label className="grid gap-2 sm:col-span-1">
                <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-soft">Cell number</span>
                <input
                  required
                  value={form.contactPhone}
                  onChange={(event) => updateField('contactPhone', event.target.value)}
                  className="h-12 rounded-lg border border-cream-300 bg-cream-50 px-4 text-sm font-semibold text-ink outline-none focus:border-signal-300"
                />
              </label>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <QuantityField
                label="Fourballs"
                value={form.fourballs}
                min={0}
                onChange={(value) => updateQuantity('fourballs', value, 20)}
              />
              <QuantityField
                label="Individual players"
                value={form.individualPlayers}
                min={0}
                onChange={(value) => updateQuantity('individualPlayers', value, 80)}
              />
            </div>

            <fieldset className="grid gap-3">
              <legend className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-soft">Sponsor package</legend>
              <div className="grid gap-4 lg:grid-cols-2">
                {sponsorPackages.map((sponsorPackage) => (
                  <label
                    key={sponsorPackage.code}
                    className={`cursor-pointer rounded-lg border p-4 ${
                      form.sponsorPackage === sponsorPackage.code
                        ? 'border-signal-300 bg-signal-300 text-white'
                        : 'border-cream-300 bg-cream-50 text-ink hover:border-navy-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="sponsorPackage"
                      value={sponsorPackage.code}
                      checked={form.sponsorPackage === sponsorPackage.code}
                      onChange={() => updateField('sponsorPackage', sponsorPackage.code)}
                      className="sr-only"
                    />
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block font-extrabold">{sponsorPackage.label}</span>
                        <span className={`mt-2 block text-sm leading-5 ${form.sponsorPackage === sponsorPackage.code ? 'text-white/80' : 'text-ink-soft'}`}>
                          {sponsorPackage.description}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-extrabold">{formatCurrency(sponsorPackage.price)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-5 md:grid-cols-2">
              <QuantityField
                label="Cart branding"
                value={form.cartBranding}
                min={0}
                onChange={(value) => updateQuantity('cartBranding', value, 40)}
              />
              <QuantityField
                label="M2M gifting packs"
                value={form.giftingPacks}
                min={0}
                onChange={(value) => updateQuantity('giftingPacks', value, 200)}
              />
            </div>

            <label className="grid gap-2">
              <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-soft">Activation, gifting, or print notes</span>
              <textarea
                value={form.activationNotes}
                onChange={(event) => updateField('activationNotes', event.target.value)}
                rows={4}
                className="rounded-lg border border-cream-300 bg-cream-50 px-4 py-3 text-sm font-semibold leading-6 text-ink outline-none focus:border-signal-300"
                placeholder="Logo assets, signage sizes, gifting ideas, special guests, dietary context..."
              />
            </label>

            <div className="grid gap-3 rounded-lg border border-cream-300 bg-cream-100 p-4">
              <label className="flex items-start gap-3 text-sm font-semibold leading-6 text-ink-soft">
                <input
                  type="checkbox"
                  checked={form.communicationConsent}
                  onChange={(event) => updateField('communicationConsent', event.target.checked)}
                  className="mt-1 h-4 w-4 accent-signal-300"
                />
                M2M may send booking, invoice, player-form, and event-day updates by email or WhatsApp.
              </label>
              <label className="flex items-start gap-3 text-sm font-semibold leading-6 text-ink-soft">
                <input
                  required
                  type="checkbox"
                  checked={form.popiaGuestConsent}
                  onChange={(event) => updateField('popiaGuestConsent', event.target.checked)}
                  className="mt-1 h-4 w-4 accent-signal-300"
                />
                <span>
                  I confirm guest/player consent for booking and event administration.
                  {' '}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenPopia();
                    }}
                    className="font-extrabold text-signal-300 hover:text-signal-500"
                  >
                    Read POPIA compliance.
                  </button>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm font-semibold leading-6 text-ink-soft">
                <input
                  required
                  type="checkbox"
                  checked={form.termsAccepted}
                  onChange={(event) => updateField('termsAccepted', event.target.checked)}
                  className="mt-1 h-4 w-4 accent-signal-300"
                />
                I accept the event terms and confirm the booking details are correct.
              </label>
            </div>

            <div className="xl:hidden">
              <RegistrationTotalCard totals={totals} />
            </div>

            <div className="flex flex-col gap-3 border-t border-cream-300 pt-5 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-signal-300 px-5 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-signal-500"
              >
                Submit booking
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </section>
  );
}

function RegistrationTotalCard({ totals }: { totals: ReturnType<typeof getRegistrationTotals> }) {
  return (
    <div className="mt-6 w-full max-w-full rounded-lg border border-cream-300 bg-cream-100 p-5">
      <div className="flex items-center justify-between gap-4 border-b border-cream-300 pb-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-ink-soft">Current total</p>
          <p className="display mt-2 text-4xl leading-none text-navy-900">{formatCurrency(totals.total)}</p>
        </div>
        <ReceiptText className="h-8 w-8 text-signal-300" aria-hidden="true" />
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <RegistrationTotalRow label="Player slots" value={`${totals.slotsPurchased}`} />
        <RegistrationTotalRow label="Fourballs" value={formatCurrency(totals.fourballTotal)} />
        <RegistrationTotalRow label="Players" value={formatCurrency(totals.playerTotal)} />
        <RegistrationTotalRow label="Sponsor package" value={formatCurrency(totals.sponsorTotal)} />
        <RegistrationTotalRow label="Add-ons" value={formatCurrency(totals.cartBrandingTotal + totals.giftingTotal)} />
      </dl>
    </div>
  );
}

function RegistrationTotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-extrabold text-navy-900">{value}</dd>
    </div>
  );
}

function QuantityField({
  label,
  max,
  min,
  onChange,
  value,
}: {
  label: string;
  max?: number;
  min: number;
  onChange: (value: string) => void;
  value: number;
}) {
  const [draftValue, setDraftValue] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(String(value));
    }
  }, [isFocused, value]);

  function commitValue(nextValue: string) {
    const normalizedValue = String(clampNumber(Number(nextValue), min, max ?? 9999));
    setDraftValue(normalizedValue);
    onChange(normalizedValue);
  }

  return (
    <label className="grid gap-2">
      <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-soft">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draftValue}
        onBlur={() => {
          setIsFocused(false);
          commitValue(draftValue === '' ? String(min) : draftValue);
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraftValue(nextValue);
          if (nextValue !== '') {
            onChange(nextValue);
          }
        }}
        onFocus={() => setIsFocused(true)}
        className="h-12 rounded-lg border border-cream-300 bg-cream-50 px-4 text-sm font-extrabold text-ink outline-none focus:border-signal-300"
      />
    </label>
  );
}

function Detail({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-cream-200 text-navy-700">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-[11px] font-extrabold uppercase tracking-[0.14em] text-navy-700/65">{label}</span>
        <span className="mt-1 block text-sm font-bold leading-5 text-ink">{value}</span>
      </span>
    </div>
  );
}
