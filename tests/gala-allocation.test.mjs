import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('../src/admin/galaAllocation.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { allocationPlan, parseAllocation } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const guest = { id: 'g', fullName: '', email: 'keep', phone: '', dietaryRequirements: 'keep', attendance: 'confirmed' };
const header = 'Name\tSource\tParty\tTable\tFourball\n';
test('golfer assignments preserve individual table overrides and exclude unassigned rows', () => {
 const rows = parseAllocation(header + 'Selvan\tGolfer\t\t1\tTeam Sel\nMishka\tGolfer\t\t2\tTeam Sel\nOther\tGolfer\t\tUnassigned\tOther');
 const plan = allocationPlan({ parties: [], attendees: [{id:'sel',source:'Golfer',fullName:'Selvan',team:'Team Sel',attendance:'confirmed'}, {id:'m',source:'Golfer',fullName:'Mishka',team:'Team Sel',attendance:'confirmed'}] }, rows);
 assert.deepEqual(plan.errors, []); assert.equal(plan.assigned, 2); assert.equal(plan.unassigned, 1); assert.deepEqual(plan.players.map(p=>p.table), ['Table 1','Table 2']);
});
test('dinner guests receive names and tables without losing contact or dietary details', () => {
 const rows = parseAllocation(header + 'Kev\tDinner only\tKevin & Ori\t22\t\nOri\tDinner only\tKevin & Ori\t22\t');
 const data = { parties: [{ id:'p', name:'Kevin & Ori', table_name:'', guests:[guest,{...guest,id:'ori',attendance:'declined'}] }], attendees:[] };
 const plan = allocationPlan(data, rows);
 assert.equal(plan.assigned,1); assert.equal(plan.warnings.length,1); assert.equal(plan.parties[0].guests[0].email,'keep'); assert.equal(plan.parties[0].guests[1].attendance,'declined');
 const restored = allocationPlan(data, rows, ['Kevin & Ori']);
 assert.equal(restored.assigned,2); assert.equal(restored.parties[0].guests[1].fullName,'Ori');
});
test('missing seats are only added to existing parties when explicitly requested', () => {
 const rows = parseAllocation(header + 'Kev\tDinner only\tKevin & Ori\t22\t\nOri\tDinner only\tKevin & Ori\t22\t');
 const data = { parties: [{ id:'p', name:'Kevin & Ori', table_name:'', guests:[guest] }], attendees:[] };
 assert.equal(allocationPlan(data,rows).errors.length,1);
 assert.equal(allocationPlan(data,rows,['Kevin & Ori']).assigned,2);
});
test('ambiguous golfers and duplicate assignments cannot be applied', () => {
 const row = 'A\tGolfer\t\t1\tTeam';
 const data = { parties: [], attendees: [{id:'a', source:'Golfer', fullName:'A',team:'Team',attendance:'confirmed'}] };
 assert.equal(allocationPlan(data,parseAllocation(header+row+'\n'+row)).errors.length,1);
});
