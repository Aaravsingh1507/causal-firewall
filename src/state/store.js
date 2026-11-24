/**
 * Application state store with reactive subscriptions,
 * localStorage persistence, search/filter, settings, and
 * custom scenario management.
 */

import { defaultPolicy, getScenario, scenarios } from '../domain/fixtures.js';
import { evaluateScenario, evaluateBatch, summarizeHistory } from '../domain/policy-engine.js';
import { saveHistory, loadHistory, loadCustomScenarios, saveCustomScenarios, loadPreferences, savePreferences } from '../domain/storage.js';
import { diagnoseIncident, testConnection } from '../domain/gemini.js';

export function createStore() {
  const persisted = loadHistory();
  const prefs     = loadPreferences();
  const custom    = loadCustomScenarios();

  const state = {
    /* navigation */
    route: window.location.hash.slice(1) || 'console',

    /* scenario selection */
    scenarioId: scenarios[0].id,
    interventionId: scenarios[0].interventions[0].id,

    /* policy */
    policy: structuredClone(defaultPolicy),

    /* evaluation */
    evaluation: null,
    history: persisted,
    isEvaluating: false,
    evalStage: 0,
    evalStageText: '',

    /* trace inspection */
    selectedEvaluationId: null,
    selectedNodeId: 'decision',

    /* search & filter */
    searchQuery: '',
    historyFilter: 'all',   // 'all' | 'allow' | 'review'

    /* comparison */
    compareIds: [],          // [idA, idB]

    /* settings */
    preferences: prefs,

    /* custom scenarios */
    customScenarios: custom,

    /* onboarding */
    showOnboarding: !prefs.onboardingDone,
    showShortcuts: false,

    /* AI Incident Doctor */
    aiDiagnosis: null,
    aiLoading: false,
    aiStage: 0,
    aiStageText: '',
    aiError: null,
    geminiStatus: { checked: false, connected: false, model: null, latencyMs: 0 },

    /* toast */
    toast: null
  };

  const listeners = new Set();
  const emit = () => listeners.forEach(fn => fn(state));

  /* ── persist helpers ─────────────────────────────────── */
  const persistHistory = () => saveHistory(state.history);
  const persistPrefs   = () => savePreferences(state.preferences);

  /* ── toast ───────────────────────────────────────────── */
  let toastTimer = null;
  function showToast(message, type = 'info') {
    clearTimeout(toastTimer);
    state.toast = { message, type };
    emit();
    toastTimer = setTimeout(() => { state.toast = null; emit(); }, 3000);
  }

  /* ── all scenarios (built-in + custom) ───────────────── */
  function allScenarios() {
    return [...scenarios, ...state.customScenarios];
  }

  function findScenario(id) {
    return allScenarios().find(s => s.id === id) || scenarios[0];
  }

  /* ── filtered & searched history ─────────────────────── */
  function filteredHistory() {
    let list = state.history;
    if (state.historyFilter !== 'all') {
      list = list.filter(e => e.decision === state.historyFilter);
    }
    if (state.searchQuery.trim()) {
      const q = state.searchQuery.toLowerCase();
      list = list.filter(e => {
        const sc = findScenario(e.scenarioId);
        return (sc.shortLabel || sc.label || '').toLowerCase().includes(q)
          || (e.interventionId || '').toLowerCase().includes(q)
          || (e.decision || '').toLowerCase().includes(q);
      });
    }
    return list;
  }

  /* ── public API ──────────────────────────────────────── */
  const store = {
    state,
    allScenarios,
    findScenario,
    filteredHistory,

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /* navigation */
    setRoute(route) {
      const valid = ['console', 'simulate', 'ai', 'trace', 'builder', 'settings'];
      state.route = valid.includes(route) ? route : 'console';
      emit();
    },

    /* scenario / intervention */
    selectScenario(id) {
      const sc = findScenario(id);
      state.scenarioId = sc.id;
      state.interventionId = sc.interventions[0].id;
      state.evaluation = null;
      state.selectedEvaluationId = null;
      state.selectedNodeId = 'decision';
      emit();
    },
    selectIntervention(id) {
      state.interventionId = id;
      state.evaluation = null;
      state.selectedEvaluationId = null;
      emit();
    },

    /* trace */
    selectNode(id) { state.selectedNodeId = id; emit(); },
    selectEvaluation(id) {
      const ev = state.history.find(e => e.id === id);
      if (!ev) return;
      state.evaluation = ev;
      state.selectedEvaluationId = ev.id;
      state.scenarioId = ev.scenarioId;
      state.interventionId = ev.interventionId;
      state.selectedNodeId = 'decision';
      state.route = 'trace';
      window.history.replaceState(null, '', '#trace');
      emit();
    },

    /* policy */
    toggleRule(id) {
      const rule = state.policy.rules.find(r => r.id === id);
      if (rule) rule.enabled = !rule.enabled;
      state.evaluation = null;
      state.selectedEvaluationId = null;
      emit();
    },

    /* evaluate */
    evaluate() {
      if (state.isEvaluating) return;
      const scenarioId = state.scenarioId;
      const interventionId = state.interventionId;
      const policySnap = structuredClone(state.policy);
      state.isEvaluating = true;
      state.evalStage = 1;
      state.evalStageText = 'Routing 5% shadow cohort traffic...';
      emit();

      window.setTimeout(() => {
        state.evalStage = 2;
        state.evalStageText = 'Sampling telemetry & computing p-value...';
        emit();
      }, 250);

      window.setTimeout(() => {
        state.evalStage = 3;
        state.evalStageText = 'Verifying causal proof and policy rules...';
        emit();
      }, 500);

      window.setTimeout(() => {
        state.evaluation = evaluateScenario(findScenario(scenarioId), policySnap, interventionId);
        state.history = [state.evaluation, ...state.history];
        state.selectedEvaluationId = state.evaluation.id;
        state.isEvaluating = false;
        state.evalStage = 0;
        state.evalStageText = '';
        state.selectedNodeId = 'decision';
        state.route = 'trace';
        window.history.replaceState(null, '', '#trace');
        persistHistory();
        emit();
        showToast('Evaluation complete — trace ready.', 'success');
      }, 750);
    },

    /* batch evaluate */
    evaluateBatch() {
      if (state.isEvaluating) return;
      state.isEvaluating = true;
      state.evalStage = 1;
      state.evalStageText = 'Simulating shadow traffic for all 3 candidate fixes...';
      emit();

      window.setTimeout(() => {
        state.evalStage = 2;
        state.evalStageText = 'Comparing relative statistical confidence deltas...';
        emit();
      }, 400);

      window.setTimeout(() => {
        const results = evaluateBatch(findScenario(state.scenarioId), structuredClone(state.policy));
        state.history = [...results.reverse(), ...state.history];
        state.evaluation = results[0];
        state.selectedEvaluationId = results[0].id;
        state.isEvaluating = false;
        state.evalStage = 0;
        state.evalStageText = '';
        state.selectedNodeId = 'decision';
        state.route = 'trace';
        window.history.replaceState(null, '', '#trace');
        persistHistory();
        emit();
        showToast(`Batch complete — ${results.length} interventions evaluated.`, 'success');
      }, 850);
    },

    /* search & filter */
    setSearch(q) { state.searchQuery = q; emit(); },
    setFilter(f) { state.historyFilter = f; emit(); },

    /* comparison */
    toggleCompare(id) {
      const idx = state.compareIds.indexOf(id);
      if (idx >= 0) state.compareIds.splice(idx, 1);
      else if (state.compareIds.length < 2) state.compareIds.push(id);
      emit();
    },
    clearCompare() { state.compareIds = []; emit(); },

    /* settings / preferences */
    updatePreferences(partial) {
      Object.assign(state.preferences, partial);
      persistPrefs();
      emit();
    },
    toggleTheme() {
      state.preferences.theme = state.preferences.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.preferences.theme);
      persistPrefs();
      emit();
    },

    /* custom scenarios */
    addCustomScenario(scenario) {
      state.customScenarios = [...state.customScenarios.filter(s => s.id !== scenario.id), scenario];
      saveCustomScenarios(state.customScenarios);
      emit();
      showToast(`Scenario "${scenario.shortLabel || scenario.label}" saved.`, 'success');
    },
    deleteCustomScenario(id) {
      state.customScenarios = state.customScenarios.filter(s => s.id !== id);
      saveCustomScenarios(state.customScenarios);
      emit();
      showToast('Custom scenario deleted.', 'info');
    },

    /* AI Incident Doctor */
    async diagnoseWithAI(promptText) {
      if (!promptText || !promptText.trim()) {
        showToast('Please enter an error log or incident description.', 'warning');
        return;
      }
      state.aiLoading = true;
      state.aiError = null;
      state.aiStage = 1;
      state.aiStageText = 'Parsing error log telemetry and stack traces...';
      emit();

      const stageTimer1 = setTimeout(() => {
        if (state.aiLoading) {
          state.aiStage = 2;
          state.aiStageText = 'Isolating failure domain & extracting symptoms...';
          emit();
        }
      }, 450);

      const stageTimer2 = setTimeout(() => {
        if (state.aiLoading) {
          state.aiStage = 3;
          state.aiStageText = 'Synthesizing hypothesis & verifying anti-hallucination bounds...';
          emit();
        }
      }, 1000);

      const stageTimer3 = setTimeout(() => {
        if (state.aiLoading) {
          state.aiStage = 4;
          state.aiStageText = 'Formulating copy-paste code patches & 5% canary routing...';
          emit();
        }
      }, 1700);

      try {
        const result = await diagnoseIncident(promptText.trim());
        clearTimeout(stageTimer1);
        clearTimeout(stageTimer2);
        clearTimeout(stageTimer3);
        state.aiDiagnosis = result;
        state.aiLoading = false;
        state.aiStage = 0;
        state.aiStageText = '';
        state.customScenarios = [...state.customScenarios.filter(s => s.id !== result.id), result];
        saveCustomScenarios(state.customScenarios);
        state.scenarioId = result.id;
        state.interventionId = result.interventions[0].id;
        emit();
        showToast(`AI diagnosed: "${result.shortLabel}"`, 'success');
        return result;
      } catch (err) {
        clearTimeout(stageTimer1);
        clearTimeout(stageTimer2);
        clearTimeout(stageTimer3);
        state.aiLoading = false;
        state.aiStage = 0;
        state.aiStageText = '';
        state.aiError = err.message || 'AI diagnosis failed';
        emit();
        showToast(`AI Error: ${state.aiError}`, 'error');
        throw err;
      }
    },
    async checkGeminiConnection() {
      const conn = await testConnection();
      state.geminiStatus = { checked: true, connected: conn.success, model: conn.model, latencyMs: conn.latencyMs, error: conn.error };
      emit();
      return conn;
    },
    clearAIDiagnosis() {
      state.aiDiagnosis = null;
      state.aiError = null;
      emit();
    },

    /* onboarding */
    dismissOnboarding() {
      state.showOnboarding = false;
      state.preferences.onboardingDone = true;
      persistPrefs();
      emit();
    },
    showOnboardingModal() { state.showOnboarding = true; emit(); },
    toggleShortcuts() { state.showShortcuts = !state.showShortcuts; emit(); },

    /* history management */
    clearHistory() {
      state.history = [];
      state.evaluation = null;
      state.selectedEvaluationId = null;
      persistHistory();
      emit();
      showToast('History cleared.', 'info');
    },
    deleteEvaluation(id) {
      state.history = state.history.filter(e => e.id !== id);
      if (state.selectedEvaluationId === id) {
        state.evaluation = null;
        state.selectedEvaluationId = null;
      }
      persistHistory();
      emit();
    },

    /* summaries */
    historySummary() { return summarizeHistory(state.history); },

    /* toast (for external callers) */
    showToast
  };

  /* apply saved theme */
  document.documentElement.setAttribute('data-theme', state.preferences.theme);

  /* check Gemini API status in background */
  if (typeof window !== 'undefined') {
    setTimeout(() => { store.checkGeminiConnection().catch(() => {}); }, 200);
  }

  return store;
}
