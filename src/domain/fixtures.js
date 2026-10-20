export const scenarios = [
  {
    id: 'retry-storm',
    label: 'Retry storm after database latency',
    shortLabel: 'Retry storm',
    severity: 'critical',
    description: 'API latency is climbing while workers repeat the same failed request.',
    incident: 'INC-2048',
    request: { actor: 'worker-pool', action: 'retry', resource: 'orders-api', destination: 'primary-db' },
    signals: [
      { id: 'latency', label: 'Database latency', value: '+480 ms', tone: 'critical', detail: 'p95 database latency crossed the 400 ms incident threshold.' },
      { id: 'retry-rate', label: 'Retry amplification', value: '8.4×', tone: 'critical', detail: 'Workers are retrying without a shared retry budget.' },
      { id: 'queue-depth', label: 'Queue depth', value: '+11×', tone: 'warning', detail: 'The queue is growing faster than workers can drain it.' }
    ],
    interventions: [
      { id: 'restart-api', label: 'Restart API', result: 'temporary', effect: 'A short recovery hides the pressure, then latency returns.' },
      { id: 'clear-cache', label: 'Clear Redis cache', result: 'neutral', effect: 'No meaningful improvement in p95 latency.' },
      { id: 'stop-retries', label: 'Apply retry budget', result: 'causal', effect: 'Latency drops and queue growth stops in the shadow cohort.' }
    ],
    recommendation: 'Apply an exponential backoff and retry budget to workers before changing database capacity.'
  },
  {
    id: 'cache-drift',
    label: 'Cache drift causing stale pricing',
    shortLabel: 'Cache drift',
    severity: 'warning',
    description: 'Customers are seeing old prices after a catalog update.',
    incident: 'INC-2051',
    request: { actor: 'catalog-service', action: 'invalidate', resource: 'pricing-cache', destination: 'redis-cluster' },
    signals: [
      { id: 'stale-read', label: 'Stale reads', value: '14.2%', tone: 'warning', detail: 'Pricing reads are older than the catalog version.' },
      { id: 'catalog-version', label: 'Catalog version gap', value: 'v42 → v41', tone: 'critical', detail: 'The cache is one version behind the source of truth.' },
      { id: 'db-health', label: 'Database health', value: '99.8%', tone: 'healthy', detail: 'The source database is healthy and serving current prices.' }
    ],
    interventions: [
      { id: 'restart-catalog', label: 'Restart catalog', result: 'neutral', effect: 'The service restarts without updating existing cache keys.' },
      { id: 'invalidate-keys', label: 'Invalidate stale keys', result: 'causal', effect: 'Stale reads fall below 0.2% in the shadow cohort.' },
      { id: 'scale-db', label: 'Scale database', result: 'neutral', effect: 'Adds capacity but does not change cache freshness.' }
    ],
    recommendation: 'Invalidate keys carrying the previous catalog version, then replay the shadow cohort.'
  }
];

export const defaultPolicy = {
  id: 'remediation-gate',
  version: '2026.10',
  mode: 'standard',
  rules: [
    { id: 'causal-proof', label: 'Require causal improvement', description: 'Only approve an intervention when the target metric improves in the shadow cohort.', enabled: true },
    { id: 'blast-radius', label: 'Cap initial blast radius', description: 'Start experiments at 5% of traffic or less.', enabled: true },
    { id: 'audit-evidence', label: 'Persist decision evidence', description: 'Store the hypothesis, intervention, metrics, and outcome.', enabled: true }
  ]
};

export const getScenario = id => scenarios.find(scenario => scenario.id === id) || scenarios[0];
