import test from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage
globalThis.localStorage = (() => {
  const store = {};
  return {
    getItem: k => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; }
  };
})();

const { getApiKey, setApiKey, testConnection } = await import('../src/domain/gemini.js');

test('getApiKey returns default or custom key', () => {
  const initial = getApiKey();
  setApiKey('custom-test-key-12345');
  assert.equal(getApiKey(), 'custom-test-key-12345');

  // Reset
  setApiKey('');
  assert.equal(getApiKey(), initial);
});

test('testConnection executes against Gemini API', async () => {
  const key = getApiKey();
  if (!key) return; // Skip if no API key is set in environment
  const result = await testConnection();
  assert.ok('success' in result);
  if (result.success) {
    assert.ok(result.latencyMs >= 0);
  } else {
    assert.ok(result.error);
  }
});

test('testConnection fails gracefully with invalid key', async () => {
  const result = await testConnection('INVALID_KEY_9999');
  assert.equal(result.success, false);
  assert.ok(result.error);
});
