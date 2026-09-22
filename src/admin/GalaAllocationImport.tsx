import { useState } from 'react';
import { opsApi } from '../ops/client';
import { allocationPlan, parseAllocation, type ImportData } from './galaAllocation';

type Preview = { data: ImportData; plan: ReturnType<typeof allocationPlan> };
export function GalaAllocationImport({ eventId, onComplete }: { eventId: string; onComplete: () => void }) {
  const [text, setText] = useState('');
  const [restore, setRestore] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const path = `/api/v1/admin/gala?eventId=${encodeURIComponent(eventId)}`;
  async function check() {
    setBusy(true); setError(''); setMessage(''); setPreview(null);
    try { const rows = parseAllocation(text); const data = await opsApi<ImportData>(path); setPreview({ data, plan: allocationPlan(data, rows, restore.split('\n').filter(Boolean)) }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Preview failed.'); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview || preview.plan.errors.length) return;
    setBusy(true); setError('');
    const save = (body: object) => opsApi('/api/v1/admin/gala', { method: 'POST', body: JSON.stringify({ ...body, eventId }) });
    try {
      const current = await opsApi<ImportData>(path);
      if (JSON.stringify(current) !== JSON.stringify(preview.data)) throw new Error('The guest records have changed. Preview again before applying.');
      let completed = 0;
      const total = preview.plan.parties.length + preview.plan.players.length;
      for (const party of preview.plan.parties) {
        setMessage(`Saving allocation ${++completed} of ${total}…`);
        await save({ action: 'saveParty', ...party, quantity: party.guests.length });
      }
      const updated = await opsApi<ImportData>(path);
      for (const player of preview.plan.players) {
        const parties = updated.parties.filter(p => p.name === player.partyName && p.table_name === player.table);
        if (parties.length !== 1) throw new Error(`Cannot resolve ${player.partyName}. Preview again.`);
        setMessage(`Saving allocation ${++completed} of ${total}…`);
        await save({ action: 'savePlayer', id: player.id, partyId: parties[0].id, attendance: 'confirmed' });
      }
      const verified = await opsApi<ImportData>(path);
      for (const player of preview.plan.players) if (!verified.attendees.some(p => p.id === player.id && p.tableName === player.table)) throw new Error('Some player tables could not be verified. Preview again.');
      for (const party of preview.plan.parties) if (!verified.parties.some(p => p.name === party.name && p.table_name === party.tableName && JSON.stringify(p.guests.map(g => [g.fullName, g.attendance])) === JSON.stringify(party.guests.map(g => [g.fullName, g.attendance])))) throw new Error('Some guest tables could not be verified. Preview again.');
      setMessage(`Verified: ${preview.plan.assigned} confirmed seats allocated. ${preview.plan.unassigned} spreadsheet rows left unassigned. ${preview.plan.warnings.length} non-attending records preserved.`);
      setPreview(null); onComplete();
    } catch (e) { setError(`${e instanceof Error ? e.message : 'Import failed.'} Any completed saves are retained; preview again to safely resume.`); setPreview(null); }
    finally { setBusy(false); }
  }
  return <details className="panel"><summary>Import table allocations</summary><p>Paste tab-separated columns: Name, Source, Party, Table, Fourball. Unassigned rows and existing attendance cancellations are preserved. Guest details are matched within their existing party; new parties are added.</p><label><span>Load seating TSV file</span><input type="file" accept=".tsv,.txt" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) { if (file.size > 200000) { setError('The file is too large.'); return; } void file.text().then(value => { setText(value); setPreview(null); setMessage(''); }).catch(() => setError('The file could not be read.')); } }} /></label><label><span>Seating allocation rows</span><textarea rows={8} value={text} disabled={busy} onChange={e => { setText(e.target.value); setPreview(null); setMessage(''); }} /></label><label><span>Restore attendance and missing seats for these parties (one per line; optional)</span><textarea rows={2} disabled={busy} value={restore} onChange={e => { setRestore(e.target.value); setPreview(null); }} /></label><button type="button" className="secondary-button" disabled={busy || !text.trim()} onClick={() => void check()}>Preview allocations</button>{preview && <><p>{preview.plan.assigned} confirmed seats to allocate; {preview.plan.unassigned} unassigned rows; {preview.plan.parties.filter(p => !p.id).length} new seating parties.</p>{preview.plan.errors.map((e, i) => <p key={i} role="alert">{e}</p>)}{preview.plan.warnings.map((w, i) => <p key={i}>{w}</p>)}<button type="button" className="primary-button" disabled={busy || !!preview.plan.errors.length} onClick={() => void apply()}>Apply table allocations</button></>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}</details>;
}
