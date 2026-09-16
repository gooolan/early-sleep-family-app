import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/sleepChart.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { sleepAxis, sleepCurve, sleepMinutes, sleepTick } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('axis includes early and late sleep instead of clamping points to 22:00–02:00', () => {
  const axis = sleepAxis(['20:15', '04:20'], '23:00');
  assert.ok(axis.minimum < sleepMinutes('20:15'));
  assert.ok(axis.maximum > sleepMinutes('04:20'));
  assert.ok(sleepMinutes('00:10') > sleepMinutes('23:50'));
  assert.equal(sleepTick(sleepMinutes('00:10')), '00:10');
});

test('an empty week or identical times still has a useful, finite axis', () => {
  for (const times of [[], ['23:00', '23:00']]) {
    const axis = sleepAxis(times, '23:00');
    assert.ok(axis.maximum - axis.minimum >= 90);
    assert.ok(axis.ticks.length >= 4);
    assert.ok(axis.ticks.every(Number.isFinite));
  }
});

test('curves break at missing or exempt records and preserve isolated observations', () => {
  const path = sleepCurve([{ x: 0, y: 20 }, { x: 10, y: 10 }, null, { x: 30, y: 15 }]);
  assert.equal((path.match(/M /g) ?? []).length, 2);
  assert.equal((path.match(/C /g) ?? []).length, 1);
  assert.ok(path.endsWith('M 30 15'));
  assert.equal(sleepCurve([null, null]).trim(), '');
});
