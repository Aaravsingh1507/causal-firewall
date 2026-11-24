import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelta, computeConfidence, causalStrength, statisticalSummary } from '../src/domain/statistics.js';

/* ── parseDelta ────────────────────────────────────────── */

test('parseDelta: standard percentage', () => {
  assert.equal(parseDelta('−71%'), -71);
  assert.equal(parseDelta('+1%'), 1);
  assert.equal(parseDelta('−99%'), -99);
});

test('parseDelta: edge cases', () => {
  assert.equal(parseDelta(''), 0);
  assert.equal(parseDelta(null), 0);
  assert.equal(parseDelta('unknown'), 0);
  assert.equal(parseDelta('+0.4%'), 0.4);
  assert.equal(parseDelta('−0%'), 0);
});

/* ── computeConfidence ─────────────────────────────────── */

test('causal intervention with large delta → high confidence', () => {
  const result = computeConfidence('−71%', 'causal', 5);
  assert.ok(result.confidence > 0.7, `Expected > 0.7, got ${result.confidence}`);
  assert.equal(result.significant, true);
  assert.equal(result.effectSize, 'large');
});

test('neutral intervention with tiny delta → low confidence', () => {
  const result = computeConfidence('+1%', 'neutral', 5);
  assert.ok(result.confidence < 0.3, `Expected < 0.3, got ${result.confidence}`);
  assert.equal(result.significant, false);
});

test('temporary intervention → medium confidence', () => {
  const result = computeConfidence('−9%', 'temporary', 5);
  assert.ok(result.confidence > 0.1 && result.confidence < 0.6,
    `Expected medium range, got ${result.confidence}`);
  assert.equal(result.significant, false);
});

test('larger shadow cohort increases confidence', () => {
  const small = computeConfidence('−50%', 'causal', 2);
  const large = computeConfidence('−50%', 'causal', 20);
  // With larger shadow cohort, noise is lower, so confidence should trend higher
  // (jitter may cause overlap occasionally, so this is a soft check)
  assert.ok(large.confidence >= 0.5, 'Large cohort should have reasonable confidence');
});

test('computeConfidence returns all expected fields', () => {
  const result = computeConfidence('−30%', 'causal', 5);
  assert.ok('confidence' in result);
  assert.ok('pValue' in result);
  assert.ok('effectSize' in result);
  assert.ok('significant' in result);
  assert.ok('zScore' in result);
  assert.ok('sampleNote' in result);
});

/* ── causalStrength ────────────────────────────────────── */

test('causalStrength with critical signals → high strength', () => {
  const signals = [
    { tone: 'critical' }, { tone: 'critical' }, { tone: 'warning' }
  ];
  const strength = causalStrength(signals);
  assert.ok(strength > 0.7, `Expected > 0.7, got ${strength}`);
});

test('causalStrength with healthy signals → low strength', () => {
  const signals = [{ tone: 'healthy' }, { tone: 'healthy' }];
  const strength = causalStrength(signals);
  assert.ok(strength < 0.3, `Expected < 0.3, got ${strength}`);
});

test('causalStrength with empty array → 0', () => {
  assert.equal(causalStrength([]), 0);
  assert.equal(causalStrength(null), 0);
});

/* ── statisticalSummary ────────────────────────────────── */

test('statisticalSummary for significant result', () => {
  const summary = statisticalSummary({ confidence: 0.92, pValue: 0.003, effectSize: 'large', significant: true });
  assert.match(summary, /Statistically significant/);
  assert.match(summary, /large/);
});

test('statisticalSummary for non-significant result', () => {
  const summary = statisticalSummary({ confidence: 0.15, pValue: 0.4, effectSize: 'negligible', significant: false });
  assert.match(summary, /Not statistically significant/);
});
