/**
 * Incident scenarios, interventions, and default policy definitions.
 *
 * Eight real-world infrastructure failure scenarios, each with three
 * candidate interventions (one causal, one temporary/neutral, one neutral).
 */

export const scenarios = [
  /* ── A  Retry Storm ─────────────────────────────────── */
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
      { id: 'restart-api', label: 'Restart API', result: 'temporary', effect: 'A short recovery hides the pressure, then latency returns.', metric: { label: 'p95 API latency', delta: '−9%', detail: 'Latency improves briefly, then returns as retries rebuild pressure.' } },
      { id: 'clear-cache', label: 'Clear Redis cache', result: 'neutral', effect: 'No meaningful improvement in p95 latency.', metric: { label: 'p95 API latency', delta: '+1%', detail: 'The shadow cohort shows no reliable change in the target metric.' } },
      { id: 'stop-retries', label: 'Apply retry budget', result: 'causal', effect: 'Latency drops and queue growth stops in the shadow cohort.', metric: { label: 'p95 API latency', delta: '−71%', detail: 'Latency falls while queue growth stops in the shadow cohort.' } }
    ],
    recommendation: 'Apply an exponential backoff and retry budget to workers before changing database capacity.'
  },

  /* ── B  Cache Drift ─────────────────────────────────── */
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
      { id: 'restart-catalog', label: 'Restart catalog', result: 'neutral', effect: 'The service restarts without updating existing cache keys.', metric: { label: 'stale pricing reads', delta: '−0.4%', detail: 'A restart does not invalidate the old versioned cache keys.' } },
      { id: 'invalidate-keys', label: 'Invalidate stale keys', result: 'causal', effect: 'Stale reads fall below 0.2% in the shadow cohort.', metric: { label: 'stale pricing reads', delta: '−99%', detail: 'Stale reads fall from 14.2% to below 0.2% in the shadow cohort.' } },
      { id: 'scale-db', label: 'Scale database', result: 'neutral', effect: 'Adds capacity but does not change cache freshness.', metric: { label: 'stale pricing reads', delta: '+0.1%', detail: 'The source database is healthy already; extra capacity does not change cache freshness.' } }
    ],
    recommendation: 'Invalidate keys carrying the previous catalog version, then replay the shadow cohort.'
  },

  /* ── C  DNS Resolution Failure ──────────────────────── */
  {
    id: 'dns-failure',
    label: 'DNS resolution failure cascade',
    shortLabel: 'DNS failure',
    severity: 'critical',
    description: 'Intermittent DNS lookup failures are cascading into 503 errors across multiple services.',
    incident: 'INC-2063',
    request: { actor: 'api-gateway', action: 'resolve', resource: 'service-mesh', destination: 'dns-resolver' },
    signals: [
      { id: 'dns-timeout', label: 'DNS timeout rate', value: '23%', tone: 'critical', detail: 'Nearly one in four DNS lookups are timing out within the mesh.' },
      { id: 'error-503', label: 'HTTP 503 errors', value: '+340%', tone: 'critical', detail: 'Service-to-service calls are failing because hostnames cannot be resolved.' },
      { id: 'resolver-cpu', label: 'Resolver CPU', value: '97%', tone: 'warning', detail: 'The primary DNS resolver pod is CPU-saturated under query load.' }
    ],
    interventions: [
      { id: 'restart-resolver', label: 'Restart DNS resolver', result: 'temporary', effect: 'Clears the resolver cache and briefly reduces CPU, but load returns in minutes.', metric: { label: 'DNS timeout rate', delta: '−12%', detail: 'Timeout rate drops briefly then climbs back as the cache is cold and query flood returns.' } },
      { id: 'increase-ttl', label: 'Increase DNS TTL', result: 'neutral', effect: 'Reduces query volume slightly but stale records may cause new routing errors.', metric: { label: 'DNS timeout rate', delta: '−3%', detail: 'Marginally fewer lookups, but stale entries risk mis-routing traffic.' } },
      { id: 'add-backup-resolver', label: 'Switch to backup resolver', result: 'causal', effect: 'Traffic shifts to a healthy resolver pod and timeouts stop.', metric: { label: 'DNS timeout rate', delta: '−95%', detail: 'Timeout rate falls from 23% to under 1% in the shadow cohort.' } }
    ],
    recommendation: 'Failover to a backup DNS resolver and investigate the root cause of CPU saturation on the primary.'
  },

  /* ── D  TLS Certificate Expiry ──────────────────────── */
  {
    id: 'cert-expiry',
    label: 'TLS certificate expiry cascade',
    shortLabel: 'Cert expiry',
    severity: 'critical',
    description: 'An expired internal TLS certificate is breaking authentication between microservices.',
    incident: 'INC-2070',
    request: { actor: 'auth-service', action: 'verify', resource: 'tls-cert', destination: 'cert-manager' },
    signals: [
      { id: 'tls-errors', label: 'TLS handshake failures', value: '100%', tone: 'critical', detail: 'All mutual-TLS connections to the auth service are failing.' },
      { id: 'cert-age', label: 'Certificate age', value: 'Expired 2h ago', tone: 'critical', detail: 'The internal wildcard certificate expired and was not auto-renewed.' },
      { id: 'auth-fallback', label: 'Auth fallback rate', value: '0%', tone: 'warning', detail: 'No fallback authentication path is configured.' }
    ],
    interventions: [
      { id: 'restart-auth', label: 'Restart auth service', result: 'neutral', effect: 'Service restarts but still loads the same expired certificate.', metric: { label: 'TLS handshake failures', delta: '−0%', detail: 'Restart has no effect because the certificate on disk is still expired.' } },
      { id: 'disable-mtls', label: 'Disable mutual TLS', result: 'temporary', effect: 'Connections resume but traffic is now unencrypted inside the mesh.', metric: { label: 'TLS handshake failures', delta: '−100%', detail: 'Failures stop, but security posture degrades to plaintext.' } },
      { id: 'rotate-cert', label: 'Rotate expired certificate', result: 'causal', effect: 'A new certificate is issued and mTLS connections recover.', metric: { label: 'TLS handshake failures', delta: '−100%', detail: 'All handshake failures resolve once the new cert propagates.' } }
    ],
    recommendation: 'Rotate the expired certificate immediately and configure cert-manager auto-renewal to prevent recurrence.'
  },

  /* ── E  Memory Leak ─────────────────────────────────── */
  {
    id: 'memory-leak',
    label: 'Memory leak in long-running service',
    shortLabel: 'Memory leak',
    severity: 'warning',
    description: 'A backend service heap usage climbs steadily until OOM kill restarts the pod.',
    incident: 'INC-2077',
    request: { actor: 'order-processor', action: 'allocate', resource: 'heap-memory', destination: 'node-runtime' },
    signals: [
      { id: 'heap-growth', label: 'Heap growth rate', value: '+18 MB/hr', tone: 'warning', detail: 'Resident memory grows linearly with no plateau, indicating a leak.' },
      { id: 'oom-kills', label: 'OOM kill frequency', value: 'Every 6h', tone: 'critical', detail: 'The container hits its memory limit and is killed every 6 hours.' },
      { id: 'gc-pressure', label: 'GC pause time', value: '340 ms', tone: 'warning', detail: 'Garbage collection pauses are increasing as the heap fills.' }
    ],
    interventions: [
      { id: 'increase-memory', label: 'Increase memory limit', result: 'temporary', effect: 'Delays the OOM kill but does not stop the leak.', metric: { label: 'OOM kill interval', delta: '+50%', detail: 'Kill interval extends from 6h to 9h but the leak continues.' } },
      { id: 'restart-pod', label: 'Schedule periodic restart', result: 'neutral', effect: 'Masks the symptom; leak-induced latency still affects users between restarts.', metric: { label: 'Heap growth rate', delta: '−0%', detail: 'Heap still grows at 18 MB/hr between restarts.' } },
      { id: 'fix-handler', label: 'Fix leaking event handler', result: 'causal', effect: 'Heap stabilizes at a constant level and OOM kills stop.', metric: { label: 'Heap growth rate', delta: '−100%', detail: 'Heap plateaus at 210 MB and GC pauses drop to under 20 ms.' } }
    ],
    recommendation: 'Identify and remove the leaking event listener, then verify heap stability over a 24-hour window.'
  },

  /* ── F  Disk IOPS Saturation ────────────────────────── */
  {
    id: 'disk-iops',
    label: 'Disk IOPS saturation on database node',
    shortLabel: 'Disk IOPS',
    severity: 'critical',
    description: 'Write-ahead log throughput has saturated the disk, stalling all database writes.',
    incident: 'INC-2084',
    request: { actor: 'write-ahead-log', action: 'fsync', resource: 'data-volume', destination: 'disk-controller' },
    signals: [
      { id: 'iops-util', label: 'Disk utilization', value: '100%', tone: 'critical', detail: 'The data volume is at maximum IOPS capacity.' },
      { id: 'write-latency', label: 'Write latency', value: '+1200 ms', tone: 'critical', detail: 'fsync latency spiked from 2 ms to 1200 ms as the disk queue saturated.' },
      { id: 'wal-backlog', label: 'WAL backlog', value: '4.2 GB', tone: 'warning', detail: 'Unwritten WAL segments are accumulating in memory.' }
    ],
    interventions: [
      { id: 'throttle-writes', label: 'Throttle write rate', result: 'temporary', effect: 'Reduces immediate pressure but application writes start timing out.', metric: { label: 'Write latency', delta: '−30%', detail: 'Latency improves partially but application-level timeouts increase.' } },
      { id: 'add-replicas', label: 'Add read replicas', result: 'neutral', effect: 'Offloads reads but writes are the bottleneck.', metric: { label: 'Write latency', delta: '−2%', detail: 'Read replicas do not reduce pressure on the primary write path.' } },
      { id: 'separate-wal-volume', label: 'Offload WAL to separate volume', result: 'causal', effect: 'WAL writes move to a dedicated high-IOPS volume, freeing the data disk.', metric: { label: 'Write latency', delta: '−94%', detail: 'fsync latency drops from 1200 ms to 3 ms after WAL migration.' } }
    ],
    recommendation: 'Migrate WAL to a dedicated high-IOPS volume and set up disk utilization alerting at 80%.'
  },

  /* ── G  Connection Pool Exhaustion ───────────────────── */
  {
    id: 'pool-exhaustion',
    label: 'Database connection pool exhaustion',
    shortLabel: 'Pool exhaustion',
    severity: 'warning',
    description: 'Slow analytical queries are holding all available database connections, blocking transactional traffic.',
    incident: 'INC-2091',
    request: { actor: 'api-server', action: 'acquire', resource: 'db-connection', destination: 'connection-pool' },
    signals: [
      { id: 'active-conns', label: 'Active connections', value: '100/100', tone: 'critical', detail: 'All connections in the pool are in use; new requests are queued.' },
      { id: 'wait-time', label: 'Connection wait time', value: '+8.4s', tone: 'critical', detail: 'Requests wait over 8 seconds for an available connection.' },
      { id: 'slow-queries', label: 'Slow queries', value: '12 active', tone: 'warning', detail: 'Twelve analytical queries are running for over 30 seconds each.' }
    ],
    interventions: [
      { id: 'raise-pool-limit', label: 'Raise pool limit', result: 'temporary', effect: 'More connections open but slow queries still consume them all.', metric: { label: 'Connection wait time', delta: '−22%', detail: 'Wait time drops briefly until the new connections are also consumed.' } },
      { id: 'restart-db', label: 'Restart database', result: 'neutral', effect: 'All connections drop and reconnect, but slow queries resubmit immediately.', metric: { label: 'Connection wait time', delta: '−5%', detail: 'The restart provides seconds of relief before slow queries re-appear.' } },
      { id: 'kill-slow-queries', label: 'Kill slow queries + raise pool limit', result: 'causal', effect: 'Frees held connections immediately and prevents resubmission.', metric: { label: 'Connection wait time', delta: '−97%', detail: 'Wait time falls from 8.4s to under 50 ms after slow queries are terminated.' } }
    ],
    recommendation: 'Terminate long-running analytical queries, raise the pool limit modestly, and route analytics to a read replica.'
  },

  /* ── H  Cascading Timeout ───────────────────────────── */
  {
    id: 'cascading-timeout',
    label: 'Cascading timeout from slow upstream',
    shortLabel: 'Cascading timeout',
    severity: 'critical',
    description: 'A slow payment service is causing the entire checkout flow to timeout, backing up requests across all downstream services.',
    incident: 'INC-2098',
    request: { actor: 'checkout-service', action: 'call', resource: 'payment-api', destination: 'payment-gateway' },
    signals: [
      { id: 'payment-latency', label: 'Payment API latency', value: '+12s', tone: 'critical', detail: 'Payment API responses now take 12 seconds, well beyond the 3s timeout.' },
      { id: 'checkout-errors', label: 'Checkout error rate', value: '67%', tone: 'critical', detail: 'Two-thirds of checkout attempts are failing due to timeouts.' },
      { id: 'thread-pool', label: 'Thread pool saturation', value: '100%', tone: 'warning', detail: 'All request threads are blocked waiting for the payment API.' }
    ],
    interventions: [
      { id: 'increase-timeout', label: 'Increase timeout to 15s', result: 'neutral', effect: 'Requests wait longer but still fail as the payment service is degraded.', metric: { label: 'Checkout error rate', delta: '−8%', detail: 'A few more requests complete, but most still timeout or receive errors.' } },
      { id: 'scale-checkout', label: 'Scale checkout service', result: 'temporary', effect: 'More threads available but they all block on the same slow upstream.', metric: { label: 'Checkout error rate', delta: '−11%', detail: 'Marginal improvement as thread pool is larger, but root cause remains.' } },
      { id: 'circuit-breaker', label: 'Add circuit breaker', result: 'causal', effect: 'Failing calls are short-circuited, threads are freed, and a fallback response is returned.', metric: { label: 'Checkout error rate', delta: '−89%', detail: 'Error rate drops from 67% to 7% as the circuit breaker returns a graceful fallback.' } }
    ],
    recommendation: 'Deploy a circuit breaker on the payment API call with a 2-second timeout and a fallback "retry later" response.'
  }
];

/* ── Default Policy ───────────────────────────────────── */

export const defaultPolicy = {
  id: 'remediation-gate',
  version: '2026.11',
  mode: 'standard',
  rules: [
    { id: 'causal-proof', label: 'Require causal improvement', description: 'Only approve an intervention when the target metric improves in the shadow cohort.', enabled: true },
    { id: 'blast-radius', label: 'Cap initial blast radius', description: 'Start experiments at 5% of traffic or less.', enabled: true },
    { id: 'audit-evidence', label: 'Persist decision evidence', description: 'Store the hypothesis, intervention, metrics, and outcome.', enabled: true }
  ]
};

/* ── Helpers ───────────────────────────────────────────── */

export const getScenario = id => scenarios.find(s => s.id === id) || scenarios[0];

/** Scenario letter labels (A, B, C, … H). */
export const scenarioLetter = index => String.fromCharCode(65 + index);
