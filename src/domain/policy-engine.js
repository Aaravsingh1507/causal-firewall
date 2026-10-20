const makeNode = (id, type, label, status, detail, next = []) => ({ id, type, label, status, detail, next });

export function evaluateScenario(scenario, policy, interventionId = null) {
  const intervention = scenario.interventions.find(item => item.id === interventionId) || scenario.interventions[2];
  const ruleEnabled = id => policy.rules.find(rule => rule.id === id)?.enabled !== false;
  const causalProofEnabled = ruleEnabled('causal-proof');
  const blastRadiusEnabled = ruleEnabled('blast-radius');
  const auditEvidenceEnabled = ruleEnabled('audit-evidence');
  const causalEvidence = intervention.result === 'causal';
  const result = causalProofEnabled && !causalEvidence || !blastRadiusEnabled ? 'review' : 'allow';
  const confidence = causalEvidence ? 0.87 : intervention.result === 'temporary' ? 0.41 : 0.18;
  const reason = !blastRadiusEnabled
    ? 'The experiment is not bounded to a safe shadow cohort, so the gate remains held.'
    : result === 'allow'
      ? 'The intervention improved the target metric in the shadow cohort.'
      : causalProofEnabled
        ? 'The intervention has not demonstrated a causal improvement yet.'
        : 'Causal proof is disabled, but this decision is being recorded in permissive mode.';
  const metric = intervention.metric || { label: 'target metric', delta: 'unknown', detail: 'No metric evidence was attached to this intervention.' };

  const trace = [
    makeNode('request', 'request', 'Incident request', 'passed', `${scenario.incident} · ${scenario.request.action} on ${scenario.request.resource}`, ['signals']),
    makeNode('signals', 'signals', 'Signals collected', 'matched', `${scenario.signals.length} fixture signals crossed the evaluation boundary`, ['hypothesis']),
    makeNode('hypothesis', 'hypothesis', 'Intervention tested', intervention.result === 'causal' ? 'matched' : 'warning', `${intervention.label} · ${intervention.effect}`, ['metric']),
    makeNode('metric', 'metric', metric.label, causalEvidence ? 'matched' : 'failed', `${metric.delta} · ${metric.detail}`, ['policy']),
    makeNode('policy', 'rule', 'Causal proof rule', causalProofEnabled ? (causalEvidence ? 'matched' : 'failed') : 'bypassed', causalProofEnabled ? (causalEvidence ? 'Causal improvement proven' : 'Causal improvement not proven') : 'Rule bypassed in permissive mode', ['blast-radius']),
    makeNode('blast-radius', 'rule', 'Blast radius rule', blastRadiusEnabled ? 'matched' : 'failed', blastRadiusEnabled ? 'Experiment capped at 5% shadow traffic' : 'No safe shadow-cohort cap is active', ['audit-evidence']),
    makeNode('audit-evidence', 'rule', 'Evidence ledger rule', auditEvidenceEnabled ? 'matched' : 'bypassed', auditEvidenceEnabled ? 'Hypothesis, metric, and outcome will be persisted' : 'Evidence persistence is disabled for this evaluation', ['decision']),
    makeNode('decision', 'decision', result === 'allow' ? 'Gate opened' : 'Gate held', result === 'allow' ? 'allow' : 'review', reason)
  ];

  return {
    id: `eval-${scenario.id}-${intervention.id}`,
    scenarioId: scenario.id,
    interventionId: intervention.id,
    decision: result,
    confidence,
    reason,
    recommendation: scenario.recommendation,
    matchedRuleIds: [
      ...(causalProofEnabled && causalEvidence ? ['causal-proof'] : []),
      ...(blastRadiusEnabled ? ['blast-radius'] : []),
      ...(auditEvidenceEnabled ? ['audit-evidence'] : [])
    ],
    policySnapshot: { causalProofEnabled, blastRadiusEnabled, auditEvidenceEnabled },
    metric,
    trace,
    evaluatedAt: new Date().toISOString(),
    durationMs: 142,
    simulated: true
  };
}

export function summarizeHistory(history) {
  return history.reduce((summary, evaluation) => {
    summary.evaluated += 1;
    if (evaluation.decision === 'allow') summary.approved += 1;
    if (evaluation.decision === 'review') summary.review += 1;
    return summary;
  }, { evaluated: 0, approved: 0, review: 0 });
}
