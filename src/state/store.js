/**
 * Application state store with reactive subscriptions,
 * localStorage persistence, search/filter, settings, and
 * custom scenario management.
 */

import { defaultPolicy, getScenario, scenarios } from '../domain/fixtures.js';
import { evaluateScenario, evaluateBatch, summarizeHistory } from '../domain/policy-engine.js';
import {
  saveHistory, loadHistory,
  loadCustomScenarios, saveCustomScenarios,
  loadPreferences, savePreferences,
  loadSiteAudits, saveSiteAudits
} from '../domain/storage.js';
import { diagnoseIncident, analyzeSiteAuditWithAI, testConnection } from '../domain/gemini.js';
import { auditToCausalScenario } from '../domain/auditor-rules.js';

export function createStore() {
  const persisted  = loadHistory();
  const prefs      = loadPreferences();
  const custom     = loadCustomScenarios();
  const siteAudits = loadSiteAudits();

  const state = {
    /* navigation */
    route: window.location.hash.slice(1) || 'console',

    /* scenario selection */
    scenarioId: scenarios[0].id,
    interventionId: scenarios[0].interventions[0].id,

    /* policy */
    policy: structuredClone(defaultPolicy),

    /* evaluation */
    evaluation: persisted.length ? persisted[0] : null,
    history: persisted,
    isEvaluating: false,
    evalStage: 0,
    evalStageText: '',

    /* trace inspection */
    selectedEvaluationId: persisted.length ? persisted[0].id : null,
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
    mobileNavOpen: false,

    /* AI Incident Doctor */
    aiDiagnosis: null,
    aiLoading: false,
    aiStage: 0,
    aiStageText: '',
    aiError: null,
    geminiStatus: { checked: false, connected: false, model: null, latencyMs: 0 },

    /* Live Site Auditor */
    siteAuditHistory: siteAudits,
    siteAudit: siteAudits[0] || null,
    siteAuditAI: siteAudits[0]?.aiAnalysis || null,
    siteAuditLoading: false,
    siteAuditStage: 0,
    siteAuditStageText: '',
    siteAuditError: null,
    siteAuditTab: 'all',
    siteAuditUrlInput: siteAudits[0]?.inputUrl || '',
    siteAuditBurstChecked: false,

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
      const valid = ['console', 'simulate', 'ai', 'audit', 'trace', 'builder', 'settings'];
      state.route = valid.includes(route) ? route : 'console';
      state.mobileNavOpen = false;
      if (state.route === 'trace' && !state.evaluation && state.history.length > 0) {
        state.evaluation = state.history.find(e => e.id === state.selectedEvaluationId) || state.history[0];
        state.selectedEvaluationId = state.evaluation.id;
      }
      emit();
    },
    toggleMobileNav() {
      state.mobileNavOpen = !state.mobileNavOpen;
      emit();
    },
    closeMobileNav() {
      if (!state.mobileNavOpen) return;
      state.mobileNavOpen = false;
      emit();
    },

    /* scenario / intervention */
    selectScenario(id) {
      const sc = findScenario(id);
      state.scenarioId = sc.id;
      state.interventionId = sc.interventions[0].id;
      // If there is an evaluation in history for this scenario, link to it; otherwise keep latest
      const match = state.history.find(e => e.scenarioId === sc.id);
      if (match) {
        state.evaluation = match;
        state.selectedEvaluationId = match.id;
      }
      state.selectedNodeId = 'decision';
      emit();
    },
    selectIntervention(id) {
      state.interventionId = id;
      const match = state.history.find(e => e.scenarioId === state.scenarioId && e.interventionId === id);
      if (match) {
        state.evaluation = match;
        state.selectedEvaluationId = match.id;
      }
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

    /* Live Site Auditor */
    setSiteAuditUrlInput(val) {
      state.siteAuditUrlInput = val;
    },
    setSiteAuditBurstChecked(checked) {
      state.siteAuditBurstChecked = Boolean(checked);
      emit();
    },
    setSiteAuditTab(tab) {
      state.siteAuditTab = tab || 'all';
      emit();
    },
    selectSiteAudit(auditedAt) {
      const found = state.siteAuditHistory.find(a => a.auditedAt === auditedAt);
      if (!found) return;
      state.siteAudit = found;
      state.siteAuditAI = found.aiAnalysis || null;
      state.siteAuditUrlInput = found.inputUrl;
      state.siteAuditError = null;
      emit();
    },
    clearSiteAudit() {
      state.siteAudit = null;
      state.siteAuditAI = null;
      state.siteAuditError = null;
      state.siteAuditUrlInput = '';
      emit();
    },
    async runSiteAudit(rawUrl, runBurst = false) {
      const trimmed = (rawUrl || '').trim();
      if (!trimmed) {
        showToast('Please paste a website or web app URL.', 'warning');
        return;
      }

      state.siteAuditUrlInput = trimmed;
      state.siteAuditBurstChecked = Boolean(runBurst);
      state.siteAuditLoading = true;
      state.siteAuditError = null;
      state.siteAuditAI = null;
      state.siteAuditStage = 1;
      state.siteAuditStageText = 'Resolving DNS & verifying public SSRF boundary...';
      emit();

      const t1 = setTimeout(() => {
        if (state.siteAuditLoading) {
          state.siteAuditStage = 2;
          state.siteAuditStageText = 'Inspecting HTTP headers, HTTPS redirect & HTML structure...';
          emit();
        }
      }, 450);

      const t2 = setTimeout(() => {
        if (state.siteAuditLoading) {
          state.siteAuditStage = 3;
          state.siteAuditStageText = runBurst
            ? 'Checking JS/CSS bundles & running safe 6x concurrency burst...'
            : 'Checking linked JS/CSS bundles & caching architecture...';
          emit();
        }
      }, 1100);

      try {
        const res = await fetch('/api/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmed, runBurst: Boolean(runBurst) })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `Inspection failed with HTTP ${res.status}`);
        }

        clearTimeout(t1);
        clearTimeout(t2);

        state.siteAuditStage = 4;
        state.siteAuditStageText = 'Synthesizing grounded fixes from measured telemetry...';
        state.siteAudit = data;
        emit();

        // Try AI enrichment grounded strictly in observed data; fall back smoothly if unavailable
        let aiAnalysis = null;
        try {
          aiAnalysis = await analyzeSiteAuditWithAI(data);
        } catch {
          aiAnalysis = null;
        }

        if (aiAnalysis) {
          data.aiAnalysis = aiAnalysis;
        }

        state.siteAudit = data;
        state.siteAuditAI = aiAnalysis;
        state.siteAuditLoading = false;
        state.siteAuditStage = 0;
        state.siteAuditStageText = '';
        state.siteAuditTab = 'all';
        state.siteAuditHistory = [data, ...state.siteAuditHistory.filter(a => a.finalUrl !== data.finalUrl)].slice(0, 10);
        saveSiteAudits(state.siteAuditHistory);
        emit();
        showToast(`Audit complete: Overall Grade ${data.scores.grade} (${data.scores.overall}/100)`, 'success');
        return data;
      } catch (err) {
        clearTimeout(t1);
        clearTimeout(t2);
        state.siteAuditLoading = false;
        state.siteAuditStage = 0;
        state.siteAuditStageText = '';
        state.siteAuditError = err.message || 'Failed to inspect URL.';
        emit();
        showToast(`Audit error: ${state.siteAuditError}`, 'error');
        return null;
      }
    },
    testAuditFixInFirewall() {
      if (!state.siteAudit) return;
      const scenario = auditToCausalScenario(state.siteAudit, state.siteAuditAI);
      state.customScenarios = [...state.customScenarios.filter(s => s.id !== scenario.id), scenario];
      saveCustomScenarios(state.customScenarios);
      state.scenarioId = scenario.id;
      state.interventionId = scenario.interventions[0].id;
      state.selectedNodeId = 'decision';
      state.route = 'trace';
      window.history.replaceState(null, '', '#trace');
      store.evaluate();
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
