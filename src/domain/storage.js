/**
 * Persistent storage layer for Causal Firewall.
 * Uses localStorage for browser-local persistence with
 * JSON/CSV export and scenario import capabilities.
 */

const PREFIX = 'causal-firewall';
const KEYS = {
  HISTORY: `${PREFIX}:history`,
  CUSTOM_SCENARIOS: `${PREFIX}:custom-scenarios`,
  PREFERENCES: `${PREFIX}:preferences`,
  SITE_AUDITS: `${PREFIX}:site-audits`
};

/* ── helpers ───────────────────────────────────────────── */

function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── history ───────────────────────────────────────────── */

export function saveHistory(history) { return safeSet(KEYS.HISTORY, history); }
export function loadHistory() { return safeGet(KEYS.HISTORY, []); }

/* ── custom scenarios ──────────────────────────────────── */

export function saveCustomScenarios(list) { return safeSet(KEYS.CUSTOM_SCENARIOS, list); }
export function loadCustomScenarios() { return safeGet(KEYS.CUSTOM_SCENARIOS, []); }

/* ── site audits ───────────────────────────────────────── */

export function saveSiteAudits(list) { return safeSet(KEYS.SITE_AUDITS, (list || []).slice(0, 10)); }
export function loadSiteAudits() { return safeGet(KEYS.SITE_AUDITS, []); }

/* ── preferences ───────────────────────────────────────── */

const DEFAULT_PREFS = {
  theme: 'dark',
  onboardingDone: false,
  notificationsEnabled: false,
  defaultShadowSize: 5
};

export function savePreferences(prefs) { return safeSet(KEYS.PREFERENCES, prefs); }
export function loadPreferences() { return safeGet(KEYS.PREFERENCES, { ...DEFAULT_PREFS }); }

/* ── export ────────────────────────────────────────────── */

export function exportAsJSON(data, filename = 'causal-firewall-export.json') {
  downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
}

export function exportAsCSV(evaluations, filename = 'causal-firewall-decisions.csv') {
  const headers = ['ID', 'Scenario', 'Intervention', 'Decision', 'Confidence', 'Reason', 'Evaluated At'];
  const rows = evaluations.map(e => [
    e.id,
    e.scenarioId,
    e.interventionId,
    e.decision,
    e.confidence,
    `"${(e.reason || '').replace(/"/g, '""')}"`,
    e.evaluatedAt
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadFile(csv, filename, 'text/csv');
}

/* ── import ────────────────────────────────────────────── */

export function importScenarios(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!Array.isArray(data)) return { success: false, error: 'Expected an array of scenarios.' };
    for (const s of data) {
      if (!s.id || !s.label || !s.interventions) {
        return { success: false, error: `Scenario "${s.id || 'unknown'}" is missing required fields (id, label, interventions).` };
      }
    }
    const existing = loadCustomScenarios();
    const merged = [...existing.filter(e => !data.find(d => d.id === e.id)), ...data];
    saveCustomScenarios(merged);
    return { success: true, count: data.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* ── danger zone ───────────────────────────────────────── */

export function clearAllData() {
  Object.values(KEYS).forEach(key => localStorage.removeItem(key));
}
