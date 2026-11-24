/**
 * Policy evaluation engine for Causal Firewall.
 *
 * Pure, deterministic evaluation of intervention scenarios against a
 * configurable policy rule set.  Confidence values are now *computed*
 * by the statistics module instead of being hardcoded constants.
 */

import { computeConfidence, causalStrength, statisticalSummary } from './statistics.js';

let evalCounter = 0;

const makeNode = (id, type, label, status, detail, meta = {}, next = []) =>
  ({ id, type, label, status, detail, meta, next });

/* ── Single Evaluation ─────────────────────────────────── */

export function evaluateScenario(scenario, policy, interventionId = null) {
  const intervention =
    scenario.interventions.find(i => i.id === interventionId) || scenario.interventions[0];

  const ruleEnabled = id => policy.rules.find(r => r.id === id)?.enabled !== false;
  const causalProofEnabled  = ruleEnabled('causal-proof');
  const blastRadiusEnabled  = ruleEnabled('blast-radius');
  const auditEvidenceEnabled = ruleEnabled('audit-evidence');

  /* ── Computed confidence (replaces hardcoded 0.87 / 0.41 / 0.18) ── */
  const stats = computeConfidence(
    intervention.metric?.delta || '0%',
    intervention.result,
    policy.shadowSize || 5
  );

  const causalEvidence = intervention.result === 'causal' && stats.significant;
  const signalStrength = causalStrength(scenario.signals);

  const result =
    (causalProofEnabled && !causalEvidence) || !blastRadiusEnabled ? 'review' : 'allow';

  const reason = !blastRadiusEnabled
    ? 'The experiment is not bounded to a safe shadow cohort, so the gate remains held.'
    : result === 'allow'
      ? 'The intervention improved the target metric in the shadow cohort.'
      : causalProofEnabled
        ? 'The intervention has not demonstrated a causal improvement yet.'
        : 'Causal proof is disabled, but this decision is being recorded in permissive mode.';

  const metric = intervention.metric || {
    label: 'target metric', delta: 'unknown',
    detail: 'No metric evidence was attached to this intervention.'
  };

  /* ── Trace ─────────────────────────────────────────── */
  const trace = [
    makeNode('request', 'request', 'Incident request', 'passed',
      `${scenario.incident} · ${scenario.request.action} on ${scenario.request.resource}`,
      { actor: scenario.request.actor }, ['signals']),

    makeNode('signals', 'signals', 'Signals collected', 'matched',
      `${scenario.signals.length} signals crossed the evaluation boundary`,
      { strength: signalStrength }, ['hypothesis']),

    makeNode('hypothesis', 'hypothesis', 'Intervention tested',
      intervention.result === 'causal' ? 'matched' : 'warning',
      `${intervention.label} · ${intervention.effect}`,
      { interventionId: intervention.id }, ['metric']),

    makeNode('metric', 'metric', metric.label,
      causalEvidence ? 'matched' : 'failed',
      `${metric.delta} · ${metric.detail}`,
      { delta: metric.delta, stats: statisticalSummary(stats) }, ['policy']),

    makeNode('policy', 'rule', 'Causal proof rule',
      causalProofEnabled ? (causalEvidence ? 'matched' : 'failed') : 'bypassed',
      causalProofEnabled
        ? (causalEvidence ? 'Causal improvement proven' : 'Causal improvement not proven')
        : 'Rule bypassed in permissive mode',
      { pValue: stats.pValue, effectSize: stats.effectSize }, ['blast-radius']),

    makeNode('blast-radius', 'rule', 'Blast radius rule',
      blastRadiusEnabled ? 'matched' : 'failed',
      blastRadiusEnabled
        ? `Experiment capped at ${policy.shadowSize || 5}% shadow traffic`
        : 'No safe shadow-cohort cap is active',
      {}, ['audit-evidence']),

    makeNode('audit-evidence', 'rule', 'Evidence ledger rule',
      auditEvidenceEnabled ? 'matched' : 'bypassed',
      auditEvidenceEnabled
        ? 'Hypothesis, metric, and outcome will be persisted'
        : 'Evidence persistence is disabled for this evaluation',
      {}, ['decision']),

    makeNode('decision', 'decision',
      result === 'allow' ? 'Gate opened' : 'Gate held',
      result === 'allow' ? 'allow' : 'review', reason,
      { statistical: statisticalSummary(stats) })
  ];

  return {
    id: `eval-${scenario.id}-${intervention.id}-${Date.now()}-${++evalCounter}`,
    scenarioId: scenario.id,
    interventionId: intervention.id,
    decision: result,
    confidence: stats.confidence,
    reason,
    recommendation: scenario.recommendation,
    matchedRuleIds: [
      ...(causalProofEnabled && causalEvidence ? ['causal-proof'] : []),
      ...(blastRadiusEnabled ? ['blast-radius'] : []),
      ...(auditEvidenceEnabled ? ['audit-evidence'] : [])
    ],
    policySnapshot: { causalProofEnabled, blastRadiusEnabled, auditEvidenceEnabled },
    stats,
    metric,
    trace,
    evaluatedAt: new Date().toISOString(),
    durationMs: Math.round(80 + Math.random() * 120),
    simulated: true
  };
}

/* ── Batch Evaluation (all interventions at once) ──────── */

export function evaluateBatch(scenario, policy) {
  return scenario.interventions.map(i => evaluateScenario(scenario, policy, i.id));
}

/* ── Comparison ────────────────────────────────────────── */

export function compareEvaluations(a, b) {
  return {
    a: { id: a.id, intervention: a.interventionId, decision: a.decision, confidence: a.confidence, metric: a.metric },
    b: { id: b.id, intervention: b.interventionId, decision: b.decision, confidence: b.confidence, metric: b.metric },
    confidenceDelta: Math.round((a.confidence - b.confidence) * 100),
    sameDecision: a.decision === b.decision,
    winner: a.confidence > b.confidence ? 'a' : b.confidence > a.confidence ? 'b' : 'tie'
  };
}

/* ── History Summary ───────────────────────────────────── */

export function summarizeHistory(history) {
  return history.reduce((s, e) => {
    s.evaluated += 1;
    if (e.decision === 'allow') s.approved += 1;
    if (e.decision === 'review') s.review += 1;
    return s;
  }, { evaluated: 0, approved: 0, review: 0 });
}
