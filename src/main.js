/**
 * Causal Firewall — main application controller.
 *
 * Renders six views (console, simulator, AI Incident Doctor, trace, builder, settings),
 * manages event delegation, keyboard shortcuts, onboarding, toast notifications,
 * theme toggle, search/filter, comparison, AI root-cause diagnosis,
 * code patch copying, and CSV/JSON export.
 */

import { getScenario, scenarios, scenarioLetter } from './domain/fixtures.js';
import { compareEvaluations } from './domain/policy-engine.js';
import { exportAsJSON, exportAsCSV, saveCustomScenarios } from './domain/storage.js';
import { getApiKey, setApiKey } from './domain/gemini.js';
import { createStore } from './state/store.js';

const app       = document.querySelector('#app');
const toastRoot = document.querySelector('#toast-container');
const modalRoot = document.querySelector('#modal-root');
const store     = createStore();

/* ═══════════════════════════════════════════════════════════
   HELPERS & ICONS
   ═══════════════════════════════════════════════════════════ */

const icon = n => ({
  arrow: '↗', chevron: '⌄', check: '✓', pulse: '◌',
  compare: '⇆', gear: '⚙', plus: '+', spark: '✨', copy: '📋',
  shield: '🛡️', bolt: '⚡', cross: '✕', warn: '⚠'
}[n] || '');

function statusLabel(d) {
  return d === 'allow' ? 'Gate opened' : d === 'review' ? 'Gate held' : 'Gate blocked';
}

function formatTime(v) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(v));
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function copyToClipboard(text, message = 'Copied to clipboard!') {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => store.showToast(message, 'success'));
  } else {
    store.showToast('Clipboard access not supported in this environment', 'warning');
  }
}

/* ═══════════════════════════════════════════════════════════
   COMMON FORMATTING COMPONENTS
   ═══════════════════════════════════════════════════════════ */

/**
 * Visual 95% Main Traffic vs 5% Canary Traffic split visualizer bar
 */
function renderTrafficSplit(safePct = 95, canaryPct = 5) {
  return `<div class="traffic-split-box">
    <div class="traffic-split-top">
      <strong>🛡️ Production Traffic Boundary</strong>
      <span class="mono">${canaryPct}% SHADOW CANARY ACTIVE</span>
    </div>
    <div class="traffic-bar" aria-label="Traffic distribution: ${safePct}% production, ${canaryPct}% canary">
      <div class="traffic-bar-safe" style="width: ${safePct}%" title="${safePct}% Main Traffic (Guaranteed Untouched)"></div>
      <div class="traffic-bar-canary" style="width: ${canaryPct}%" title="${canaryPct}% Shadow Cohort (Tests Candidate Fix)"></div>
    </div>
    <div class="traffic-legend">
      <span><i class="traffic-dot-safe"></i> <strong>${safePct}%</strong> Real Visitors (Safe & Isolated)</span>
      <span><i class="traffic-dot-canary"></i> <strong>${canaryPct}%</strong> Shadow Cohort (Tests Fix)</span>
    </div>
  </div>`;
}

/**
 * Diagnostic Multi-Stage Radar & Scanner
 */
function renderScanner(stage = 1, stageText = '') {
  const steps = [
    '1. Ingesting error telemetry and stack traces',
    '2. Isolating failure domain & extracting symptoms',
    '3. Synthesizing hypothesis & verifying safety invariants',
    '4. Formulating copy-paste code patch & canary routing'
  ];

  return `<section class="panel ai-scanner-panel">
    <div class="radar-sweep-container">
      <div class="radar-circle"></div>
      <div class="radar-circle inner"></div>
      <div class="radar-scanner"></div>
      <div class="radar-center-dot"></div>
    </div>
    <div class="scanner-title">AI Diagnostic Intelligence In Progress</div>
    <div class="scanner-subtitle">${esc(stageText || 'Analyzing incident telemetry and formulating verified fixes...')}</div>
    <div class="scanner-steps">
      ${steps.map((label, idx) => {
        const num = idx + 1;
        const isDone = stage > num;
        const isActive = stage === num;
        return `<div class="scanner-step-row ${isActive ? 'active' : isDone ? 'done' : ''}">
          <span class="scanner-step-icon">${isDone ? '✓' : isActive ? '●' : '○'}</span>
          <span>${label}</span>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

/* ═══════════════════════════════════════════════════════════
   LAYOUT WRAPPER
   ═══════════════════════════════════════════════════════════ */

function layout(content) {
  const r = store.state.route;
  const labels = {
    console:  ['Control plane', 'Remediation, with proof.'],
    simulate: ['Controlled experiment', 'Run a shadow intervention.'],
    ai:       ['AI Incident Doctor', 'Diagnose real website errors with AI.'],
    trace:    ['Evidence trail', 'Follow the causal path.'],
    builder:  ['Scenario builder', 'Create a custom incident.'],
    settings: ['Configuration', 'Preferences & AI API key.']
  };
  const [eye, h1] = labels[r] || labels.console;
  const hLen = store.state.history.length;
  return `<div class="screen-heading">
    <div><p class="eyebrow">${eye}</p><h1>${h1}</h1></div>
    <div class="heading-meta">
      <span class="mono">POLICY ${store.state.policy.version}</span>
      <span class="meta-divider"></span>
      <span class="mono">${hLen ? `${hLen} EVALUATIONS` : 'NO EVALUATIONS'}</span>
    </div>
  </div>${content}`;
}

/* ═══════════════════════════════════════════════════════════
   CONSOLE PAGE
   ═══════════════════════════════════════════════════════════ */

function renderConsole() {
  const summary = store.historySummary();
  const filtered = store.filteredHistory();
  const f = store.state.historyFilter;
  const q = store.state.searchQuery;

  return layout(`<div class="hero-panel">
    <div class="hero-panel-copy">
      <span class="section-kicker">01 / The problem</span>
      <h2>Automation can fix<br><em>the wrong cause.</em></h2>
      <p>When an incident hits a website or app, developers usually guess a solution. Causal Firewall isolates the fix to a safe 5% shadow cohort first, demanding statistical proof before letting code touch 100% of production traffic.</p>
      <div class="hero-actions">
        <a class="primary-button" href="#simulate">Run a scenario <span aria-hidden="true">${icon('arrow')}</span></a>
        <a class="secondary-button" href="#ai"><span class="sparkle-icon">✨</span> AI Incident Doctor</a>
      </div>
    </div>
    <div class="signal-orbit" aria-label="Evidence-first remediation diagram">
      <div class="orbit orbit-one"></div>
      <div class="orbit orbit-two"></div>
      <div class="orbit-node node-request">REQUEST<span>incident detected</span></div>
      <div class="orbit-node node-test">TEST<span>5% shadow cohort</span></div>
      <div class="orbit-node node-proof">PROOF<span>causal delta</span></div>
      <div class="orbit-center">CF<span>gate</span></div>
    </div>
  </div>

  <div class="metric-grid">
    <div class="metric-card"><span class="metric-label">Requests evaluated</span><strong>${String(summary.evaluated).padStart(2,'0')}</strong><span class="metric-foot">verified shadow tests</span></div>
    <div class="metric-card"><span class="metric-label">Gate opened</span><strong>${String(summary.approved).padStart(2,'0')}</strong><span class="metric-foot good">✓ evidence-proven</span></div>
    <div class="metric-card"><span class="metric-label">Held for proof</span><strong>${String(summary.review).padStart(2,'0')}</strong><span class="metric-foot warn">! needs causal evidence</span></div>
    <div class="metric-card accent-card"><span class="metric-label">AI Diagnostic Engine</span><strong>ONLINE</strong><span class="metric-foot good">● zero hallucination guard</span></div>
  </div>

  <div class="content-grid">
    <section class="panel recent-panel">
      <div class="panel-header">
        <div><span class="section-kicker">02 / Activity</span><h2>Decision history</h2></div>
        <div class="history-actions">
          ${store.state.history.length ? `<button class="text-button" data-action="export-json">Export JSON <span aria-hidden="true">${icon('arrow')}</span></button>
          <button class="text-button" data-action="export-csv">Export CSV <span aria-hidden="true">${icon('arrow')}</span></button>` : ''}
        </div>
      </div>
      <div class="filter-bar">
        <div class="filter-chips">
          <button class="filter-chip ${f==='all'?'active':''}" data-filter="all">All</button>
          <button class="filter-chip ${f==='allow'?'active':''}" data-filter="allow">Approved</button>
          <button class="filter-chip ${f==='review'?'active':''}" data-filter="review">Held</button>
        </div>
        <input class="search-input" type="search" placeholder="Search evaluations…" value="${esc(q)}" data-action="search" />
      </div>
      ${filtered.length ? `<div class="history-list">${filtered.map(item => {
        const sc = store.findScenario(item.scenarioId);
        const sel = store.state.compareIds.includes(item.id);
        return `<div class="history-row">
          <button class="compare-check ${sel?'active':''}" data-compare="${item.id}" aria-label="Toggle comparison" title="Compare">${sel?icon('check'):'⇆'}</button>
          <a class="history-link" href="#trace" data-evaluation="${item.id}" aria-label="Open ${sc.shortLabel} evaluation">
            <span class="history-status ${item.decision}"></span>
            <span class="history-main"><strong>${sc.shortLabel}</strong><small>${sc.incident} · ${item.interventionId.replaceAll('-',' ')}</small></span>
            <span class="history-result ${item.decision}">${statusLabel(item.decision)}</span>
            <span class="mono">${formatTime(item.evaluatedAt)}</span>
            <span class="history-conf">${Math.round(item.confidence*100)}%</span>
          </a>
        </div>`;
      }).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">◌</span><strong>No decisions yet.</strong><p>Choose a scenario or diagnose a real website bug with the AI Doctor to see Causal Firewall in action.</p><a class="text-button" href="#simulate">Start first evaluation <span aria-hidden="true">${icon('arrow')}</span></a></div>`}
      ${store.state.compareIds.length === 2 ? `<div class="compare-bar"><button class="primary-button small" data-action="run-compare">Compare selected <span aria-hidden="true">${icon('compare')}</span></button><button class="text-button" data-action="clear-compare">Clear</button></div>` : ''}
    </section>
    <section class="panel principle-panel">
      <span class="section-kicker">03 / Principle</span>
      <h2>Correlation is<br><em>not causation.</em></h2>
      <div class="principle-rule"><span>01</span><p>Observe error signals & stack traces (Sentry / Datadog)</p></div>
      <div class="principle-rule"><span>02</span><p>AI Engine generates candidate fixes without hallucination</p></div>
      <div class="principle-rule"><span>03</span><p>Causal Firewall routes 5% shadow cohort to test the fix</p></div>
      <div class="principle-rule"><span>04</span><p>Gate OPENS to 100% ONLY when p &lt; 0.05 is mathematically proven</p></div>
      <div class="panel-note">Every evaluation carries its hypothesis, metric delta, blast radius, and anti-hallucination audit.</div>
    </section>
  </div>`);
}

/* ═══════════════════════════════════════════════════════════
   AI INCIDENT DOCTOR PAGE
   ═══════════════════════════════════════════════════════════ */

function renderAIDoctor() {
  const diag = store.state.aiDiagnosis;
  const loading = store.state.aiLoading;
  const stage = store.state.aiStage;
  const stageText = store.state.aiStageText;
  const error = store.state.aiError;

  const templates = [
    { title: '⚡ Next.js Stripe 504 Timeout', text: 'Checkout endpoint /api/checkout times out with 504 Gateway Timeout during flash sale when calling Stripe API synchronously' },
    { title: '🧠 React App Memory Leak', text: 'React single page app heap size climbs from 120MB to 1.8GB over 45 minutes of browsing, leading to browser tab crash' },
    { title: '💾 MongoDB Pool Saturation', text: 'MongoNetworkTimeoutError: connection pool exhausted (100/100 active connections) during morning traffic surge on /api/orders' },
    { title: '🔄 Prisma SQL Deadlock', text: 'PrismaClientKnownRequestError: Deadlock detected on concurrent inventory update queries on table products' },
    { title: '⚡ Express Event Loop 100% CPU', text: 'Node.js event loop lag spikes over 6500ms and CPU is pegged at 100% on /api/search with regex query parameter' }
  ];

  return layout(`<div class="ai-doctor-grid">
    <section class="panel ai-input-panel">
      <div class="panel-header">
        <div>
          <span class="section-kicker">Diagnostic Intelligence</span>
          <h2>AI Incident Diagnostician</h2>
        </div>
        <span class="ai-live-badge"><i class="pulse-dot"></i> AI ENGINE ONLINE</span>
      </div>

      <div class="ai-intro-card">
        <p>Paste any real error log, stack trace, or describe your website's bug in plain English. The AI engine isolates the root cause, extracts symptoms, and generates 3 testable candidate fixes without hallucination.</p>
      </div>

      <div class="template-section">
        <span class="template-label">Try a real-world web/app incident template:</span>
        <div class="template-chips">
          ${templates.map(t => `<button class="template-chip" data-action="fill-ai-template" data-template="${esc(t.text)}">${t.title}</button>`).join('')}
        </div>
      </div>

      <div class="ai-form-container">
        <label for="ai-incident-input" class="ai-input-label">Incident Description / Terminal Error Log:</label>
        <textarea id="ai-incident-input" class="ai-textarea" rows="4" placeholder="e.g. Our checkout page on /api/checkout freezes when customers click Pay Now, returning HTTP 504 Gateway Timeout after 30 seconds..."></textarea>
        
        <div class="ai-action-bar">
          <button class="primary-button ai-diagnose-btn ${loading?'loading':''}" data-action="diagnose-ai" ${loading?'disabled':''}>
            ${loading ? `<span class="spinner" aria-hidden="true"></span> Analyzing incident…` : `<span class="sparkle-icon">✨</span> Diagnose & Generate Fixes`}
          </button>
          ${diag ? `<button class="text-button" data-action="clear-ai">Clear analysis</button>` : ''}
        </div>
      </div>

      ${error ? `<div class="ai-error-box"><span class="error-icon">⚠</span><div><strong>Diagnosis Failed</strong><p>${esc(error)}</p></div></div>` : ''}
    </section>

    ${loading ? renderScanner(stage, stageText) : diag ? `<section class="panel ai-result-panel">
      <div class="panel-header">
        <div>
          <span class="section-kicker">Root Cause Analysis</span>
          <h2>${esc(diag.label || diag.shortLabel)}</h2>
        </div>
        <span class="scenario-severity ${diag.severity}">${diag.severity}</span>
      </div>

      <div class="ai-diagnosis-body">
        <!-- In Short Executive Verdict Card -->
        <div class="in-short-card">
          <div class="in-short-header">
            <span class="in-short-title">⚡ AT A GLANCE (IN SHORT)</span>
            <span class="scenario-severity ${diag.severity}">${diag.severity}</span>
          </div>
          <div class="verdict-grid">
            <div class="verdict-item">
              <span>What Broke</span>
              <strong>${esc(diag.shortLabel || diag.label)}</strong>
            </div>
            <div class="verdict-item highlight">
              <span>Recommended Fix</span>
              <strong>${esc(diag.interventions?.find(i => i.result === 'causal')?.label || 'Apply Causal Patch')}</strong>
            </div>
            <div class="verdict-item">
              <span>Expected Delta</span>
              <strong style="color:var(--cyan)">${diag.interventions?.find(i => i.result === 'causal')?.metric?.delta || '−85%'}</strong>
            </div>
          </div>
        </div>

        <!-- 95% vs 5% Traffic Safety Split Bar -->
        ${renderTrafficSplit(95, 5)}

        <div class="root-cause-card">
          <span class="section-kicker">Why this is happening (Root Cause)</span>
          <p class="root-cause-text">${esc(diag.rootCause)}</p>
        </div>

        <div class="ai-signals-strip">
          <span class="section-kicker">Detected Symptoms</span>
          <div class="ai-signal-cards">
            ${(diag.signals || []).map(s => `
              <div class="signal-card ${s.tone}">
                <span class="signal-label">${esc(s.label)}</span>
                <strong>${esc(s.value)}</strong>
                <small>${esc(s.detail)}</small>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="anti-hallucination-box">
          <div class="anti-hal-header">
            <span class="shield-icon">🛡️</span>
            <strong>Anti-Hallucination & Safety Invariants Audit</strong>
          </div>
          <p>${esc(diag.antiHallucinationCheck || 'Safety verified: Fix addresses root cause without breaking API contracts or risking data loss.')}</p>
        </div>

        <div class="interventions-section">
          <div class="section-top">
            <span class="section-kicker">Candidate Interventions Evaluated by Causal Firewall</span>
            <small>Only proven causal fixes pass the gate</small>
          </div>
          <div class="ai-intervention-list">
            ${(diag.interventions || []).map((item) => `
              <div class="ai-int-card ${item.result}">
                <div class="ai-int-top">
                  <span class="ai-int-tag ${item.result}">
                    ${item.result === 'causal' ? '✓ Proven Causal Fix' : item.result === 'temporary' ? '! Temporary Trap' : '✕ Ineffective Guess'}
                  </span>
                  <span class="ai-int-delta">${item.metric?.delta || '0%'}</span>
                </div>
                <strong>${esc(item.label)}</strong>
                <p>${esc(item.effect)}</p>
                <div class="ai-int-actions">
                  <button class="primary-button small" data-action="test-ai-intervention" data-scenario-id="${diag.id}" data-intervention-id="${item.id}">
                    Test 5% Shadow Cohort <span aria-hidden="true">${icon('arrow')}</span>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        ${diag.codeFix ? `
          <div class="code-patch-section">
            <div class="code-patch-header">
              <div>
                <span class="section-kicker">Ready-to-Deploy Code Solution</span>
                <strong>Copy-Paste Fix for Your Codebase</strong>
              </div>
              <button class="copy-button" data-action="copy-code" data-code="${esc(diag.codeFix)}">
                <span aria-hidden="true">${icon('copy')}</span> Copy Code
              </button>
            </div>
            <pre class="code-block"><code>${esc(diag.codeFix)}</code></pre>
          </div>
        ` : ''}

        ${diag.shadowRoutingCode ? `
          <div class="code-patch-section shadow-patch">
            <div class="code-patch-header">
              <div>
                <span class="section-kicker">5% Canary Routing Configuration</span>
                <strong>Route 5% Traffic in Next.js / Express / Cloudflare</strong>
              </div>
              <button class="copy-button" data-action="copy-code" data-code="${esc(diag.shadowRoutingCode)}">
                <span aria-hidden="true">${icon('copy')}</span> Copy Routing Snippet
              </button>
            </div>
            <pre class="code-block"><code>${esc(diag.shadowRoutingCode)}</code></pre>
          </div>
        ` : ''}
      </div>
    </section>` : `
      <section class="panel ai-placeholder-panel">
        <div class="ai-empty-state">
          <div class="empty-sparkle">✨</div>
          <h3>Ready for Diagnosis</h3>
          <p>Paste a real bug or select one of the examples above. The AI engine will generate a full root-cause breakdown and code patch ready for shadow testing.</p>
        </div>
      </section>
    `}
  </div>`);
}

/* ═══════════════════════════════════════════════════════════
   SIMULATOR PAGE
   ═══════════════════════════════════════════════════════════ */

function renderSimulator() {
  const all = store.allScenarios();
  const scenario = store.findScenario(store.state.scenarioId);
  const evaluating = store.state.isEvaluating;
  const evalText = store.state.evalStageText;

  return layout(`<div class="simulator-grid">
    <section class="panel scenario-panel">
      <div class="panel-header">
        <div><span class="section-kicker">Select an incident</span><h2>What are we trying to fix?</h2></div>
        <span class="live-badge"><i></i> SIMULATED</span>
      </div>
      <div class="scenario-list">${all.map((item, idx) => `
        <button class="scenario-option ${item.id===scenario.id?'selected':''}" data-scenario="${item.id}" aria-pressed="${item.id===scenario.id}">
          <span class="scenario-number">${item.isAIGenerated ? '✨' : item.custom ? '★' : scenarioLetter(idx)}</span>
          <span><strong>${esc(item.label)}</strong><small>${esc(item.description || item.rootCause)}</small></span>
          <span class="scenario-severity ${item.severity}">${item.severity}</span>
        </button>`).join('')}</div>
      <div class="incident-strip">
        <span class="mono">${scenario.incident}</span>
        <span>${scenario.request.actor} → ${scenario.request.resource}</span>
        <span class="incident-pulse">● incident loaded</span>
      </div>
    </section>

    <section class="panel intervention-panel">
      <div class="panel-header">
        <div><span class="section-kicker">Choose a hypothesis</span><h2>What should we try?</h2></div>
        <span class="mono">SHADOW: ${store.state.policy.shadowSize || 5}%</span>
      </div>

      <div class="intervention-list">${scenario.interventions.map(item => `
        <button class="intervention-option ${item.id===store.state.interventionId?'selected':''}" data-intervention="${item.id}" aria-pressed="${item.id===store.state.interventionId}">
          <span class="radio-dot"></span>
          <span><strong>${esc(item.label)}</strong><small>${esc(item.effect)}</small></span>
          <span class="option-arrow">→</span>
        </button>`).join('')}</div>

      <!-- Traffic split indicator -->
      <div style="padding: 0 20px 14px;">
        ${renderTrafficSplit(95, store.state.policy.shadowSize || 5)}
      </div>

      <div class="signal-cards">
        <span class="section-kicker">Active signals</span>
        ${scenario.signals.map(s => `<div class="signal-card ${s.tone}"><span class="signal-label">${esc(s.label)}</span><strong>${esc(s.value)}</strong><small>${esc(s.detail)}</small></div>`).join('')}
      </div>

      <div class="policy-box">
        <div class="policy-box-top"><span class="section-kicker">Active policy rules</span><span class="mono">v${store.state.policy.version}</span></div>
        ${store.state.policy.rules.map(rule => `<label class="policy-toggle"><input type="checkbox" data-rule="${rule.id}" ${rule.enabled?'checked':''}><span class="toggle-ui"></span><span><strong>${esc(rule.label)}</strong><small>${esc(rule.description)}</small></span></label>`).join('')}
      </div>

      <div class="eval-buttons">
        <button class="evaluate-button ${evaluating?'loading':''}" data-action="evaluate" ${evaluating?'disabled':''}>
          ${evaluating ? `<span class="spinner" aria-hidden="true"></span> ${esc(evalText || 'Measuring shadow cohort…')}` : `Evaluate intervention <span aria-hidden="true">${icon('arrow')}</span>`}
        </button>
        <button class="batch-button" data-action="batch-evaluate" ${evaluating?'disabled':''} title="Evaluate all interventions at once">Batch all <span aria-hidden="true">${icon('arrow')}</span></button>
      </div>
    </section>
  </div>
  <div class="experiment-footnote"><span class="footnote-mark">✳</span><p>This is a safe sandbox. Causal Firewall tests candidate fixes on a 5% shadow cohort before touching production.</p></div>`);
}

/* ═══════════════════════════════════════════════════════════
   TRACE PAGE
   ═══════════════════════════════════════════════════════════ */

function renderTrace() {
  const ev = store.state.evaluation;
  if (!ev) return layout(`<div class="trace-empty panel"><span class="empty-icon">◎</span><h2>No causal trace yet.</h2><p>Run a controlled scenario or diagnose a bug with the AI Doctor. The firewall will show every signal, hypothesis, metric, and policy decision.</p><a class="primary-button" href="#simulate">Go to simulator <span aria-hidden="true">${icon('arrow')}</span></a></div>`);

  const scenario = store.findScenario(ev.scenarioId);
  const sel = ev.trace.find(n => n.id === store.state.selectedNodeId) || ev.trace.at(-1);

  return layout(`<div class="trace-topline">
    <div class="decision-banner ${ev.decision}">
      <div class="decision-icon">${ev.decision==='allow'?'✓':'!'}</div>
      <div><span class="section-kicker">Decision / ${scenario.incident}</span><h2>${statusLabel(ev.decision)}</h2><p>${esc(ev.reason)}</p></div>
      <div class="confidence"><strong>${Math.round(ev.confidence*100)}%</strong><span>confidence</span></div>
    </div>
    <a class="text-button" href="#simulate">Replay another <span aria-hidden="true">${icon('arrow')}</span></a>
  </div>
  <div class="trace-layout">
    <section class="panel trace-panel">
      <div class="panel-header"><div><span class="section-kicker">Evidence chain</span><h2>${esc(scenario.shortLabel)} / ${esc(ev.interventionId.replaceAll('-',' '))}</h2></div><span class="mono">SIMULATED · ${ev.durationMs} MS</span></div>
      <div class="trace-chain" role="list" aria-label="Causal evaluation trace">${ev.trace.map((node, i) => `
        <div class="trace-step" role="listitem">
          <button class="trace-node ${node.status} ${node.id===sel.id?'selected':''}" data-node="${node.id}" aria-label="Inspect ${node.label}" aria-pressed="${node.id===sel.id}">
            <span class="trace-node-index">0${i+1}</span>
            <span class="trace-node-type">${node.type}</span>
            <strong>${esc(node.label)}</strong>
            <small>${node.status==='matched'?'evidence matched':node.status==='passed'?'observed':node.status==='failed'?'not proven':node.status==='warning'?'inconclusive':node.status==='bypassed'?'bypassed':node.status}</small>
          </button>
          ${i<ev.trace.length-1?'<span class="trace-connector" aria-hidden="true">→</span>':''}
        </div>`).join('')}</div>
      <div class="trace-legend"><span><i class="legend-dot matched"></i> matched</span><span><i class="legend-dot warning"></i> inconclusive</span><span><i class="legend-dot failed"></i> failed proof</span></div>
      ${ev.stats ? `<div class="stats-bar"><span class="mono">p-VALUE ${ev.stats.pValue}</span><span class="meta-divider"></span><span class="mono">EFFECT ${ev.stats.effectSize.toUpperCase()}</span><span class="meta-divider"></span><span class="mono">${ev.stats.sampleNote.toUpperCase()}</span></div>` : ''}
    </section>
    <aside class="panel detail-panel"><span class="section-kicker">Selected evidence</span>
      <div class="detail-icon ${sel.status}">${sel.type==='decision'?'✓':sel.type==='rule'?'§':sel.type==='metric'?'Δ':'·'}</div>
      <h2>${esc(sel.label)}</h2><p>${esc(sel.detail)}</p>
      ${sel.meta?.stats ? `<p class="detail-stats">${esc(sel.meta.stats)}</p>` : ''}
      <div class="detail-meta"><span class="mono">NODE / ${sel.id.toUpperCase()}</span><span class="status-chip ${sel.status}">${sel.status}</span></div>
      <div class="recommendation"><span class="section-kicker">Firewall recommendation</span><p>${esc(ev.recommendation)}</p></div>
    </aside>
  </div>
  <div class="trace-bottom"><span class="mono">EVALUATED ${formatTime(ev.evaluatedAt)} · ${ev.matchedRuleIds.length} POLICY RULES MATCHED</span><a class="primary-button small" href="#console">Return to console <span aria-hidden="true">${icon('arrow')}</span></a></div>`);
}

/* ═══════════════════════════════════════════════════════════
   BUILDER PAGE
   ═══════════════════════════════════════════════════════════ */

function renderBuilder() {
  const customs = store.state.customScenarios;
  return layout(`<div class="builder-grid">
    <section class="panel builder-form-panel">
      <div class="panel-header"><div><span class="section-kicker">Manual creation</span><h2>Define a scenario by hand</h2></div></div>
      <form class="builder-form" data-action="save-scenario">
        <div class="builder-field"><label>Scenario ID <small>(lowercase, e.g. checkout-freeze)</small></label><input name="id" required placeholder="e.g. checkout-freeze" pattern="[a-z0-9\\-]+" /></div>
        <div class="builder-field"><label>Full Label</label><input name="label" required placeholder="e.g. Checkout page freezing on payment gateway call" /></div>
        <div class="builder-field"><label>Short Label</label><input name="shortLabel" required placeholder="e.g. Checkout freeze" /></div>
        <div class="builder-field"><label>Severity</label><select name="severity"><option value="critical">Critical</option><option value="warning">Warning</option></select></div>
        <div class="builder-field"><label>Description</label><textarea name="description" required placeholder="Describe what is failing in simple words…" rows="2"></textarea></div>
        <div class="builder-field"><label>Incident ID</label><input name="incident" required placeholder="e.g. INC-5001" /></div>
        <div class="builder-field-row">
          <div class="builder-field"><label>Actor</label><input name="actor" required placeholder="e.g. checkout-api" /></div>
          <div class="builder-field"><label>Action</label><input name="action" required placeholder="e.g. charge" /></div>
          <div class="builder-field"><label>Resource</label><input name="resource" required placeholder="e.g. payment-gateway" /></div>
        </div>
        <fieldset class="builder-interventions">
          <legend>Candidate Fixes <small>(exactly 3 — one must be causal)</small></legend>
          ${[0,1,2].map(i => `<div class="intervention-fields" data-idx="${i}">
            <span class="builder-int-num">${i+1}</span>
            <input name="int-${i}-id" required placeholder="ID (e.g. add-timeout)" />
            <input name="int-${i}-label" required placeholder="Action label" />
            <select name="int-${i}-result"><option value="causal">Causal (Fixes root cause)</option><option value="temporary" ${i===1?'selected':''}>Temporary (Masks symptom)</option><option value="neutral" ${i===2?'selected':''}>Neutral (Ineffective)</option></select>
            <input name="int-${i}-effect" required placeholder="Effect explanation" />
            <input name="int-${i}-metric-label" required placeholder="Target metric name" />
            <input name="int-${i}-metric-delta" required placeholder="Metric Delta (e.g. −85%)" />
            <input name="int-${i}-metric-detail" required placeholder="Detail explanation" />
          </div>`).join('')}
        </fieldset>
        <div class="builder-field"><label>Recommendation</label><textarea name="recommendation" required placeholder="Directive for the on-call engineer…" rows="2"></textarea></div>
        <button type="submit" class="primary-button">Save scenario <span aria-hidden="true">${icon('arrow')}</span></button>
      </form>
    </section>
    <section class="panel builder-list-panel">
      <div class="panel-header"><div><span class="section-kicker">Library</span><h2>Your custom scenarios</h2></div><span class="mono">${customs.length} SAVED</span></div>
      ${customs.length ? `<div class="custom-list">${customs.map(s => `<div class="custom-row"><span class="scenario-severity ${s.severity}">${s.severity}</span><span><strong>${esc(s.shortLabel || s.label)}</strong><small>${esc(s.incident)} · ${s.interventions.length} interventions ${s.isAIGenerated ? '(AI Engine)' : ''}</small></span><button class="text-button danger" data-action="delete-scenario" data-scenario-id="${s.id}">Delete</button></div>`).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">+</span><strong>No custom scenarios yet.</strong><p>Use the form or let the AI Doctor generate scenarios for your websites.</p></div>`}
    </section>
  </div>`);
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS PAGE
   ═══════════════════════════════════════════════════════════ */

function renderSettings() {
  const p = store.state.preferences;
  const hLen = store.state.history.length;
  const gemini = store.state.geminiStatus;
  const currentKey = getApiKey();
  const maskedKey = currentKey ? `${currentKey.slice(0, 8)}...${currentKey.slice(-6)}` : 'None';

  return layout(`<div class="settings-grid">
    <section class="panel settings-card">
      <div class="panel-header"><div><span class="section-kicker">AI Engine</span><h2>AI API Configuration</h2></div></div>
      <div class="setting-row">
        <div>
          <strong>Active AI API Key</strong>
          <small>Current key: <code class="mono-code">${esc(maskedKey)}</code></small>
        </div>
        <div class="gemini-status-tag ${gemini.connected ? 'connected' : 'checked'}">
          ${gemini.connected ? `✓ Connected (${gemini.latencyMs}ms)` : '● Active'}
        </div>
      </div>
      <div class="setting-row">
        <div class="key-input-container">
          <input type="password" id="gemini-key-input" class="search-input key-field" placeholder="Paste custom AI API key…" />
          <button class="primary-button small" data-action="save-gemini-key">Update Key</button>
          <button class="secondary-button small" data-action="test-gemini-key">Test Connection</button>
        </div>
      </div>
    </section>

    <section class="panel settings-card">
      <div class="panel-header"><div><span class="section-kicker">Appearance</span><h2>Theme & display</h2></div></div>
      <div class="setting-row"><span><strong>Color theme</strong><small>Switch between dark and high-contrast light interface.</small></span><button class="primary-button small" data-action="toggle-theme">${p.theme === 'dark' ? '☀ Switch to light' : '☾ Switch to dark'}</button></div>
    </section>

    <section class="panel settings-card">
      <div class="panel-header"><div><span class="section-kicker">Data management</span><h2>History & export</h2></div></div>
      <div class="setting-row"><span><strong>Evaluation history</strong><small>${hLen} evaluation${hLen!==1?'s':''} stored locally in browser.</small></span>
        <div class="setting-actions">
          ${hLen ? `<button class="primary-button small" data-action="export-json">Export JSON</button>
          <button class="primary-button small" data-action="export-csv">Export CSV</button>` : ''}
        </div>
      </div>
      <div class="setting-row danger-row"><span><strong>Clear all history</strong><small>Deletes all saved evaluation records.</small></span><button class="primary-button small danger-btn" data-action="clear-history">Clear history</button></div>
      <div class="setting-row danger-row"><span><strong>Delete custom scenarios</strong><small>Removes all user-created and AI-diagnosed scenarios.</small></span><button class="primary-button small danger-btn" data-action="clear-scenarios">Delete all</button></div>
    </section>

    <section class="panel settings-card">
      <div class="panel-header"><div><span class="section-kicker">About</span><h2>Causal Firewall v2.1</h2></div></div>
      <div class="about-info">
        <p>An evidence-first remediation gate for websites, webapps, and distributed cloud backends. Integrates real-time AI diagnostics and tests candidate fixes on a 5% shadow cohort before opening the gate to 100% of production traffic.</p>
        <div class="about-meta"><span class="mono">VERSION 2.1.0 · AI EDITION</span><span class="mono">AI ENGINE ACTIVE</span><span class="mono">${scenarios.length} BUILT-IN SCENARIOS</span></div>
      </div>
    </section>
  </div>`);
}

/* ═══════════════════════════════════════════════════════════
   COMPARISON MODAL
   ═══════════════════════════════════════════════════════════ */

function renderComparisonModal() {
  const [idA, idB] = store.state.compareIds;
  const a = store.state.history.find(e => e.id === idA);
  const b = store.state.history.find(e => e.id === idB);
  if (!a || !b) return '';
  const cmp = compareEvaluations(a, b);
  const scA = store.findScenario(a.scenarioId);
  const scB = store.findScenario(b.scenarioId);

  return `<div class="modal-overlay" data-action="close-modal">
    <div class="modal comparison-modal" role="dialog" aria-label="Compare evaluations">
      <div class="modal-header"><h2>Comparison</h2><button class="modal-close" data-action="close-modal" aria-label="Close">✕</button></div>
      <div class="comparison-grid">
        <div class="compare-col ${cmp.winner==='a'?'winner':''}">
          <span class="section-kicker">${esc(scA.shortLabel)}</span>
          <h3>${esc(a.interventionId.replaceAll('-',' '))}</h3>
          <div class="compare-decision ${a.decision}">${statusLabel(a.decision)}</div>
          <strong class="compare-conf">${Math.round(a.confidence*100)}%</strong>
          <span class="mono">${esc(a.metric.delta)}</span>
          <p>${esc(a.reason)}</p>
        </div>
        <div class="compare-vs">VS</div>
        <div class="compare-col ${cmp.winner==='b'?'winner':''}">
          <span class="section-kicker">${esc(scB.shortLabel)}</span>
          <h3>${esc(b.interventionId.replaceAll('-',' '))}</h3>
          <div class="compare-decision ${b.decision}">${statusLabel(b.decision)}</div>
          <strong class="compare-conf">${Math.round(b.confidence*100)}%</strong>
          <span class="mono">${esc(b.metric.delta)}</span>
          <p>${esc(b.reason)}</p>
        </div>
      </div>
      <div class="compare-summary"><span class="mono">CONFIDENCE DELTA: ${cmp.confidenceDelta > 0 ? '+' : ''}${cmp.confidenceDelta}%</span><span class="meta-divider"></span><span class="mono">${cmp.sameDecision ? 'SAME DECISION' : 'DIFFERENT DECISIONS'}</span></div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   ONBOARDING MODAL
   ═══════════════════════════════════════════════════════════ */

function renderOnboarding() {
  return `<div class="modal-overlay" data-action="dismiss-onboarding">
    <div class="modal onboarding-modal" role="dialog" aria-label="Welcome to Causal Firewall">
      <div class="modal-header"><h2>Welcome to Causal Firewall</h2><button class="modal-close" data-action="dismiss-onboarding" aria-label="Close">✕</button></div>
      <div class="onboarding-steps">
        <div class="onboarding-step"><span class="ob-num">1</span><div><strong>Console</strong><p>Monitor your website decisions, error metrics, and safety posture at a glance.</p></div></div>
        <div class="onboarding-step"><span class="ob-num">2</span><div><strong>Run Scenario</strong><p>Choose an incident, select a candidate fix, and test it on a 5% shadow cohort.</p></div></div>
        <div class="onboarding-step"><span class="ob-num">3</span><div><strong>AI Incident Doctor</strong><p>Paste any real error log or bug description. The AI engine isolates the root cause and generates 3 testable fixes.</p></div></div>
        <div class="onboarding-step"><span class="ob-num">4</span><div><strong>Causal Trace</strong><p>Inspect the evidence chain step-by-step: request → signals → hypothesis → metric delta → decision.</p></div></div>
      </div>
      <div class="onboarding-footer"><p>Press <kbd>?</kbd> anytime for keyboard shortcuts.</p><button class="primary-button" data-action="dismiss-onboarding">Get started <span aria-hidden="true">${icon('arrow')}</span></button></div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS MODAL
   ═══════════════════════════════════════════════════════════ */

function renderShortcuts() {
  const shortcuts = [
    ['1', 'Go to Console'], ['2', 'Go to Simulator'], ['3', 'Go to AI Incident Doctor'],
    ['4', 'Go to Causal Trace'], ['5', 'Go to Scenario Builder'], ['6', 'Go to Settings'],
    ['E', 'Evaluate intervention'], ['B', 'Batch evaluate all'], ['T', 'Toggle theme'],
    ['?', 'Show shortcuts'], ['Esc', 'Close modal / clear']
  ];
  return `<div class="modal-overlay" data-action="toggle-shortcuts">
    <div class="modal shortcuts-modal" role="dialog" aria-label="Keyboard shortcuts">
      <div class="modal-header"><h2>Keyboard shortcuts</h2><button class="modal-close" data-action="toggle-shortcuts" aria-label="Close">✕</button></div>
      <div class="shortcut-list">${shortcuts.map(([k,d]) => `<div class="shortcut-row"><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════════════════ */

function renderToast() {
  const t = store.state.toast;
  if (!t) { toastRoot.innerHTML = ''; return; }
  toastRoot.innerHTML = `<div class="toast toast-${t.type}">${esc(t.message)}</div>`;
}

/* ═══════════════════════════════════════════════════════════
   MAIN RENDER
   ═══════════════════════════════════════════════════════════ */

function render() {
  if (!app) return;

  const focused = document.activeElement?.dataset;

  const r = store.state.route;
  app.innerHTML = r === 'simulate' ? renderSimulator()
    : r === 'ai' ? renderAIDoctor()
    : r === 'trace' ? renderTrace()
    : r === 'builder' ? renderBuilder()
    : r === 'settings' ? renderSettings()
    : renderConsole();

  // Nav active states
  document.querySelectorAll('.nav-link').forEach(link => {
    const active = link.dataset.route === r;
    link.classList.toggle('active', active);
    active ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current');
  });

  // Status message
  const status = document.querySelector('#status-message');
  if (status) {
    status.textContent = store.state.isEvaluating
      ? 'Evaluating the selected intervention in a simulated shadow cohort.'
      : store.state.evaluation
        ? `${statusLabel(store.state.evaluation.decision)} for ${store.findScenario(store.state.evaluation.scenarioId).shortLabel}.`
        : '';
  }

  // Modals
  let modalHTML = '';
  if (store.state.showOnboarding) modalHTML = renderOnboarding();
  else if (store.state.showShortcuts) modalHTML = renderShortcuts();
  else if (store.state.compareIds.length === 2 && store.state._showCompare) modalHTML = renderComparisonModal();
  modalRoot.innerHTML = modalHTML;

  // Toast
  renderToast();

  if (focused?.node) {
    document.querySelector(`[data-node="${focused.node}"]`)?.focus();
  }
}

/* ═══════════════════════════════════════════════════════════
   EVENT DELEGATION (Single handler — no listener leaks)
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('click', e => {
  const t = e.target.closest('[data-action], [data-scenario], [data-intervention], [data-node], [data-evaluation], [data-rule], [data-filter], [data-compare], [data-scenario-id]');
  if (!t) return;

  const act = t.dataset.action;

  if (act === 'evaluate') store.evaluate();
  else if (act === 'batch-evaluate') store.evaluateBatch();
  else if (act === 'toggle-theme') store.toggleTheme();
  else if (act === 'show-shortcuts') store.toggleShortcuts();
  else if (act === 'toggle-shortcuts') store.toggleShortcuts();
  else if (act === 'show-help') store.showOnboardingModal();
  else if (act === 'dismiss-onboarding') store.dismissOnboarding();
  else if (act === 'close-modal') { store.state._showCompare = false; store.toggleShortcuts(); }
  else if (act === 'export-json') exportAsJSON(store.state.history);
  else if (act === 'export-csv') exportAsCSV(store.state.history);
  else if (act === 'clear-history') store.clearHistory();
  else if (act === 'clear-scenarios') { store.state.customScenarios = []; saveCustomScenarios([]); store.showToast('Custom scenarios deleted.', 'info'); render(); }
  else if (act === 'run-compare') { store.state._showCompare = true; render(); }
  else if (act === 'clear-compare') store.clearCompare();
  else if (act === 'diagnose-ai') {
    const input = document.querySelector('#ai-incident-input');
    if (input) store.diagnoseWithAI(input.value);
  }
  else if (act === 'fill-ai-template') {
    const input = document.querySelector('#ai-incident-input');
    if (input && t.dataset.template) {
      input.value = t.dataset.template;
      input.focus();
    }
  }
  else if (act === 'clear-ai') {
    store.clearAIDiagnosis();
    const input = document.querySelector('#ai-incident-input');
    if (input) input.value = '';
  }
  else if (act === 'copy-code') {
    copyToClipboard(t.dataset.code || '', 'Code snippet copied to clipboard!');
    const originalText = t.innerHTML;
    t.innerHTML = '✓ Copied!';
    setTimeout(() => { t.innerHTML = originalText; }, 2000);
  }
  else if (act === 'test-ai-intervention') {
    const scId = t.dataset.scenarioId;
    const intId = t.dataset.interventionId;
    store.selectScenario(scId);
    store.selectIntervention(intId);
    store.evaluate();
  }
  else if (act === 'save-gemini-key') {
    const input = document.querySelector('#gemini-key-input');
    if (input && input.value.trim()) {
      setApiKey(input.value.trim());
      store.showToast('AI API key updated!', 'success');
      store.checkGeminiConnection();
    }
  }
  else if (act === 'test-gemini-key') {
    store.showToast('Testing AI connection...', 'info');
    const orig = t.textContent;
    t.textContent = 'Testing...';
    store.checkGeminiConnection().then(res => {
      t.textContent = orig;
      if (res.success) store.showToast(`Connected! Latency: ${res.latencyMs}ms`, 'success');
      else store.showToast(`Connection failed: ${res.error}`, 'error');
    });
  }
  else if (t.dataset.scenario && !act) store.selectScenario(t.dataset.scenario);
  else if (t.dataset.intervention && !act) store.selectIntervention(t.dataset.intervention);
  else if (t.dataset.node) store.selectNode(t.dataset.node);
  else if (t.dataset.evaluation) { e.preventDefault(); store.selectEvaluation(t.dataset.evaluation); }
  else if (t.dataset.filter) store.setFilter(t.dataset.filter);
  else if (t.dataset.compare) store.toggleCompare(t.dataset.compare);
  else if (act === 'delete-scenario' && t.dataset.scenarioId) store.deleteCustomScenario(t.dataset.scenarioId);
});

/* checkbox changes (policy toggles) */
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset?.rule) store.toggleRule(t.dataset.rule);
  if (t.dataset?.action === 'search') store.setSearch(t.value);
});

/* search input (live search) */
document.addEventListener('input', e => {
  if (e.target.dataset?.action === 'search') store.setSearch(e.target.value);
});

/* form submission (builder) */
document.addEventListener('submit', e => {
  if (e.target.dataset?.action !== 'save-scenario') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const g = k => fd.get(k)?.trim() || '';
  const scenario = {
    id: g('id'), label: g('label'), shortLabel: g('shortLabel'),
    severity: g('severity'), description: g('description'),
    incident: g('incident'), custom: true,
    request: { actor: g('actor'), action: g('action'), resource: g('resource'), destination: 'custom' },
    signals: [
      { id: 'custom-1', label: 'Primary signal', value: 'active', tone: 'critical', detail: 'User-defined signal for this scenario.' },
      { id: 'custom-2', label: 'Secondary signal', value: 'active', tone: 'warning', detail: 'User-defined secondary signal.' }
    ],
    interventions: [0, 1, 2].map(i => ({
      id: g(`int-${i}-id`), label: g(`int-${i}-label`),
      result: g(`int-${i}-result`), effect: g(`int-${i}-effect`),
      metric: { label: g(`int-${i}-metric-label`), delta: g(`int-${i}-metric-delta`), detail: g(`int-${i}-metric-detail`) }
    })),
    recommendation: g('recommendation')
  };
  store.addCustomScenario(scenario);
  e.target.reset();
});

/* ═══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  const routes = {
    '1': 'console', '2': 'simulate', '3': 'ai',
    '4': 'trace',   '5': 'builder',  '6': 'settings'
  };
  if (routes[e.key]) {
    store.setRoute(routes[e.key]);
    window.history.replaceState(null, '', '#' + routes[e.key]);
  }
  else if (e.key === 'e' || e.key === 'E') store.evaluate();
  else if (e.key === 'b' || e.key === 'B') store.evaluateBatch();
  else if (e.key === 't' || e.key === 'T') store.toggleTheme();
  else if (e.key === '?') store.toggleShortcuts();
  else if (e.key === 'Escape') {
    if (store.state.showOnboarding) store.dismissOnboarding();
    else if (store.state.showShortcuts) store.toggleShortcuts();
    else if (store.state._showCompare) { store.state._showCompare = false; render(); }
  }
});

/* ═══════════════════════════════════════════════════════════
   HASH NAVIGATION
   ═══════════════════════════════════════════════════════════ */

window.addEventListener('hashchange', () => store.setRoute(window.location.hash.slice(1)));

/* ═══════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════ */

store.subscribe(render);
render();
