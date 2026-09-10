import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(fs.readFileSync(new URL('../src/admin/GalaDinner.tsx', import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
function harness() {
  const attendees = ['fourball', 'invited_guest', 'staff'].map((category, i) => ({ id: `p${i}`, category, source: i === 0 ? 'Golfer' : 'Dinner only', fullName: `Person ${category}`, attendance: 'confirmed', partyId: i ? `party${i}` : '', partyName: '', tableName: '', dietaryRequirements: '', email: '', phone: '', company: '', team: '' }));
  attendees.push({ ...attendees[2], id: 'cancelled', fullName: 'Cancelled staff', attendance: 'declined' });
  const parties = attendees.filter(p => p.partyId && p.id !== 'cancelled').map(p => ({ id: p.partyId, name: `Party ${p.category}`, category: p.category, table_name: '', guests: [p] }));
  const state = [{ attendees, parties }]; let cursor = 0;
  const module = { exports: {} };
  const mockRequire = name => name === 'react' ? { useEffect() {}, useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; } } : name === '../ops/client' ? {} : require(name);
  new Function('require', 'exports', code)(mockRequire, module.exports);
  function render() { cursor = 0; return module.exports.GalaDinner({ eventId: 'event', exports: null }); }
  function find(node, predicate, results = []) { if (!node) return results; if (Array.isArray(node)) { node.forEach(n => find(n, predicate, results)); return results; } if (predicate(node)) results.push(node); if (node.props) find(node.props.children, predicate, results); return results; }
  return { render, find };
}
test('category tabs isolate attendee rows and retain the default cancellation filter', () => {
  const app = harness(); let view = app.render();
  assert.equal(app.find(view, n => n.props?.role === 'tab').length, 4);
  for (const category of ['fourball', 'invited_guest', 'staff']) {
    app.find(view, n => n.props?.id === `gala-tab-${category}`)[0].props.onClick();
    view = app.render();
    const rows = app.find(view, n => n.type === 'tbody')[0].props.children;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].props.children[0].props.children, `Person ${category}`);
    assert.equal(app.find(view, n => n.props?.role === 'tabpanel')[0].props['aria-labelledby'], `gala-tab-${category}`);
  }
});
test('new parties started from Staff default to the Staff category', () => {
  const app = harness(); let view = app.render();
  app.find(view, n => n.props?.id === 'gala-tab-staff')[0].props.onClick();
  view = app.render();
  app.find(view, n => n.type === 'button' && n.props.children === 'Add dinner party')[0].props.onClick();
  view = app.render();
  assert.equal(app.find(view, n => n.type === 'select' && n.props.value === 'staff').length, 1);
});
