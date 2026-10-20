import { defaultPolicy, getScenario, scenarios } from '../domain/fixtures.js';
import { evaluateScenario, summarizeHistory } from '../domain/policy-engine.js';

export function createStore() {
  const state = {
    route: window.location.hash.slice(1) || 'console',
    scenarioId: scenarios[0].id,
    interventionId: scenarios[0].interventions[2].id,
    policy: structuredClone(defaultPolicy),
    evaluation: null,
    history: [],
    selectedEvaluationId: null,
    selectedNodeId: 'decision',
    isEvaluating: false
  };
  const listeners = new Set();
  const emit = () => listeners.forEach(listener => listener(state));
  const setRoute = route => { state.route = ['console', 'simulate', 'trace'].includes(route) ? route : 'console'; emit(); };
  return {
    state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setRoute,
    selectScenario(id) { const scenario = getScenario(id); state.scenarioId = scenario.id; state.interventionId = scenario.interventions[2].id; state.evaluation = null; state.selectedEvaluationId = null; state.selectedNodeId = 'decision'; emit(); },
    selectIntervention(id) { state.interventionId = id; state.evaluation = null; state.selectedEvaluationId = null; emit(); },
    selectNode(id) { state.selectedNodeId = id; emit(); },
    selectEvaluation(id) {
      const evaluation = state.history.find(item => item.id === id);
      if (!evaluation) return;
      state.evaluation = evaluation;
      state.selectedEvaluationId = evaluation.id;
      state.scenarioId = evaluation.scenarioId;
      state.interventionId = evaluation.interventionId;
      state.selectedNodeId = 'decision';
      state.route = 'trace';
      window.history.replaceState(null, '', '#trace');
      emit();
    },
    toggleRule(id) { const rule = state.policy.rules.find(item => item.id === id); if (rule) rule.enabled = !rule.enabled; state.evaluation = null; state.selectedEvaluationId = null; emit(); },
    evaluate() {
      if (state.isEvaluating) return;
      const scenarioId = state.scenarioId;
      const interventionId = state.interventionId;
      const policySnapshot = structuredClone(state.policy);
      state.isEvaluating = true; emit();
      window.setTimeout(() => {
        state.evaluation = evaluateScenario(getScenario(scenarioId), policySnapshot, interventionId);
        state.history = [state.evaluation, ...state.history].slice(0, 8);
        state.selectedEvaluationId = state.evaluation.id;
        state.isEvaluating = false;
        state.selectedNodeId = 'decision';
        state.route = 'trace';
        window.history.replaceState(null, '', '#trace');
        emit();
      }, 520);
    },
    historySummary() { return summarizeHistory(state.history); }
  };
}
