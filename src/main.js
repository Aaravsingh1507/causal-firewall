import { getScenario, scenarios } from './domain/fixtures.js';
import { createStore } from './state/store.js';

const app = document.querySelector('#app');
const store = createStore();

const icon = (name) => ({
  arrow: '<span aria-hidden="true">↗</span>',
  chevron: '<span aria-hidden="true">⌄</span>',
  check: '<span aria-hidden="true">✓</span>',
  pulse: '<span aria-hidden="true">◌</span>'
}[name] || '');

function statusLabel(decision) {
  return decision === 'allow' ? 'Gate opened' : decision === 'review' ? 'Gate held' : 'Gate blocked';
}

function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function layout(content) {
  const route = store.state.route;
  return `<div class="screen-heading">
    <div><p class="eyebrow">${route === 'console' ? 'Control plane' : route === 'simulate' ? 'Controlled experiment' : 'Evidence trail'}</p><h1>${route === 'console' ? 'Remediation, with proof.' : route === 'simulate' ? 'Run a shadow intervention.' : 'Follow the causal path.'}</h1></div>
    <div class="heading-meta"><span class="mono">POLICY ${store.state.policy.version}</span><span class="meta-divider"></span><span class="mono">${store.state.history.length ? `${store.state.history.length} EVALUATIONS` : 'NO EVALUATIONS'}</span></div>
  </div>${content}`;
}

function renderConsole() {
  const summary = store.historySummary();
  const latest = store.state.history[0];
  const scenario = latest ? getScenario(latest.scenarioId) : scenarios[0];
  return layout(`<div class="hero-panel">
      <div class="hero-panel-copy"><span class="section-kicker">01 / The problem</span><h2>Automation can fix<br><em>the wrong cause.</em></h2><p>When an incident hits, the fastest remediation is often a guess. Causal Firewall tests the intervention on a shadow cohort first, then opens the gate only when the system proves the metric improved.</p><a class="primary-button" href="#simulate">Run a scenario ${icon('arrow')}</a></div>
      <div class="signal-orbit" aria-label="Evidence-first remediation diagram"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit-node node-request">REQUEST<span>incident detected</span></div><div class="orbit-node node-test">TEST<span>5% shadow cohort</span></div><div class="orbit-node node-proof">PROOF<span>causal delta</span></div><div class="orbit-center">CF<span>gate</span></div></div>
    </div>
    <div class="metric-grid"><div class="metric-card"><span class="metric-label">Requests evaluated</span><strong>${summary.evaluated.toString().padStart(2, '0')}</strong><span class="metric-foot">local simulation</span></div><div class="metric-card"><span class="metric-label">Gate opened</span><strong>${summary.approved.toString().padStart(2, '0')}</strong><span class="metric-foot good">evidence-backed</span></div><div class="metric-card"><span class="metric-label">Held for proof</span><strong>${summary.review.toString().padStart(2, '0')}</strong><span class="metric-foot warn">needs experiment</span></div><div class="metric-card accent-card"><span class="metric-label">Current posture</span><strong>SAFE</strong><span class="metric-foot">no global actions allowed</span></div></div>
    <div class="content-grid"><section class="panel recent-panel"><div class="panel-header"><div><span class="section-kicker">02 / Activity</span><h2>Decision history</h2></div><a class="text-button" href="#trace">Open latest ${icon('arrow')}</a></div>${store.state.history.length ? `<div class="history-list">${store.state.history.map(item => { const itemScenario = getScenario(item.scenarioId); return `<a class="history-row" href="#trace" data-evaluation="${item.id}" aria-label="Open ${itemScenario.shortLabel} evaluation"><span class="history-status ${item.decision}"></span><span class="history-main"><strong>${itemScenario.shortLabel}</strong><small>${itemScenario.incident} · ${item.interventionId.replaceAll('-', ' ')}</small></span><span class="history-result ${item.decision}">${statusLabel(item.decision)}</span><span class="mono">${formatTime(item.evaluatedAt)}</span>${icon('arrow')}</a>`; }).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">◌</span><strong>No decisions yet.</strong><p>Choose a scenario to see the firewall reason about a real intervention.</p><a class="text-button" href="#simulate">Start first evaluation ${icon('arrow')}</a></div>`}</section><section class="panel principle-panel"><span class="section-kicker">03 / Principle</span><h2>Correlation is<br>not causation.</h2><div class="principle-rule"><span>01</span><p>Observe the incident</p></div><div class="principle-rule"><span>02</span><p>Test the smallest fix</p></div><div class="principle-rule"><span>03</span><p>Scale only with evidence</p></div><div class="panel-note">Every decision carries its hypothesis, metric delta, and blast radius.</div></section></div>`);
}

function renderSimulator() {
  const scenario = getScenario(store.state.scenarioId);
  return layout(`<div class="simulator-grid"><section class="panel scenario-panel"><div class="panel-header"><div><span class="section-kicker">Select an incident</span><h2>What are we trying to fix?</h2></div><span class="live-badge"><i></i> SIMULATED</span></div><div class="scenario-list">${scenarios.map(item => `<button class="scenario-option ${item.id === scenario.id ? 'selected' : ''}" data-scenario="${item.id}" aria-pressed="${item.id === scenario.id}"><span class="scenario-number">${item.id === 'retry-storm' ? 'A' : 'B'}</span><span><strong>${item.label}</strong><small>${item.description}</small></span><span class="scenario-severity ${item.severity}">${item.severity}</span></button>`).join('')}</div><div class="incident-strip"><span class="mono">${scenario.incident}</span><span>${scenario.request.actor} → ${scenario.request.resource}</span><span class="incident-pulse">● simulated incident</span></div></section><section class="panel intervention-panel"><div class="panel-header"><div><span class="section-kicker">Choose a hypothesis</span><h2>What should we try?</h2></div><span class="mono">SHADOW: 5%</span></div><div class="intervention-list">${scenario.interventions.map(item => `<button class="intervention-option ${item.id === store.state.interventionId ? 'selected' : ''}" data-intervention="${item.id}" aria-pressed="${item.id === store.state.interventionId}"><span class="radio-dot"></span><span><strong>${item.label}</strong><small>${item.effect}</small></span><span class="option-arrow">→</span></button>`).join('')}</div><div class="policy-box"><div class="policy-box-top"><span class="section-kicker">Active policy</span><span class="mono">v${store.state.policy.version}</span></div>${store.state.policy.rules.map(rule => `<label class="policy-toggle"><input type="checkbox" data-rule="${rule.id}" ${rule.enabled ? 'checked' : ''}><span class="toggle-ui"></span><span><strong>${rule.label}</strong><small>${rule.description}</small></span></label>`).join('')}</div><button class="evaluate-button ${store.state.isEvaluating ? 'loading' : ''}" data-action="evaluate" ${store.state.isEvaluating ? 'disabled' : ''}>${store.state.isEvaluating ? `${icon('pulse')} Measuring shadow cohort…` : `Evaluate intervention ${icon('arrow')}`}</button></section></div><div class="experiment-footnote"><span class="footnote-mark">✳</span><p>This is a local simulation. Causal Firewall never touches production systems or performs an external action.</p></div>`);
}

function renderTrace() {
  const evaluation = store.state.evaluation;
  if (!evaluation) return layout(`<div class="trace-empty panel"><span class="empty-icon">◎</span><h2>No causal trace yet.</h2><p>Run a controlled scenario first. The firewall will show every signal, hypothesis, metric, and policy decision.</p><a class="primary-button" href="#simulate">Go to simulator ${icon('arrow')}</a></div>`);
  const scenario = getScenario(evaluation.scenarioId);
  const selected = evaluation.trace.find(node => node.id === store.state.selectedNodeId) || evaluation.trace.at(-1);
  return layout(`<div class="trace-topline"><div class="decision-banner ${evaluation.decision}"><div class="decision-icon">${evaluation.decision === 'allow' ? '✓' : '!'}</div><div><span class="section-kicker">Decision / ${scenario.incident}</span><h2>${statusLabel(evaluation.decision)}</h2><p>${evaluation.reason}</p></div><div class="confidence"><strong>${Math.round(evaluation.confidence * 100)}%</strong><span>confidence</span></div></div><a class="text-button" href="#simulate">Replay another ${icon('arrow')}</a></div><div class="trace-layout"><section class="panel trace-panel"><div class="panel-header"><div><span class="section-kicker">Evidence chain</span><h2>${scenario.shortLabel} / ${evaluation.interventionId.replaceAll('-', ' ')}</h2></div><span class="mono">SIMULATED · ${evaluation.durationMs} MS</span></div><div class="trace-chain" role="list" aria-label="Causal evaluation trace">${evaluation.trace.map((node, index) => `<div class="trace-step" role="listitem"><button class="trace-node ${node.status} ${node.id === selected.id ? 'selected' : ''}" data-node="${node.id}" aria-label="Inspect ${node.label}" aria-pressed="${node.id === selected.id}"><span class="trace-node-index">0${index + 1}</span><span class="trace-node-type">${node.type}</span><strong>${node.label}</strong><small>${node.status === 'matched' ? 'evidence matched' : node.status === 'passed' ? 'observed' : node.status === 'failed' ? 'not proven' : node.status === 'warning' ? 'inconclusive' : node.status === 'bypassed' ? 'bypassed' : node.status}</small></button>${index < evaluation.trace.length - 1 ? '<span class="trace-connector" aria-hidden="true">→</span>' : ''}</div>`).join('')}</div><div class="trace-legend"><span><i class="legend-dot matched"></i> matched</span><span><i class="legend-dot warning"></i> inconclusive</span><span><i class="legend-dot failed"></i> failed proof</span></div></section><aside class="panel detail-panel"><span class="section-kicker">Selected evidence</span><div class="detail-icon ${selected.status}">${selected.type === 'decision' ? '✓' : selected.type === 'rule' ? '§' : selected.type === 'metric' ? 'Δ' : '·'}</div><h2>${selected.label}</h2><p>${selected.detail}</p><div class="detail-meta"><span class="mono">NODE / ${selected.id.toUpperCase()}</span><span class="status-chip ${selected.status}">${selected.status}</span></div><div class="recommendation"><span class="section-kicker">Firewall recommendation</span><p>${evaluation.recommendation}</p></div></aside></div><div class="trace-bottom"><span class="mono">EVALUATED ${formatTime(evaluation.evaluatedAt)} · ${evaluation.matchedRuleIds.length} POLICY RULES MATCHED</span><a class="primary-button small" href="#console">Return to console ${icon('arrow')}</a></div>`);
}

function render() {
  if (!app) return;
  app.innerHTML = store.state.route === 'simulate' ? renderSimulator() : store.state.route === 'trace' ? renderTrace() : renderConsole();
  document.querySelectorAll('.nav-link').forEach(link => {
    const active = link.dataset.route === store.state.route;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const status = document.querySelector('#status-message');
  if (status) status.textContent = store.state.isEvaluating ? 'Evaluating the selected intervention in a simulated shadow cohort.' : store.state.evaluation ? `${statusLabel(store.state.evaluation.decision)} for ${getScenario(store.state.evaluation.scenarioId).shortLabel}.` : '';
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => store.selectScenario(button.dataset.scenario)));
  document.querySelectorAll('[data-intervention]').forEach(button => button.addEventListener('click', () => store.selectIntervention(button.dataset.intervention)));
  document.querySelectorAll('[data-node]').forEach(button => button.addEventListener('click', () => store.selectNode(button.dataset.node)));
  document.querySelectorAll('[data-evaluation]').forEach(row => row.addEventListener('click', () => store.selectEvaluation(row.dataset.evaluation)));
  document.querySelectorAll('[data-rule]').forEach(input => input.addEventListener('change', () => store.toggleRule(input.dataset.rule)));
  document.querySelector('[data-action="evaluate"]')?.addEventListener('click', () => store.evaluate());
}

window.addEventListener('hashchange', () => store.setRoute(window.location.hash.slice(1)));
store.subscribe(render);
render();
