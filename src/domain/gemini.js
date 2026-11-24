/**
 * Gemini AI Integration for Causal Firewall.
 *
 * Connects to Google Gemini 2.5 Flash to automatically diagnose real-world
 * website and application errors, generate testable candidate fixes,
 * produce copy-paste code patches, and audit against hallucinations.
 */

try {
  if (typeof process !== 'undefined' && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch {}

const DEFAULT_API_KEY = (typeof process !== 'undefined' && (process.env?.VITE_GEMINI_API_KEY || process.env?.GEMINI_API_KEY)) || '';
const GEMINI_MODEL = 'gemini-2.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Get active API key (from localStorage, env, or fallback).
 */
export function getApiKey() {
  try {
    const custom = localStorage.getItem('causal-firewall:gemini-api-key');
    if (custom && custom.trim()) return custom.trim();
  } catch {}
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) {
    return import.meta.env.VITE_GEMINI_API_KEY.trim();
  }
  if (typeof process !== 'undefined' && (process.env?.VITE_GEMINI_API_KEY || process.env?.GEMINI_API_KEY)) {
    return (process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY).trim();
  }
  return DEFAULT_API_KEY;
}

/**
 * Save custom API key in browser storage.
 */
export function setApiKey(key) {
  try {
    if (key && key.trim()) {
      localStorage.setItem('causal-firewall:gemini-api-key', key.trim());
    } else {
      localStorage.removeItem('causal-firewall:gemini-api-key');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Test Gemini API connection.
 */
export function testConnection(apiKey = getApiKey()) {
  const url = `${API_BASE}/${GEMINI_MODEL}?key=${apiKey}`;
  const start = performance.now();
  return fetch(url)
    .then(res => {
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) {
        return res.json().then(data => ({
          success: false,
          error: data.error?.message || `HTTP ${res.status}`
        }));
      }
      return res.json().then(data => ({
        success: true,
        model: data.displayName || GEMINI_MODEL,
        latencyMs
      }));
    })
    .catch(err => ({
      success: false,
      error: err.message || 'Network error reaching Gemini API'
    }));
}

/**
 * Auto-diagnose a real incident or error log using Gemini 2.5 Flash.
 *
 * Prompts Gemini to return a clean, structured JSON object containing:
 * - root cause analysis
 * - 3 distinct candidate interventions (causal, temporary, neutral)
 * - signals extracted from the error
 * - ready-to-copy code solution
 * - hallucination risk assessment
 *
 * @param {string} incidentDescription - Plain text error log, stack trace, or problem description
 * @param {string} apiKey - Optional API key
 */
export function diagnoseIncident(incidentDescription, apiKey = getApiKey()) {
  const url = `${API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const systemPrompt = `You are the AI Root Cause Diagnostician for Causal Firewall, an evidence-first remediation gate for websites, webapps, and cloud backends.
Your job is to analyze real errors/incidents reported by web developers and produce a strictly verified, hallucination-free JSON response.

Follow these strict rules:
1. Explain the root cause in plain English suitable for web developers (React, Next.js, Node.js, Express, Python, databases).
2. Generate EXACTLY 3 interventions:
   - One "causal" fix: addresses the actual root cause with high efficacy.
   - One "temporary" fix: a common rookie mistake or restart that only masks the symptom temporarily.
   - One "neutral" fix: an irrelevant guess (e.g., adding CPU/RAM when the database has a dead lock) that wastes money.
3. Provide realistic metric deltas (e.g. "-85%", "-10%", "+1%").
4. Provide a copy-paste ready code patch for the causal fix (e.g., Next.js middleware, Express code, SQL, or config).
5. Provide a brief "antiHallucinationCheck" confirming why the causal fix is safe and what risks were considered.

Return ONLY valid raw JSON with NO markdown code block wrapper, using this exact schema:
{
  "id": "slug-id",
  "label": "Brief descriptive title (under 60 chars)",
  "shortLabel": "2-3 word short name",
  "severity": "critical" or "warning",
  "rootCause": "Clear explanation of why this happened in simple words",
  "signals": [
    { "id": "s1", "label": "Signal name", "value": "Current metric value", "tone": "critical|warning|healthy", "detail": "What it means" },
    { "id": "s2", "label": "Signal name", "value": "Current metric value", "tone": "critical|warning|healthy", "detail": "What it means" }
  ],
  "interventions": [
    {
      "id": "fix-causal-slug",
      "label": "Short Action Name",
      "result": "causal",
      "effect": "Why this fixes the root cause",
      "metric": { "label": "Target metric name", "delta": "-85%", "detail": "Expected shadow cohort improvement" }
    },
    {
      "id": "fix-temporary-slug",
      "label": "Short Action Name",
      "result": "temporary",
      "effect": "Why this only masks the issue temporarily",
      "metric": { "label": "Target metric name", "delta": "-10%", "detail": "Brief relief followed by recurrence" }
    },
    {
      "id": "fix-neutral-slug",
      "label": "Short Action Name",
      "result": "neutral",
      "effect": "Why this guess fails to solve anything",
      "metric": { "label": "Target metric name", "delta": "+0.5%", "detail": "No statistically significant improvement" }
    }
  ],
  "recommendation": "One sentence directive for the on-call engineer",
  "codeFix": "// Complete, runnable code snippet showing the fix",
  "codeFixLang": "javascript|typescript|python|sql|bash",
  "shadowRoutingCode": "// How to route 5% of web traffic to test this fix",
  "antiHallucinationCheck": "Audit confirming safety invariants and absence of hallucinated side-effects."
}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: `${systemPrompt}\n\nHere is the real website / application incident description or error log:\n"${incidentDescription}"` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1, // Low temperature for factual precision
      maxOutputTokens: 8192,
      responseMimeType: 'application/json'
    }
  };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(res => {
      if (!res.ok) {
        return res.json().then(errData => {
          throw new Error(errData.error?.message || `Gemini API returned HTTP ${res.status}`);
        });
      }
      return res.json();
    })
    .then(data => {
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini API returned an empty response.');
      
      // Clean any accidental markdown code fences
      const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(cleaned);

      // Sanitize fields
      parsed.id = parsed.id || `ai-${Date.now()}`;
      parsed.incident = `AI-${Math.floor(1000 + Math.random() * 9000)}`;
      parsed.request = {
        actor: 'ai-diagnostician',
        action: 'evaluate-patch',
        resource: parsed.shortLabel || 'web-app',
        destination: 'production'
      };
      parsed.custom = true;
      parsed.isAIGenerated = true;

      return parsed;
    });
}
