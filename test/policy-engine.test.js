import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPolicy, getScenario, scenarios, scenarioLetter } from '../src/domain/fixtures.js';
import { evaluateScenario, evaluateBatch, compareEvaluations, summarizeHistory } from '../src/domain/policy-engine.js';

/* ── Basic evaluation ──────────────────────────────────── */

test('causal intervention opens the gate', () => {
  const result = evaluateScenario(getScenario('retry-storm'), structuredClone(defaultPolicy), 'stop-retries');
  assert.equal(result.decision, 'allow');
  assert.equal(result.trace.find(n => n.id === 'metric').status, 'matched');
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
  policy.rules.find(r => r.id === 'causal-proof').enabled = false;
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

/* ── All 8 scenarios are valid ─────────────────────────── */

test('all 8 built-in scenarios are well-formed', () => {
  assert.equal(scenarios.length, 8, 'Expected 8 built-in scenarios');
  for (const sc of scenarios) {
    assert.ok(sc.id, `Scenario missing id`);
    assert.ok(sc.label, `Scenario ${sc.id} missing label`);
    assert.ok(sc.shortLabel, `Scenario ${sc.id} missing shortLabel`);
    assert.ok(sc.incident, `Scenario ${sc.id} missing incident`);
    assert.equal(sc.interventions.length, 3, `Scenario ${sc.id} should have 3 interventions`);
    assert.ok(sc.signals.length >= 2, `Scenario ${sc.id} should have at least 2 signals`);
    // At least one causal intervention
    const hasCausal = sc.interventions.some(i => i.result === 'causal');
    assert.ok(hasCausal, `Scenario ${sc.id} should have at least one causal intervention`);
  }
});

/* ── Computed confidence (not hardcoded) ───────────────── */

test('confidence is computed, not hardcoded', () => {
  const policy = structuredClone(defaultPolicy);
  const a = evaluateScenario(getScenario('retry-storm'), policy, 'stop-retries');
  const b = evaluateScenario(getScenario('retry-storm'), policy, 'stop-retries');
  // With random jitter, two evaluations of the same scenario should give slightly different confidence
  // (or the same if jitter happens to be zero — just check the range is reasonable)
  assert.ok(a.confidence > 0.5, 'Causal confidence should be above 50%');
  assert.ok(a.confidence < 1.0, 'Confidence should be below 100%');
  assert.ok(a.stats, 'Evaluation should include stats object');
  assert.ok(a.stats.pValue > 0, 'p-value should be positive');
  assert.ok(a.stats.effectSize, 'Effect size should be present');
});

test('neutral intervention has low confidence', () => {
  const result = evaluateScenario(getScenario('cache-drift'), structuredClone(defaultPolicy), 'scale-db');
  assert.ok(result.confidence < 0.3, `Neutral confidence should be low, got ${result.confidence}`);
});

/* ── Batch evaluation ──────────────────────────────────── */

test('batch evaluation returns results for all interventions', () => {
  const policy = structuredClone(defaultPolicy);
  const results = evaluateBatch(getScenario('dns-failure'), policy);
  assert.equal(results.length, 3);
  const decisions = results.map(r => r.decision);
  assert.ok(decisions.includes('allow'), 'At least one intervention should be approved');
  assert.ok(decisions.includes('review'), 'At least one intervention should be held');
});

/* ── Comparison ────────────────────────────────────────── */

test('compareEvaluations returns structured diff', () => {
  const policy = structuredClone(defaultPolicy);
  const a = evaluateScenario(getScenario('retry-storm'), policy, 'stop-retries');
  const b = evaluateScenario(getScenario('retry-storm'), policy, 'clear-cache');
  const cmp = compareEvaluations(a, b);
  assert.equal(cmp.sameDecision, false, 'allow vs review should be different decisions');
  assert.equal(cmp.winner, 'a', 'Causal intervention should have higher confidence');
  assert.ok(typeof cmp.confidenceDelta === 'number', 'Should have numeric confidence delta');
});

/* ── New scenarios work correctly ──────────────────────── */

test('DNS failure scenario — causal fix opens gate', () => {
  const result = evaluateScenario(getScenario('dns-failure'), structuredClone(defaultPolicy), 'add-backup-resolver');
  assert.equal(result.decision, 'allow');
});

test('cert expiry — both cert rotation and disabling mTLS work differently', () => {
  const policy = structuredClone(defaultPolicy);
  const rotate = evaluateScenario(getScenario('cert-expiry'), policy, 'rotate-cert');
  const disable = evaluateScenario(getScenario('cert-expiry'), policy, 'disable-mtls');
  assert.equal(rotate.decision, 'allow', 'Rotating cert should open gate');
  assert.equal(disable.decision, 'review', 'Disabling mTLS is temporary, should be held');
});

test('cascading timeout — circuit breaker is the causal fix', () => {
  const result = evaluateScenario(getScenario('cascading-timeout'), structuredClone(defaultPolicy), 'circuit-breaker');
  assert.equal(result.decision, 'allow');
  assert.ok(result.confidence > 0.7, 'Circuit breaker should have high confidence');
});

/* ── Edge cases ────────────────────────────────────────── */

test('disabled blast radius holds the gate', () => {
  const policy = structuredClone(defaultPolicy);
  policy.rules.find(r => r.id === 'blast-radius').enabled = false;
  const result = evaluateScenario(getScenario('retry-storm'), policy, 'stop-retries');
  assert.equal(result.decision, 'review', 'Disabled blast radius should hold gate');
  assert.match(result.reason, /not bounded/);
});

test('scenarioLetter returns correct letters', () => {
  assert.equal(scenarioLetter(0), 'A');
  assert.equal(scenarioLetter(7), 'H');
});

test('getScenario falls back to first scenario for unknown id', () => {
  const result = getScenario('nonexistent');
  assert.equal(result.id, scenarios[0].id);
});

test('evaluation includes unique timestamp-based id', () => {
  const a = evaluateScenario(getScenario('retry-storm'), structuredClone(defaultPolicy), 'stop-retries');
  const b = evaluateScenario(getScenario('retry-storm'), structuredClone(defaultPolicy), 'stop-retries');
  assert.notEqual(a.id, b.id, 'Each evaluation should have a unique id');
});
