import { useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import './seating.css';

type Seat = { name: string; party: string; company: string; team: string; table: string };
function Seating() {
  const eventId = new URLSearchParams(window.location.search).get('event') || '';
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ matches: Seat[]; more: boolean; eventName: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  async function search(e: FormEvent) {
    e.preventDefault();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch(`/api/v1/seating?${new URLSearchParams({ ...(eventId ? { eventId } : {}), q: query.trim() })}`, { cache: 'no-store', signal: controller.signal });
      const data = await response.json().catch(() => { throw new Error('Seating is temporarily unavailable. Please try again or ask the welcome desk.'); }) as { ok: boolean; message?: string; matches: Seat[]; more: boolean; eventName: string };
      if (!response.ok || !data.ok) throw new Error(data.message || 'Please try again or ask the welcome desk.');
      setResult(data);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Please try again or ask the welcome desk.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <main className="seating-shell">
    <header><img src="/assets/m2m-logo.png" alt="M2M" width="144" /><span>GALA EVENING</span></header>
    <section className="seating-intro"><p className="seating-eyebrow">A seat at something special</p><h1>Good evening.<br />Find your table.</h1><p>We’re glad you’re here. Search your name, company or party to see where you’re sitting.</p></section>
      <form onSubmit={search} className="seating-search"><label htmlFor="guest-search">Guest name, company or party</label><div><input id="guest-search" type="search" autoComplete="off" placeholder="e.g. your name or company" required minLength={2} maxLength={160} value={query} onChange={e => { request.current?.abort(); setBusy(false); setQuery(e.target.value); setResult(null); setError(''); }} /><button disabled={busy || query.trim().length < 2}>{busy ? 'Finding…' : 'Find my table'}<span aria-hidden="true">↗</span></button></div></form>
      <section aria-live="polite" aria-busy={busy} className="seating-results">
        {busy && <p>Checking the latest seating arrangements…</p>}
        {error && <div className="seating-notice" role="alert">{error} You can search again to retry.</div>}
        {result && <><p className="seating-result-label">{result.eventName} · {result.matches.length ? 'Your search results' : 'No matches yet'}</p>{!result.matches.length && <div className="seating-notice">Try your surname, company or the name your party booked under. Our welcome desk can also help you find your seat.</div>}{result.more && <p>There are more matches. Add your surname or company to narrow your search.</p>}<div className="seating-cards">{result.matches.map((seat, index) => <article className="seating-card" key={index}><div><h2>{seat.name}</h2><p>{[seat.party, seat.company, seat.team].filter((value, i, all) => value && all.indexOf(value) === i).join(' · ')}</p></div><div className={`seating-table${seat.table ? '' : ' unassigned'}`}><span>{seat.table ? 'YOUR TABLE' : 'PLEASE VISIT'}</span><strong>{seat.table || 'Welcome desk'}</strong>{!seat.table && <small>Your table is still being arranged.</small>}</div></article>)}</div></>}
      </section>
    <footer>Need a hand? Please ask at the welcome desk.<br /><span>Thank you for being part of our charity evening.</span></footer>
  </main>;
}
createRoot(document.getElementById('seating-root')!).render(<Seating />);
