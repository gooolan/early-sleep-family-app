import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = mkdtempSync(join(tmpdir(), 'early-sleep-download-tests-'));
after(() => rmSync(directory, { recursive: true, force: true }));
let platform = 'web';
let available = true;
let save = async () => {};
globalThis.testCapacitor = {
  Capacitor: { getPlatform: () => platform, isPluginAvailable: () => available },
  registerPlugin: () => ({ save: (input) => save(input) }),
};
const source = readFileSync(new URL('../src/download.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const path = join(directory, 'download.mjs');
writeFileSync(path, outputText.replace('import { Capacitor, registerPlugin } from "@capacitor/core";', 'const { Capacitor, registerPlugin } = globalThis.testCapacitor;'));
const { downloadJSON } = await import(pathToFileURL(path));

test('browser export creates a JSON file without any network request', async () => {
  platform = 'web';
  let blob;
  let clicked = false;
  const anchor = { click: () => { clicked = true; }, remove: () => {} };
  globalThis.document = { createElement: () => anchor, body: { appendChild: () => {} } };
  globalThis.window = { setTimeout: () => 1 };
  const original = URL.createObjectURL;
  try {
    URL.createObjectURL = (value) => { blob = value; return 'blob:local-test'; };
    await downloadJSON({ family: { id: 'offline-family' } }, 'offline.json');
    assert.equal(clicked, true);
    assert.equal(anchor.download, 'offline.json');
    assert.equal(blob.type, 'application/json');
    assert.deepEqual(JSON.parse(await blob.text()), { family: { id: 'offline-family' } });
  } finally { URL.createObjectURL = original; }
});

test('Android export uses the file picker bridge and surfaces cancellation/old package', async () => {
  platform = 'android';
  let received;
  save = async (input) => { received = input; };
  await downloadJSON({ family: { id: 'offline-family' } }, 'offline.json');
  assert.deepEqual(JSON.parse(received.json), { family: { id: 'offline-family' } });
  assert.equal(received.filename, 'offline.json');
  save = async () => { throw new Error('cancelled'); };
  await assert.rejects(downloadJSON({}, 'offline.json'), /cancelled/);
  available = false;
  await assert.rejects(downloadJSON({}, 'offline.json'), /完整 APK/);
});
