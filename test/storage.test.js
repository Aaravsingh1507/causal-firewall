import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * Storage tests run against an in-memory mock since Node.js
 * doesn't provide localStorage. These tests validate the
 * module's import/export and data-shaping logic.
 */

// Set up a minimal localStorage mock
globalThis.localStorage = (() => {
  const store = {};
  return {
    getItem: k => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; }
  };
})();

// Mock document.createElement / body for downloadFile
globalThis.document = {
  createElement: () => ({ set href(v) {}, set download(v) {}, click() {} }),
  body: { appendChild() {}, removeChild() {} }
};
globalThis.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
globalThis.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } };

const { saveHistory, loadHistory, saveCustomScenarios, loadCustomScenarios,
        savePreferences, loadPreferences, importScenarios, clearAllData } = await import('../src/domain/storage.js');

/* ── History round-trip ────────────────────────────────── */

test('history saves and loads correctly', () => {
  const history = [{ id: 'eval-1', decision: 'allow' }, { id: 'eval-2', decision: 'review' }];
  saveHistory(history);
  const loaded = loadHistory();
  assert.deepEqual(loaded, history);
});

test('loadHistory returns empty array when nothing is saved', () => {
  clearAllData();
  assert.deepEqual(loadHistory(), []);
});

/* ── Custom scenarios round-trip ───────────────────────── */

test('custom scenarios save and load', () => {
  const scenarios = [{ id: 'custom-1', label: 'Test', interventions: [] }];
  saveCustomScenarios(scenarios);
  assert.deepEqual(loadCustomScenarios(), scenarios);
});

/* ── Preferences ───────────────────────────────────────── */

test('preferences default values', () => {
  clearAllData();
  const prefs = loadPreferences();
  assert.equal(prefs.theme, 'dark');
  assert.equal(prefs.onboardingDone, false);
});

test('preferences save and load', () => {
  savePreferences({ theme: 'light', onboardingDone: true, notificationsEnabled: false, defaultShadowSize: 10 });
  const prefs = loadPreferences();
  assert.equal(prefs.theme, 'light');
  assert.equal(prefs.defaultShadowSize, 10);
});

/* ── Import ────────────────────────────────────────────── */

test('importScenarios validates required fields', () => {
  const result = importScenarios(JSON.stringify([{ id: 'x' }]));
  assert.equal(result.success, false);
  assert.match(result.error, /missing required fields/);
});

test('importScenarios accepts valid scenarios', () => {
  clearAllData();
  const result = importScenarios(JSON.stringify([
    { id: 'imported-1', label: 'Imported', interventions: [{ id: 'i1' }] }
  ]));
  assert.equal(result.success, true);
  assert.equal(result.count, 1);
  assert.equal(loadCustomScenarios().length, 1);
});

test('importScenarios rejects non-array input', () => {
  const result = importScenarios(JSON.stringify({ id: 'x' }));
  assert.equal(result.success, false);
});

test('importScenarios handles invalid JSON', () => {
  const result = importScenarios('not json');
  assert.equal(result.success, false);
});

/* ── Clear ─────────────────────────────────────────────── */

test('clearAllData removes everything', () => {
  saveHistory([{ id: 'x' }]);
  savePreferences({ theme: 'light' });
  clearAllData();
  assert.deepEqual(loadHistory(), []);
  assert.equal(loadPreferences().theme, 'dark'); // back to default
});
