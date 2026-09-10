import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/admin/supplierValues.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { supplierPrizeSummary, prizeValueRand } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('prize total excludes cancelled contributions and counts missing values separately from zero', () => {
  assert.deepEqual(supplierPrizeSummary([
    { status: 'confirmed', prizeValueMinor: 500050, quantity: 2 },
    { status: 'reserved', prizeValueMinor: 100025 },
    { status: 'draft', prizeValueMinor: 0 },
    { status: 'confirmed', prizeValueMinor: null },
    { status: 'cancelled', prizeValueMinor: 900000 },
    { status: 'cancelled', prizeValueMinor: null },
  ]), { totalMinor: 600075, unvalued: 1 });
  assert.deepEqual(supplierPrizeSummary([]), { totalMinor: 0, unvalued: 0 });
  assert.match(prizeValueRand(600075).replace(/\s/g, ''), /^R6[,.]?000[,.]75$/);
});
