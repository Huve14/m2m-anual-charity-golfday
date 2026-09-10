import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { opsApi } from '../ops/client';

type Attendance = 'pending' | 'confirmed' | 'declined';
type Guest = { id?: string; fullName: string; email: string; phone: string; dietaryRequirements: string; attendance: Attendance };
type Party = { id: string; name: string; table_name: string; guests: Guest[] };
type Attendee = Guest & { id: string; source: string; partyId: string; partyName: string; tableName: string; company: string; team: string };
type Payload = { parties: Party[]; attendees: Attendee[] };
const newGuest = (): Guest => ({ fullName: '', email: '', phone: '', dietaryRequirements: '', attendance: 'confirmed' });

function AttendanceInput({ id, value, onChange }: { id: string; value: Attendance; onChange: (v: Attendance) => void }) {
  return <select id={id} aria-label="Dinner attendance" value={value} onChange={e => onChange(e.target.value as Attendance)}><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="declined">Not attending</option></select>;
}

export function GalaDinner({ eventId, exports }: { eventId: string; exports: ReactNode }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(false);
  const [partyId, setPartyId] = useState<string>();
  const [name, setName] = useState('');
  const [tableName, setTableName] = useState('');
  const [guests, setGuests] = useState<Guest[]>([]);
  const [player, setPlayer] = useState<Attendee | null>(null);
  useEffect(() => {
    let active = true;
    opsApi<Payload>(`/api/v1/admin/gala?eventId=${eventId}`).then(result => { if (active) setData(result); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [eventId, version]);
  async function save(body: object) {
    setBusy(true); setError(''); setMessage('');
    try {
      await opsApi('/api/v1/admin/gala', { method: 'POST', body: JSON.stringify({ ...body, eventId }) });
      setVersion(v => v + 1); setEditing(false); setPlayer(null); setMessage('Dinner details saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Dinner details could not be saved.'); }
    finally { setBusy(false); }
  }
  function editParty(p?: Party) {
    setPartyId(p?.id); setName(p?.name || ''); setTableName(p?.table_name || ''); setGuests(p?.guests.map(g => ({ ...g })) || [newGuest()]); setEditing(true); setPlayer(null); setMessage('');
  }
  function updateGuest(index: number, changes: Partial<Guest>) { setGuests(current => current.map((g, i) => i === index ? { ...g, ...changes } : g)); }
  const attendees = data?.attendees || [];
  const confirmed = attendees.filter(p => p.attendance === 'confirmed');
  const visible = attendees.filter(p => (filter === 'all' || p.attendance === filter) && [p.fullName, p.partyName, p.tableName, p.company, p.team, p.dietaryRequirements].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <>
    <div className="section-header"><div><span className="eyebrow">Evening attendance</span><h2>Gala dinner</h2><p>Bring golfers and dinner-only guests together. Create a party for couples or groups and assign one table for everyone in it.</p></div><button className="primary-button" disabled={busy || !data} onClick={() => editParty()}>Add dinner party</button></div>
    {error && <div className="error-banner" role="alert">{error}</div>}{message && <div className="success-banner" role="status">{message}</div>}
    <div className="metric-grid">{[['Confirmed dinner guests', confirmed.length], ['Awaiting confirmation', attendees.filter(p => p.attendance === 'pending').length], ['Dietary requirements', confirmed.filter(p => p.dietaryRequirements.trim()).length], ['Confirmed without a table', confirmed.filter(p => !p.tableName).length]].map(([label, count]) => <article className="metric-card" key={label}><span>{label}</span><strong>{count}</strong></article>)}</div>
    {editing && <form className="panel" onSubmit={(e: FormEvent) => { e.preventDefault(); void save({ action: 'saveParty', id: partyId, name, tableName, quantity: guests.length, guests }); }}>
      <h3>{partyId ? 'Edit dinner party' : 'New dinner party'}</h3><fieldset disabled={busy} className="gala-fieldset"><div className="form-grid compact"><label><span>Party name</span><input required maxLength={160} value={name} onChange={e => setName(e.target.value)} placeholder="John and Jane Smith" /></label><label><span>Quantity (dinner-only guests)</span><input type="number" required min={0} max={100} value={guests.length} onChange={e => { const quantity = Number(e.target.value); if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100) return; if (guests.slice(quantity).some(g => g.fullName || g.email || g.phone || g.dietaryRequirements)) { setError("Remove guests with recorded details individually before reducing the quantity."); return; } setGuests(current => Array.from({ length: quantity }, (_, i) => current[i] || newGuest())); setError(''); }} /></label><label><span>Table</span><input maxLength={80} value={tableName} onChange={e => setTableName(e.target.value)} placeholder="e.g. Table 4" /></label></div>
      <p>Save a party name and quantity now; guest details are optional and can be added later. Quantity counts dinner-only guests. Linked golfers are counted separately, so do not include them in this quantity.</p>
      {guests.map((g, i) => <details className="gala-guest" key={g.id || i}><summary>{g.fullName || `Guest ${i + 1} · details pending`}</summary><div className="form-grid compact"><label><span>Full name</span><input maxLength={160} value={g.fullName} onChange={e => updateGuest(i, { fullName: e.target.value })} /></label><label><span>Email</span><input type="email" value={g.email} onChange={e => updateGuest(i, { email: e.target.value })} /></label><label><span>Phone</span><input maxLength={40} value={g.phone} onChange={e => updateGuest(i, { phone: e.target.value })} /></label><label htmlFor={`guest-attendance-${i}`}><span>Attendance</span><AttendanceInput id={`guest-attendance-${i}`} value={g.attendance} onChange={attendance => updateGuest(i, { attendance })} /></label><label><span>Dietary requirements</span><textarea maxLength={1000} value={g.dietaryRequirements} onChange={e => updateGuest(i, { dietaryRequirements: e.target.value })} placeholder="e.g. vegetarian, nut allergy; enter None if confirmed" /></label></div><button type="button" className="secondary-button" onClick={() => setGuests(current => current.filter((_, index) => index !== i))}>Remove guest {i + 1}</button></details>)}
      <div className="form-actions"><button type="button" className="secondary-button" disabled={guests.length >= 100} onClick={() => setGuests(current => [...current, newGuest()])}>Add another guest</button><button className="primary-button" type="submit">{busy ? 'Saving…' : 'Save party'}</button><button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancel</button></div></fieldset>
    </form>}
    {player && <form className="panel" onSubmit={e => { e.preventDefault(); void save({ action: 'savePlayer', id: player.id, partyId: player.partyId || null, attendance: player.attendance }); }}><h3>Dinner details · {player.fullName}</h3><fieldset disabled={busy} className="gala-fieldset"><div className="form-grid compact"><p>Attendance: Confirmed automatically with the fourball.</p><label><span>Party and shared table</span><select value={player.partyId} onChange={e => setPlayer({ ...player, partyId: e.target.value })}><option value="">No party assigned</option>{data?.parties.map(p => <option value={p.id} key={p.id}>{p.name} · {p.table_name || 'No table'}</option>)}</select></label></div><p>Dietary requirements: {player.dietaryRequirements || 'Not recorded'}. Update the golfer’s details on the Players or Fourballs page; changes appear here automatically.</p><div className="form-actions"><button className="primary-button">{busy ? 'Saving…' : 'Save dinner details'}</button><button className="secondary-button" type="button" onClick={() => setPlayer(null)}>Cancel</button></div></fieldset></form>}
    <section className="panel"><h3>Everyone attending</h3><p>All player places in active fourballs are automatically confirmed, including unnamed players. Dinner party quantities include seats awaiting guest details. Cancelled golf bookings are excluded.</p><div className="form-grid compact"><label><span>Search attendees, tables or dietary needs</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label><label><span>Attendance filter</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All attendees</option><option value="confirmed">Confirmed</option><option value="pending">Pending</option><option value="declined">Not attending</option></select></label></div>
      <div className="table-scroll"><table><thead><tr><th>Name</th><th>Source</th><th>Party / fourball</th><th>Table</th><th>Attendance</th><th>Dietary requirements</th><th>Manage</th></tr></thead><tbody>{visible.map(p => <tr key={`${p.source}-${p.id}`}><td>{p.fullName}</td><td>{p.source}</td><td>{p.partyName || p.team || 'Unassigned'}</td><td>{p.tableName || 'Unassigned'}</td><td>{p.attendance}</td><td>{p.dietaryRequirements || 'Not recorded'}</td><td><button className="secondary-button" disabled={busy} onClick={() => { if (p.source === 'Golfer') { setPlayer(p); setEditing(false); } else editParty(data?.parties.find(party => party.id === p.partyId)); }}>{p.source === 'Golfer' ? 'Dinner details' : 'Edit party'}</button></td></tr>)}</tbody></table></div>{!visible.length && <p>{!data ? (error ? 'Dinner records are unavailable.' : 'Loading dinner records…') : 'No attendees match this view.'}</p>}
    </section>
    {!!data?.parties.length && <section className="panel"><h3>Parties and tables</h3><div className="compact-list">{data.parties.map(p => <div key={p.id}><div><strong>{p.name}</strong><span>{p.table_name || 'Table unassigned'} · {p.guests.length} dinner-only seats · {attendees.filter(a => a.partyId === p.id && a.attendance === 'confirmed').length} confirmed</span></div><button className="secondary-button" disabled={busy} onClick={() => editParty(p)}>Edit party</button></div>)}</div></section>}
    {exports}
  </>;
}
