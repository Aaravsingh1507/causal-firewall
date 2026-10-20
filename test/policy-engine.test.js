import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPolicy, getScenario } from '../src/domain/fixtures.js';
import { evaluateScenario, summarizeHistory } from '../src/domain/policy-engine.js';

test('causal intervention opens the gate', () => {
  const result = evaluateScenario(getScenario('retry-storm'), structuredClone(defaultPolicy), 'stop-retries');
  assert.equal(result.decision, 'allow');
  assert.equal(result.trace.find(node => node.id === 'metric').status, 'matched');
  assert.equal(result.matchedRuleIds.includes('causal-proof'), true);
});

test('unproven intervention is held for review', () => {
  const result = evaluateScenario(getScenario('retry-storm'), structuredClone(defaultPolicy), 'clear-cache');
  assert.equal(result.decision, 'review');
  assert.equal(result.confidence < 0.5, true);
  assert.match(result.reason, /not demonstrated/);
});

test('permissive policy can bypass the causal proof rule', () => {
  const policy = structuredClone(defaultPolicy);
  policy.rules.find(rule => rule.id === 'causal-proof').enabled = false;
  const result = evaluateScenario(getScenario('cache-drift'), policy, 'scale-db');
  assert.equal(result.decision, 'allow');
  assert.equal(result.matchedRuleIds.includes('causal-proof'), false);
  assert.deepEqual(result.matchedRuleIds, ['blast-radius', 'audit-evidence']);
});

test('history summary counts evaluated decisions', () => {
  const policy = structuredClone(defaultPolicy);
  const history = [
    evaluateScenario(getScenario('retry-storm'), policy, 'stop-retries'),
    evaluateScenario(getScenario('cache-drift'), policy, 'scale-db')
  ];
  assert.deepEqual(summarizeHistory(history), { evaluated: 2, approved: 1, review: 1 });
});
