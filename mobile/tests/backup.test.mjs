import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Run the actual TypeScript modules using the project's existing compiler.
const directory = mkdtempSync(join(tmpdir(), 'early-sleep-backup-tests-'));
writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
for (const name of ['backup', 'api']) {
  const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  writeFileSync(join(directory, `${name}.js`), outputText.replace('from "./backup"', 'from "./backup.js"'));
}
after(() => rmSync(directory, { recursive: true, force: true }));
const { saveBackup, listBackups, preserveLegacyCache, listLegacyCaches, backupStatus } = await import(pathToFileURL(join(directory, 'backup.js')));
const { APIClient } = await import(pathToFileURL(join(directory, 'api.js')));

class MemoryStorage {
  values = new Map();
  fail = false;
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.fail) throw new DOMException('Full', 'QuotaExceededError');
    this.values.set(key, value);
  }
  removeItem(key) { this.values.delete(key); }
}
function backup(revision = 1, id = 'family-a') {
  return {
    formatVersion: 1, exportedAt: `2026-09-15T12:00:${String(revision).padStart(2, '0')}Z`,
    family: {
      id, name: 'Test family', revision, joinCodeHash: 'secret',
      members: { owner: { id: 'owner', tokenHash: 'secret', phone: 'test-phone' } },
      activeWeek: { checkins: { '2026-09-15': { owner: { time: '22:00' } } } },
      weeklyArchives: [{ weekStart: '2026-09-06' }],
      products: [{ id: 'p1' }], priceStores: [{ id: 's1' }], priceRecords: [{ id: 'r1', unitPrice: 2 }],
      unknownFutureField: { retained: true },
    },
  };
}

test('full export retains every data domain, strips login hashes and isolates families/backends', () => {
  const storage = new MemoryStorage();
  const input = backup();
  saveBackup('https://one/', input, storage);
  saveBackup('https://two', backup(), storage);
  saveBackup('https://one', backup(1, 'family-b'), storage);
  assert.equal(listBackups(storage).length, 3);
  const saved = listBackups(storage).find(x => x.backendURL === 'https://one' && x.latest.family.id === 'family-a').latest;
  assert.deepEqual(saved.family.priceRecords, input.family.priceRecords);
  assert.deepEqual(saved.family.unknownFutureField, input.family.unknownFutureField);
  assert.deepEqual(saved.family.weeklyArchives, input.family.weeklyArchives);
  assert.deepEqual(saved.family.activeWeek, input.family.activeWeek);
  assert.equal(saved.family.members.owner.phone, 'test-phone');
  assert.equal(saved.family.members.owner.tokenHash, undefined);
  assert.equal(saved.family.joinCodeHash, undefined);
  assert.equal(input.family.members.owner.tokenHash, 'secret');
});

test('polling unchanged data retains the previous distinct version', () => {
  const storage = new MemoryStorage();
  saveBackup('https://one', backup(1), storage);
  saveBackup('https://one', backup(2), storage);
  const repeated = backup(2); repeated.exportedAt = '2026-09-15T15:00:00Z';
  saveBackup('https://one/', repeated, storage);
  assert.equal(listBackups(storage)[0].previous.family.revision, 1);
  assert.equal(listBackups(storage)[0].latest.exportedAt, backup(2).exportedAt);
});

test('quota exhaustion, incomplete response, server rollback and corrupt storage preserve existing bytes', () => {
  const storage = new MemoryStorage();
  saveBackup('https://one', backup(2), storage);
  const original = storage.getItem(storage.key(0));
  storage.fail = true;
  assert.throws(() => saveBackup('https://one', backup(3), storage), /Full/);
  storage.fail = false;
  assert.throws(() => saveBackup('https://one', backup(1), storage), /版本早于/);
  const partial = backup(3); delete partial.family.priceRecords;
  assert.throws(() => saveBackup('https://one', partial, storage), /完整家庭备份/);
  assert.equal(storage.getItem(storage.key(0)), original);
  storage.setItem(storage.key(0), 'corrupt evidence');
  assert.throws(() => saveBackup('https://one', backup(3), storage));
  assert.equal(storage.getItem(storage.key(0)), 'corrupt evidence');
});

test('legacy rescue survives replacing the active view and clearing credentials', () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify({ backendURL: 'https://one', family: { id: 'family-a', activeWeek: { days: [1, 2] } } });
  storage.setItem('earlySleep.family.v1', raw);
  storage.setItem('earlySleep.token', 'token');
  preserveLegacyCache(storage);
  storage.setItem('earlySleep.family.v1', JSON.stringify({ backendURL: 'https://one', family: { id: 'family-a' } }));
  preserveLegacyCache(storage);
  storage.removeItem('earlySleep.token');
  assert.equal(listLegacyCaches(storage).find(x => x.key.startsWith('earlySleep.rescue')).raw, raw);
});

test('API refresh and price mutations save full backups; network/auth failures keep them exportable', async () => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = new EventTarget();
  let revision = 1;
  let failExport = false;
  let failFamily = false;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/export')) {
      if (failExport) throw new Error('offline');
      return Response.json({ data: backup(revision) });
    }
    if (failFamily) return Response.json({ error: { code: 'unauthorized', message: 'Expired' } }, { status: 401 });
    return Response.json({ data: {} });
  };
  const api = new APIClient('https://one', 'test-token');
  const flush = () => new Promise(resolve => setTimeout(resolve, 20));
  await api.family(); await flush();
  assert.equal(listBackups()[0].latest.family.revision, 1);
  revision = 2;
  await api.createPriceRecord({}); await flush();
  assert.equal(listBackups()[0].latest.family.revision, 2);
  assert.deepEqual(api.cachedPrices('family-a').records, backup(2).family.priceRecords);
  assert.equal(api.cachedPrices('another-family'), null);
  failExport = true;
  await api.family(); await flush();
  assert.match(backupStatus('https://one'), /旧备份已保留/);
  failFamily = true;
  await assert.rejects(api.family(), /Expired/);
  assert.equal(listBackups()[0].latest.family.revision, 2);
  assert.equal(listBackups()[0].previous.family.revision, 1);
});

test('mutation during an export queues a fresh export instead of losing the newer data', async () => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = new EventTarget();
  let release;
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (!url.endsWith('/export')) return Response.json({ data: {} });
    calls++;
    if (calls === 1) return new Promise(resolve => { release = () => resolve(Response.json({ data: backup(1) })); });
    return Response.json({ data: backup(2) });
  };
  const api = new APIClient('https://queue', 'token');
  await api.family();
  await api.createPriceRecord({});
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 2);
  assert.equal(listBackups()[0].latest.family.revision, 2);
});
