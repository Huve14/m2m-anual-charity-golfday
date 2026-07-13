import { useEffect, useState } from 'react';
import { AppShell } from './components/AppShell';
import { HelpPage } from './components/HelpPage';
import { InfoPage } from './components/InfoPage';
import { LandingPage } from './components/LandingPage';
import { PopiaPage } from './components/PopiaPage';

export type AppPage = 'home' | 'help' | 'info' | 'popia';

function pageFromHash(): AppPage {
  const hash = window.location.hash.replace(/^#\/?/, '').split(/[?&]/)[0];
  if (hash === 'help') return 'help';
  if (hash === 'info') return 'info';
  if (hash === 'popia') return 'popia';
  return 'home';
}

export function App() {
  const [page, setPage] = useState<AppPage>(pageFromHash);

  useEffect(() => {
    const handleHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (page !== 'home') {
      window.scrollTo({ behavior: 'smooth', top: 0 });
    }
  }, [page]);

  function navigate(pageName: AppPage) {
    setPage(pageName);
    const nextHash = pageName === 'help' ? '#help' : pageName === 'info' ? '#info' : pageName === 'popia' ? '#popia' : '#event';
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash);
    }
  }

  return (
    <AppShell currentPage={page} onNavigate={navigate}>
      {page === 'help' ? (
        <HelpPage onBack={() => navigate('home')} />
      ) : page === 'info' ? (
        <InfoPage onBack={() => navigate('home')} />
      ) : page === 'popia' ? (
        <PopiaPage onBack={() => navigate('home')} />
      ) : (
        <LandingPage onOpenHelp={() => navigate('help')} onOpenInfo={() => navigate('info')} onOpenPopia={() => navigate('popia')} />
      )}
    </AppShell>
  );
}
