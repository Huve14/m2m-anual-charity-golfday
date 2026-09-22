export type ImportGuest = { id?: string; fullName: string; email: string; phone: string; dietaryRequirements: string; attendance: 'confirmed' | 'pending' | 'declined' };
export type ImportParty = { id: string; name: string; table_name: string; guests: ImportGuest[] };
export type ImportData = { parties: ImportParty[]; attendees: { id: string; source: string; fullName: string; team: string; attendance: string; partyId: string; tableName: string }[] };
type Row = { name: string; source: string; party: string; table: string; team: string };
const key = (value: string) => value.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/[–—]/g, '-').trim().toLowerCase();
export function parseAllocation(text: string): Row[] {
  const lines = text.replace(/^\s*\n|[\r\n]+$/g, '').split(/\r?\n/);
  if (lines.shift() !== 'Name\tSource\tParty\tTable\tFourball') throw new Error('Use the five tab-separated columns: Name, Source, Party, Table, Fourball.');
  if (!lines.length || lines.length > 1000) throw new Error('Supply between 1 and 1000 seating rows.');
  return lines.map((line, i) => {
    const [name, source, party, table, team, extra] = line.split('\t');
    if (extra !== undefined || team === undefined || !name || !['Golfer', 'Dinner only'].includes(source) || !table || (source === 'Golfer' ? !team : !party)) throw new Error(`Invalid seating row ${i + 2}.`);
    return { name, source, party, table: key(table) === 'unassigned' ? '' : /^\d+$/.test(table) ? `Table ${table}` : table, team };
  });
}
export function allocationPlan(data: ImportData, rows: Row[], restoreParties: string[] = []) {
  const errors: string[] = [], warnings: string[] = [];
  const parties: { id?: string; name: string; tableName: string; guests: ImportGuest[] }[] = [];
  const players: { id: string; partyName: string; table: string }[] = [];
  const groups = new Map<string, Row[]>();
  const used = new Set<string>();
  for (const row of rows) {
    if (!row.table) continue;
    if (row.source === 'Dinner only') { const k = key(row.party); groups.set(k, [...(groups.get(k) || []), row]); continue; }
    const matches = data.attendees.filter(p => p.source === 'Golfer' && key(p.team) === key(row.team) && key(p.fullName) === key(row.name));
    if (matches.length !== 1) { errors.push(`Cannot uniquely match golfer ${row.name} / ${row.team}.`); continue; }
    const person = matches[0];
    if (used.has(person.id)) { errors.push(`Duplicate golfer ${row.name}.`); continue; }
    used.add(person.id);
    if (person.attendance !== 'confirmed') { warnings.push(`Kept non-attending golfer unchanged: ${row.name}.`); continue; }
    const partyName = `Gala · ${row.team} · ${row.table}`;
    if (partyName.length > 160 || row.table.length > 80) { errors.push(`Name or table too long: ${row.team}.`); continue; }
    players.push({ id: person.id, partyName, table: row.table });
    if (!parties.some(p => p.name === partyName)) {
      const existing = data.parties.filter(p => p.name === partyName);
      if (existing.length > 1 || existing.some(p => p.guests.length)) { errors.push(`Conflicting seating party: ${partyName}.`); continue; }
      parties.push({ id: existing[0]?.id, name: partyName, tableName: row.table, guests: [] });
    }
  }
  for (const group of groups.values()) {
    const first = group[0];
    const matches = data.parties.filter(p => key(p.name) === key(first.party));
    if (matches.length > 1 || new Set(group.map(r => r.table)).size !== 1) { errors.push(`Conflicting party/table: ${first.party}.`); continue; }
    const existing = matches[0];
    const restore = restoreParties.some(name => key(name) === key(first.party));
    if (existing && existing.guests.length !== group.length && !(restore && existing.guests.length < group.length)) { errors.push(`Guest count differs for ${first.party}: live ${existing.guests.length}, sheet ${group.length}.`); continue; }
    const guests = existing ? existing.guests.map(g => ({ ...g })) : group.map(() => ({ fullName: '', email: '', phone: '', dietaryRequirements: '', attendance: 'confirmed' as const }));
    while (guests.length < group.length) guests.push({ fullName: '', email: '', phone: '', dietaryRequirements: '', attendance: 'confirmed' });
    const usedGuests = new Set<number>();
    for (const row of group) {
      let index = guests.findIndex((g, i) => !usedGuests.has(i) && key(g.fullName) === key(row.name));
      const placeholder = row.name.match(/^Guest details pending .* Guest (\d+)$/);
      if (index < 0 && placeholder) index = Number(placeholder[1]) - 1;
      if (index < 0) index = guests.findIndex((g, i) => !usedGuests.has(i) && !g.fullName.trim());
      if (index < 0 || index >= guests.length || usedGuests.has(index)) { errors.push(`Cannot match guest ${row.name} in ${first.party}.`); continue; }
      usedGuests.add(index);
      if (restore) guests[index].attendance = 'confirmed';
      if (guests[index].attendance !== 'confirmed') { warnings.push(`Kept non-attending guest unchanged: ${row.name} (${first.party}).`); continue; }
      if (!placeholder && !guests[index].fullName.trim()) guests[index].fullName = row.name;
    }
    parties.push({ id: existing?.id, name: existing?.name || first.party, tableName: first.table, guests });
  }
  return { errors, warnings, parties, players, unassigned: rows.filter(r => !r.table).length, assigned: players.length + parties.reduce((n, p) => n + p.guests.filter(g => g.attendance === 'confirmed').length, 0) };
}
