import { galaAttendees } from './_gala.js';

const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function findSeating(data, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (normalize(query).length < 2) return { matches: [], more: false };
  const matches = galaAttendees(data)
    .filter(person => person.attendance === 'confirmed' && words.every(word => normalize([person.fullName, person.partyName, person.company, person.team].join(' ')).includes(word)))
    .map(person => ({ name: person.fullName, party: person.partyName, company: person.company, team: person.team, table: person.tableName || '' }));
  return { matches: matches.slice(0, 30), more: matches.length > 30 };
}
