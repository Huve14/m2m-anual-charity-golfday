import { fromSupabase } from './_ops.js';

export async function loadGalaData(client, eventId) {
  const sources = {
    parties: ['m2m_gala_parties', '*'],
    settings: ['m2m_gala_players', '*'],
    players: ['m2m_players', 'id,full_name,email,phone,dietary_requirements,fourball:m2m_fourballs(team_name,booking_status,eventCompany:m2m_event_companies(relationship_status,company:m2m_companies(name)))'],
  };
  return Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([key, [table, select]]) => {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from(table).select(select).eq('event_id', eventId).order('id').range(offset, offset + 499);
      if (error) throw fromSupabase(error, 'gala_load_failed', 'Gala dinner records could not be loaded. Check that the gala migration has been applied.');
      rows.push(...data);
      if (data.length < 500) break;
    }
    return [key, rows];
  })));
}

export function galaAttendees({ parties = [], settings = [], players = [] }) {
  const partyMap = new Map(parties.map(p => [p.id, p]));
  const settingMap = new Map(settings.map(p => [p.id, p]));
  const golfers = players.filter(p => p.full_name?.trim() && p.fourball && p.fourball.booking_status !== 'cancelled' && p.fourball.eventCompany?.relationship_status !== 'cancelled').map(p => {
    const setting = settingMap.get(p.id);
    const party = partyMap.get(setting?.party_id);
    return { id: p.id, source: 'Golfer', fullName: p.full_name, email: p.email || '', phone: p.phone || '', dietaryRequirements: p.dietary_requirements || '', attendance: setting?.attendance || 'pending', partyId: party?.id || '', partyName: party?.name || '', tableName: party?.table_name || '', company: p.fourball.eventCompany?.company?.name || '', team: p.fourball.team_name || '' };
  });
  const guests = parties.flatMap(p => p.guests.map(g => ({ ...g, source: 'Dinner only', partyId: p.id, partyName: p.name, tableName: p.table_name, company: '', team: '' })));
  return [...golfers, ...guests].sort((a, b) => a.tableName.localeCompare(b.tableName, undefined, { numeric: true }) || a.partyName.localeCompare(b.partyName) || a.fullName.localeCompare(b.fullName));
}

export function galaSheets(data, holistic = false) {
  const everyone = galaAttendees(data);
  const attending = everyone.filter(p => p.attendance === 'confirmed');
  const column = (name, width = 26) => ({ name, width });
  const roster = (name, rows) => ({ name, title: name, note: 'One row per named person. Golfer dietary requirements are read directly from the player record. Blank requirements mean not recorded.', columns: ['Name', 'Source', 'Attendance', 'Party', 'Table', 'Dietary requirements', 'Company', 'Fourball', 'Email', 'Phone'].map(n => column(n)), rows: rows.map(p => [p.fullName, p.source, p.attendance, p.partyName, p.tableName || 'Unassigned', p.dietaryRequirements, p.company, p.team, p.email, p.phone]) });
  const tables = new Map();
  for (const p of attending) tables.set(p.tableName || 'Unassigned', (tables.get(p.tableName || 'Unassigned') || 0) + 1);
  return [roster('Gala dinner', attending), roster('Catering requirements', attending.filter(p => p.dietaryRequirements.trim())), { name: 'Table totals', title: 'Confirmed dinner seats', note: 'Confirmed attendees only; no table capacity is assumed.', columns: [column('Table'), { name: 'Attendees', width: 16, format: 'integer' }], rows: [...tables.entries()] }, ...(holistic ? [roster('All attendees', everyone)] : [])];
}
