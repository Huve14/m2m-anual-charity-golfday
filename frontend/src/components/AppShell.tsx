import type { ReactNode } from 'react';
import { Activity } from 'lucide-react';
import type { AppPage } from '../App';
import m2mBlueLogo from '../assets/m2m-blue.png';

type AppShellProps = {
  children: ReactNode;
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
};

const navItems = [
  { label: 'Event', sectionId: 'event' },
  { label: 'Register', sectionId: 'register' },
];

function scrollHomeSection(sectionId: string, onNavigate: (page: AppPage) => void) {
  onNavigate('home');
  window.setTimeout(() => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 0);
}

export function AppShell({ children, currentPage, onNavigate }: AppShellProps) {
  return (
    <div className="min-h-screen bg-cream-100 text-ink">
      <header className="sticky top-0 z-40 border-b border-cream-300 bg-cream-100/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <button
            type="button"
            onClick={() => scrollHomeSection('event', onNavigate)}
            className="flex min-w-0 items-center gap-4 text-left"
            aria-label="M2M Annual Charity Golf Day"
          >
            <img src={m2mBlueLogo} alt="M2M" className="h-9 w-auto shrink-0 sm:h-11" />
            <span className="min-w-0">
              <span className="display block truncate text-xl leading-none text-navy-900">Annual Charity</span>
              <span className="block truncate text-[11px] font-bold uppercase tracking-[0.16em] text-ink-soft">
                Golf Day Platform
              </span>
            </span>
          </button>

          <nav className="hidden items-center gap-5 text-[13px] font-bold uppercase tracking-[0.08em] text-ink-soft lg:flex">
            {navItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => scrollHomeSection(item.sectionId, onNavigate)}
                className="hover:text-navy-700"
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onNavigate('info')}
              className={currentPage === 'info' ? 'text-signal-300' : 'hover:text-navy-700'}
            >
              Info
            </button>
            <button
              type="button"
              onClick={() => onNavigate('popia')}
              className={currentPage === 'popia' ? 'text-signal-300' : 'hover:text-navy-700'}
            >
              POPIA
            </button>
            <button
              type="button"
              onClick={() => onNavigate('help')}
              className={currentPage === 'help' ? 'text-signal-300' : 'hover:text-navy-700'}
            >
              Help
            </button>
          </nav>

          <button
            type="button"
            onClick={() => onNavigate(currentPage === 'popia' ? 'help' : 'popia')}
            className="hidden items-center gap-2 rounded-full border border-signal-300 bg-cream-50 px-3 py-2 text-xs font-bold text-navy-700 sm:flex"
          >
            <Activity className="h-4 w-4 text-signal-300" aria-hidden="true" />
            {currentPage === 'popia' ? 'Help' : 'POPIA'}
          </button>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
