import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/interaction.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { nightDate } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const now = new Date('2026-09-16T15:00:00Z');

test('night dates use the family timezone and exact cutoff across week, month and year boundaries', () => {
  assert.equal(nightDate('Asia/Shanghai', 6, new Date('2026-09-12T21:59:00Z')), '2026-09-12');
  assert.equal(nightDate('Asia/Shanghai', 6, new Date('2026-09-12T22:00:00Z')), '2026-09-13');
  assert.equal(nightDate('Asia/Shanghai', 6, new Date('2026-01-31T20:00:00Z')), '2026-01-31');
  assert.equal(nightDate('Asia/Shanghai', 6, new Date('2025-12-31T20:00:00Z')), '2025-12-31');
  assert.equal(nightDate('America/New_York', 6, now), '2026-09-16');
  assert.equal(nightDate('Asia/Shanghai', 0, new Date('2026-09-15T16:00:00Z')), '2026-09-16');
});

// Render the real homepage so regressions in button availability and reminder placement are covered.
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
function moduleURL(file) {
  const source = readFileSync(file, 'utf8');
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  outputText = outputText.replace(/from "([^"]+)"/g, (_, specifier) => {
    const resolved = specifier.startsWith('.')
      ? moduleURL(new URL(`${specifier}${specifier.endsWith('AppIcon') ? '.tsx' : '.ts'}`, file))
      : import.meta.resolve(specifier);
    return `from "${resolved}"`;
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const { TodayView } = await import(moduleURL(new URL('../src/TodayView.tsx', import.meta.url)));
function renderHome(overrides = {}) {
  const family = {
    currentMember: { id: 'me', name: '我' }, members: [{ id: 'me', name: '我' }],
    activeWeek: {
      weekStart: '2026-09-13', weekEnd: '2026-09-19',
      settings: { idealTime: '22:30', cutoffHour: 6, weekdayTiers: [{ score: 3 }], weekendTiers: [{ score: 3 }] },
      days: [{ date: '2026-09-16', members: { me: { time: '23:00', score: 2 } } }],
      summary: { members: {}, completionRate: 20 },
    },
    rewardReview: { due: true }, pendingChanges: [{ requestedBy: 'me' }],
  };
  return renderToStaticMarkup(createElement(TodayView, { family, loading: false, reviewCount: 0, onCheckIn() {}, onReview() {}, ...overrides }));
}

test('homepage keeps current-time check-in available after a previous check-in', () => {
  const html = renderHome();
  const button = html.match(/<button[^>]*class="checkin-button"[^>]*>/)[0];
  assert.doesNotMatch(button, /disabled/);
  assert.match(html, /我要睡了，记录此刻/);
  assert.match(renderHome({ loading: true }), /class="checkin-button" disabled=""/);
});

test('homepage shows only incoming approvals directly below check-in and hides an empty reminder', () => {
  const empty = renderHome();
  assert.doesNotMatch(empty, /需要你看一眼|晚未记录|复盘|菜价/);
  const pending = renderHome({ reviewCount: 2 });
  assert.match(pending, /需要你看一眼/);
  assert.match(pending, /<\/section><section class="today-tasks"/);
  assert.ok(pending.indexOf('需要你看一眼') < pending.indexOf('最近一次'));
});
