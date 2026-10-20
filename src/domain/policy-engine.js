const makeNode = (id, type, label, status, detail, next = []) => ({ id, type, label, status, detail, next });

export function evaluateScenario(scenario, policy, interventionId = null) {
  const intervention = scenario.interventions.find(item => item.id === interventionId) || scenario.interventions[2];
  const causalProofEnabled = policy.rules.find(rule => rule.id === 'causal-proof')?.enabled !== false;
  const result = causalProofEnabled && intervention.result !== 'causal' ? 'review' : 'allow';
  const confidence = intervention.result === 'causal' ? 0.87 : intervention.result === 'temporary' ? 0.41 : 0.18;
  const reason = result === 'allow'
    ? 'The intervention improved the target metric in the shadow cohort.'
    : 'The intervention has not demonstrated a causal improvement yet.';

  const trace = [
    makeNode('request', 'request', 'Incident request', 'passed', `${scenario.incident} · ${scenario.request.action} on ${scenario.request.resource}`, ['signals']),
    makeNode('signals', 'signals', 'Signals collected', 'matched', `${scenario.signals.length} live signals crossed the evaluation boundary`, ['hypothesis']),
    makeNode('hypothesis', 'hypothesis', 'Intervention tested', intervention.result === 'causal' ? 'matched' : 'warning', `${intervention.label} · ${intervention.effect}`, ['metric']),
    makeNode('metric', 'metric', 'Metric delta', intervention.result === 'causal' ? 'matched' : 'failed', intervention.result === 'causal' ? 'p95 latency −71% · queue growth stopped' : 'No reliable improvement observed in the shadow cohort', ['policy']),
    makeNode('policy', 'rule', 'Causal proof rule', causalProofEnabled ? 'matched' : 'bypassed', causalProofEnabled ? 'Require causal improvement is active' : 'Rule bypassed in permissive mode', ['decision']),
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
    matchedRuleIds: causalProofEnabled ? ['causal-proof', 'blast-radius', 'audit-evidence'] : [],
    trace,
    evaluatedAt: new Date().toISOString(),
    durationMs: 142
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
