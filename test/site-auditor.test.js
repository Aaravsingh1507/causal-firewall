import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  normalizeTargetUrl,
  isBlockedHostname,
  normalizeHeaders,
  detectStack,
  extractHtmlInfo,
  evaluateFindings,
  computeAuditScores,
  generateStressTestScripts,
  buildFallbackPatches,
  auditToCausalScenario
} from '../src/domain/auditor-rules.js';
import { isPrivateIp, assertSafePublicUrl, auditWebsite } from '../src/domain/site-auditor.js';
import inspectHandler from '../api/inspect.js';
import { evaluateScenario } from '../src/domain/policy-engine.js';
import { defaultPolicy } from '../src/domain/fixtures.js';

/* ── 1. URL Normalization & Validation ──────────────────── */

test('normalizeTargetUrl handles bare domains and rejects dangerous schemes', () => {
  const u = normalizeTargetUrl('example.com/app');
  assert.equal(u.href, 'https://example.com/app');

  const stripped = normalizeTargetUrl('https://admin:secret@example.com/login');
  assert.equal(stripped.username, '');
  assert.equal(stripped.password, '');
  assert.equal(stripped.href, 'https://example.com/login');

  assert.throws(() => normalizeTargetUrl(''), /enter a website/i);
  assert.throws(() => normalizeTargetUrl('javascript:alert(1)'), /HTTP and HTTPS/i);
  assert.throws(() => normalizeTargetUrl('file:///etc/passwd'), /HTTP and HTTPS/i);
  assert.throws(() => normalizeTargetUrl('ftp://files.example.com'), /HTTP and HTTPS/i);
});

/* ── 2. SSRF Protection Tests ───────────────────────────── */

test('isPrivateIp blocks private, loopback, metadata, CGNAT, and mapped IPv6 addresses', () => {
  const blocked = [
    '127.0.0.1', '127.255.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.254',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1'
  ];
  for (const ip of blocked) {
    assert.equal(isPrivateIp(ip), true, `Expected ${ip} to be blocked as private/reserved`);
  }

  const publicIps = ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'];
  for (const ip of publicIps) {
    assert.equal(isPrivateIp(ip), false, `Expected ${ip} to be allowed as public`);
  }
});

test('isBlockedHostname and assertSafePublicUrl reject internal targets', async () => {
  assert.equal(isBlockedHostname('localhost'), true);
  assert.equal(isBlockedHostname('metadata.google.internal'), true);
  assert.equal(isBlockedHostname('api.internal'), true);
  assert.equal(isBlockedHostname('printer.local'), true);
  assert.equal(isBlockedHostname('causal-firewall-main.vercel.app'), false);

  await assert.rejects(() => assertSafePublicUrl(new URL('http://127.0.0.1:8080')), /Blocked/i);
  await assert.rejects(() => assertSafePublicUrl(new URL('http://169.254.169.254/latest/meta-data/')), /Blocked/i);
  await assert.rejects(() => assertSafePublicUrl(new URL('http://localhost:3000')), /Blocked/i);
});

/* ── 3. HTML & Security Inspection ──────────────────────── */

test('extractHtmlInfo detects mixed content, tabnabbing, insecure forms, and redacts leaked secrets', () => {
  const dirtyHtml = `<!doctype html>
  <html>
    <head>
      <script src="http://cdn.insecure.example/lib.js"></script>
      <script src="https://cdn.example.com/app.js"></script>
    </head>
    <body>
      <img src="/logo.png">
      <a href="https://other.com" target="_blank">External</a>
      <form action="/login" method="get"><input type="password" name="pw"></form>
      <div>Debug key sk_live_1234567890abcdef1234 and SQLSTATE[42P01]: error</div>
    </body>
  </html>`;

  const info = extractHtmlInfo(dirtyHtml, 'https://myapp.com/');
  assert.equal(info.hasLang, false);
  assert.equal(info.hasViewport, false);
  assert.equal(info.title, '');
  assert.equal(info.imgsMissingAlt, 1);
  assert.equal(info.unsafeBlankLinks, 1);
  assert.equal(info.mixedContentItems.length, 1);
  assert.equal(info.scriptsMissingSri.length, 2);
  assert.equal(info.blockingHeadScripts.length, 2);
  assert.equal(info.insecureForms.length, 1);
  assert.equal(info.hasStackTraceLeak, true);
  assert.equal(info.leaks.length, 1);
  assert.ok(!info.leaks[0].includes('1234567890abcdef1234'), 'Secret value must be redacted in findings');
  assert.ok(info.leaks[0].includes('REDACTED'));
});

test('evaluateFindings & computeAuditScores score hardened vs unhardened configs deterministically', () => {
  const unhardened = evaluateFindings({
    finalUrl: 'http://example.com/',
    statusCode: 200,
    redirectChain: [],
    ttfbMs: 1400,
    byteSize: 20000,
    headersMap: { 'x-powered-by': 'Express' },
    setCookies: ['sid=abc123; Path=/'],
    htmlInfo: extractHtmlInfo('<html><body>Hello</body></html>', 'http://example.com/'),
    isHtmlResponse: true,
    assetChecks: [],
    burstStats: null
  });
  const badScores = computeAuditScores(unhardened);
  assert.ok(badScores.security < 60, `Expected low security score, got ${badScores.security}`);
  assert.ok(badScores.scalability < 80, `Expected penalized scalability score, got ${badScores.scalability}`);

  const { map, setCookies } = normalizeHeaders({
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'content-security-policy': "default-src 'self'",
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=()',
    'content-encoding': 'br',
    'cache-control': 'public, s-maxage=60',
    'x-vercel-cache': 'HIT',
    'set-cookie': 'sid=xyz; Path=/; HttpOnly; Secure; SameSite=Lax'
  });

  const cleanHtml = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><meta name="description" content="Fast app"><title>App</title></head><body><main>Hello world</main></body></html>';
  const hardened = evaluateFindings({
    finalUrl: 'https://example.com/',
    statusCode: 200,
    redirectChain: [],
    httpRedirectCheck: { redirectsToHttps: true, detail: 'http:// returned 308 -> https://example.com/' },
    ttfbMs: 85,
    byteSize: 12000,
    headersMap: map,
    setCookies,
    htmlInfo: extractHtmlInfo(cleanHtml, 'https://example.com/'),
    isHtmlResponse: true,
    assetChecks: [{ url: 'https://example.com/app.js', ok: true, status: 200, cacheControl: 'public, max-age=31536000' }],
    burstStats: { concurrency: 6, minMs: 40, avgMs: 65, p95Ms: 95, maxMs: 95, okCount: 6, rateLimited: 0, serverErrors: 0, timeouts: 0 }
  });
  const goodScores = computeAuditScores(hardened);
  assert.equal(goodScores.overall, 100);
  assert.equal(goodScores.grade, 'A');
  assert.equal(detectStack(map, cleanHtml)[0].name, 'Vercel');
});

/* ── 4. Live Local HTTP Server Audit + Broken Asset + Concurrency Burst ── */

test('auditWebsite performs real HTTP fetch, catches 404 JS asset, and measures 6x concurrency', async () => {
  let concurrentActive = 0;
  let burstTriggeredOverload = false;

  const server = http.createServer((req, res) => {
    if (req.url === '/missing.js') {
      res.writeHead(404, { 'Content-Type': 'application/javascript' });
      res.end('Not found');
      return;
    }
    if (req.url === '/style.css') {
      res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=31536000' });
      res.end('body { margin: 0; }');
      return;
    }

    concurrentActive++;
    setTimeout(() => {
      if (concurrentActive > 3) burstTriggeredOverload = true;
      concurrentActive--;
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Powered-By': 'Express'
      });
      res.end(`<!doctype html><html lang="en"><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="description" content="Test app">
        <title>Mock Site</title>
        <link rel="stylesheet" href="/style.css">
        <script src="/missing.js" defer></script>
      </head><body><h1>Mock Storefront</h1></body></html>`);
    }, 15);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const report = await auditWebsite(
      { url: `http://127.0.0.1:${port}/`, runBurst: true },
      { allowPrivate: true }
    );

    assert.equal(report.statusCode, 200);
    assert.ok(report.ttfbMs >= 0);
    assert.equal(report.burstStats.concurrency, 6);
    assert.equal(report.burstStats.okCount, 6);
    assert.equal(burstTriggeredOverload, true, 'Burst probe genuinely executed requests concurrently');

    const brokenFinding = report.findings.find(f => f.id === 'fn-broken-assets');
    assert.ok(brokenFinding, 'Must catch 404 /missing.js script failure');
    assert.equal(brokenFinding.severity, 'critical');

    const patch = buildFallbackPatches(report);
    assert.ok(patch.code.includes('helmet'), 'Express clue should yield Express middleware patch');

    const scripts = generateStressTestScripts(report.finalUrl);
    assert.ok(scripts.autocannonCmd.includes(`127.0.0.1:${port}`));
    assert.ok(scripts.k6Script.includes('stages'));

    // End-to-end integration with Causal Firewall policy engine
    const scenario = auditToCausalScenario(report);
    const evaluation = evaluateScenario(scenario, defaultPolicy, scenario.interventions[0].id);
    assert.equal(evaluation.decision, 'allow');
    assert.ok(evaluation.confidence > 0.7);
  } finally {
    server.close();
  }
});

test('auditWebsite flags server 503 crashes during 6x concurrency burst', async () => {
  let active = 0;
  const server = http.createServer((req, res) => {
    active++;
    const overCapacity = active > 2;
    setTimeout(() => {
      active--;
      if (overCapacity) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable: Connection pool exhausted');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html lang="en"><head><title>Fragile App</title></head><body>OK</body></html>');
      }
    }, 25);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const report = await auditWebsite(
      { url: `http://127.0.0.1:${port}/`, runBurst: true },
      { allowPrivate: true }
    );
    assert.ok(report.burstStats.serverErrors >= 1, 'Expected burst probe to detect 503 failures');
    const burstFailure = report.findings.find(f => f.id === 'scale-burst-failures');
    assert.ok(burstFailure, 'Expected critical scale-burst-failures finding');
    assert.equal(burstFailure.severity, 'critical');
  } finally {
    server.close();
  }
});

/* ── 5. Serverless Handler Guard Tests ──────────────────── */

test('/api/inspect handler rejects non-POST methods and SSRF URLs cleanly', async () => {
  const makeMockRes = () => {
    const headers = {};
    let body = '';
    return {
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      end: (chunk = '') => { body += chunk; },
      json: () => JSON.parse(body),
      headers
    };
  };

  const resGet = makeMockRes();
  await inspectHandler({ method: 'GET' }, resGet);
  assert.equal(resGet.statusCode, 405);

  const resSsrf = makeMockRes();
  await inspectHandler({ method: 'POST', body: { url: 'http://169.254.169.254/latest/meta-data/' } }, resSsrf);
  assert.equal(resSsrf.statusCode, 400);
  assert.match(resSsrf.json().error, /Blocked/i);

  const resEmpty = makeMockRes();
  await inspectHandler({ method: 'POST', body: {} }, resEmpty);
  assert.equal(resEmpty.statusCode, 400);
});
