/**
 * Live Server-Side Website & Webapp Auditor (Node.js / Vercel Serverless).
 *
 * Fetches real HTTP responses, headers, redirects, linked assets, and bounded
 * concurrency timing measurements with strict SSRF protection.
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import {
  normalizeTargetUrl,
  isBlockedHostname,
  normalizeHeaders,
  detectStack,
  extractHtmlInfo,
  evaluateFindings,
  computeAuditScores,
  generateStressTestScripts,
  buildFallbackPatches
} from './auditor-rules.js';

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 1_500_000; // 1.5 MB cap
const MAX_BURST_CONCURRENCY = 6;  // Hard-capped safe concurrency check
const USER_AGENT = 'CausalFirewall-SiteAuditor/1.0 (+https://causal-firewall-main.vercel.app)';

/**
 * Determine whether an IPv4 or IPv6 address belongs to a private, loopback,
 * link-local, metadata, multicast, or otherwise internal range.
 */
export function isPrivateIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return true;
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const family = net.isIP(ip);
  if (!family) return true;

  if (family === 4) {
    return isPrivateIpv4(ip);
  }

  // IPv6 checks
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // Unique local fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(ip) || /^fe[89ab][0-9a-f]$/i.test(ip)) return true; // Link-local fe80::/10
  if (ip.startsWith('ff')) return true; // Multicast ff00::/8

  // IPv4-mapped IPv6 addresses (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (ip.startsWith('::ffff:')) {
    const rest = ip.slice(7);
    if (net.isIP(rest) === 4) {
      return isPrivateIpv4(rest);
    }
    const hexParts = rest.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateIpv4(ipv4);
      }
    }
    return true;
  }

  return false;
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;

  if (a === 0) return true;                            // 0.0.0.0/8
  if (a === 10) return true;                           // 10.0.0.0/8 Private
  if (a === 100 && b >= 64 && b <= 127) return true;   // 100.64.0.0/10 CGNAT
  if (a === 127) return true;                          // 127.0.0.0/8 Loopback
  if (a === 169 && b === 254) return true;             // 169.254.0.0/16 Link-local & Cloud Metadata
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12 Private
  if (a === 192 && b === 0 && c === 0) return true;    // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true;    // TEST-NET-1
  if (a === 192 && b === 168) return true;             // 192.168.0.0/16 Private
  if (a === 198 && (b === 18 || b === 19)) return true;// Benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;  // TEST-NET-3
  if (a >= 224) return true;                           // Multicast & Reserved
  return false;
}

/**
 * Validate URL against SSRF (hostname + DNS resolution -> public IPs only).
 */
export async function assertSafePublicUrl(urlObj, allowPrivate = false) {
  const host = urlObj.hostname.replace(/^\[|\]$/g, '');

  if (allowPrivate) return;

  if (isBlockedHostname(host)) {
    throw new Error(`Blocked internal/restricted hostname: "${host}". Only public websites are allowed.`);
  }

  const ipType = net.isIP(host);
  if (ipType) {
    if (isPrivateIp(host)) {
      throw new Error(`Blocked private or reserved IP address: ${host}`);
    }
    return;
  }

  let resolved;
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch (err) {
    throw new Error(`DNS lookup failed for "${host}": ${err.code || err.message}`);
  }

  if (!resolved || resolved.length === 0) {
    throw new Error(`No DNS records found for "${host}".`);
  }

  for (const record of resolved) {
    if (isPrivateIp(record.address)) {
      throw new Error(`Hostname "${host}" resolved to restricted IP (${record.address}). Request blocked for security.`);
    }
  }
}

/**
 * Read response text safely up to MAX_BODY_BYTES to protect memory.
 */
async function readBoundedText(response, maxBytes = MAX_BODY_BYTES) {
  if (!response.body) return { text: '', byteSize: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        const remaining = maxBytes - total;
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        total = maxBytes;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {}

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(merged);
  return { text, byteSize: total, truncated };
}

/**
 * Fetch a URL manually following redirects up to MAX_REDIRECTS while checking
 * every intermediate hop against SSRF rules.
 */
async function safeFetchWithRedirects(startUrlObj, allowPrivate = false, timeoutMs = 9000) {
  let currentUrl = startUrlObj;
  const redirectChain = [];
  const overallStart = performance.now();
  let ttfbMs = 0;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafePublicUrl(currentUrl, allowPrivate);

    const hopStart = performance.now();
    const res = await fetch(currentUrl.href, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const hopLatency = Math.round(performance.now() - hopStart);
    if (hop === 0) ttfbMs = hopLatency;

    const isRedirect = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (isRedirect && hop < MAX_REDIRECTS) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      let nextUrl;
      try {
        nextUrl = normalizeTargetUrl(new URL(location, currentUrl).href);
      } catch {
        throw new Error(`Invalid redirect target returned by server: ${location}`);
      }
      redirectChain.push({ from: currentUrl.href, to: nextUrl.href, status: res.status, ms: hopLatency });
      currentUrl = nextUrl;
      continue;
    }

    // Final non-redirect response (also compute TTFB of final hop if redirected)
    if (hop > 0) ttfbMs = hopLatency;
    const { text, byteSize, truncated } = await readBoundedText(res);
    const totalMs = Math.round(performance.now() - overallStart);

    return {
      finalUrl: currentUrl.href,
      response: res,
      text,
      byteSize,
      truncated,
      redirectChain,
      ttfbMs,
      totalMs
    };
  }

  throw new Error(`Exceeded maximum redirect hops (${MAX_REDIRECTS}). Possible redirect loop.`);
}

/**
 * Verify if insecure HTTP cleanly redirects visitors to HTTPS.
 */
async function checkHttpToHttpsRedirect(httpsUrlObj, allowPrivate = false) {
  if (httpsUrlObj.protocol !== 'https:' || httpsUrlObj.port) return null;
  try {
    const httpUrl = new URL(httpsUrlObj.href);
    httpUrl.protocol = 'http:';
    await assertSafePublicUrl(httpUrl, allowPrivate);

    const res = await fetch(httpUrl.href, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(4000)
    });
    await res.body?.cancel().catch(() => {});

    const loc = res.headers.get('location') || '';
    const isHttpsRedirect = res.status >= 300 && res.status < 400 && loc.toLowerCase().startsWith('https://');
    return {
      redirectsToHttps: isHttpsRedirect,
      detail: isHttpsRedirect
        ? `http:// returned ${res.status} -> ${loc}`
        : `http:// returned HTTP ${res.status} without redirecting to https://`
    };
  } catch (err) {
    return {
      redirectsToHttps: false,
      detail: `Could not verify HTTP port 80 redirect (${err.name === 'TimeoutError' ? 'timeout' : 'unreachable/closed'})`
    };
  }
}

/**
 * Spot-check up to 6 critical linked JS/CSS assets to detect real 404/500 failures
 * and measure asset cache-control hygiene.
 */
async function spotCheckAssets(assetUrls = [], allowPrivate = false) {
  const unique = [...new Set(assetUrls)].slice(0, 6);
  if (unique.length === 0) return [];

  return Promise.all(unique.map(async (rawUrl) => {
    try {
      const u = normalizeTargetUrl(rawUrl);
      await assertSafePublicUrl(u, allowPrivate);
      let res = await fetch(u.href, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(4000)
      });
      await res.body?.cancel().catch(() => {});

      if (res.status === 405 || res.status === 501) {
        res = await fetch(u.href, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(4000)
        });
        await res.body?.cancel().catch(() => {});
      }

      return {
        url: u.href,
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        cacheControl: res.headers.get('cache-control') || ''
      };
    } catch (err) {
      return {
        url: rawUrl,
        ok: false,
        status: 0,
        error: err.message,
        cacheControl: ''
      };
    }
  }));
}

/**
 * Safe bounded concurrency mini-burst check (hard-capped at MAX_BURST_CONCURRENCY = 6).
 * Measures response time degradation and overload error rates without risking DoS.
 */
async function runBoundedBurstTest(targetUrl, allowPrivate = false) {
  const u = normalizeTargetUrl(targetUrl);
  await assertSafePublicUrl(u, allowPrivate);

  const count = MAX_BURST_CONCURRENCY;
  const tasks = Array.from({ length: count }, async () => {
    const t0 = performance.now();
    try {
      const res = await fetch(u.href, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate, br' },
        signal: AbortSignal.timeout(6000)
      });
      await res.body?.cancel().catch(() => {});
      const ms = Math.round(performance.now() - t0);
      return { status: res.status, ms, timedOut: false };
    } catch {
      const ms = Math.round(performance.now() - t0);
      return { status: 0, ms, timedOut: true };
    }
  });

  const results = await Promise.all(tasks);
  const latencies = results.map(r => r.ms).sort((a, b) => a - b);
  const minMs = latencies[0] || 0;
  const maxMs = latencies[latencies.length - 1] || 0;
  const avgMs = Math.round(latencies.reduce((s, n) => s + n, 0) / latencies.length);
  const p95Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
  const p95Ms = latencies[p95Idx] || maxMs;

  const okCount = results.filter(r => r.status >= 200 && r.status < 400).length;
  const rateLimited = results.filter(r => r.status === 429).length;
  const serverErrors = results.filter(r => r.status >= 500).length;
  const timeouts = results.filter(r => r.timedOut || r.status === 0).length;

  return {
    concurrency: count,
    minMs,
    avgMs,
    p95Ms,
    maxMs,
    okCount,
    rateLimited,
    serverErrors,
    timeouts
  };
}

/**
 * Full end-to-end real website audit.
 */
export async function auditWebsite({ url, runBurst = false }, { allowPrivate = false } = {}) {
  const targetUrlObj = normalizeTargetUrl(url);
  await assertSafePublicUrl(targetUrlObj, allowPrivate);

  const mainFetch = await safeFetchWithRedirects(targetUrlObj, allowPrivate);
  const { finalUrl, response, text, byteSize, truncated, redirectChain, ttfbMs, totalMs } = mainFetch;

  const { map: headersMap, setCookies } = normalizeHeaders(response.headers);
  const contentType = headersMap['content-type'] || '';
  const isHtmlResponse = /text\/html|application\/xhtml\+xml/i.test(contentType) || text.trim().startsWith('<');

  const htmlInfo = isHtmlResponse
    ? extractHtmlInfo(text, finalUrl)
    : {
        title: '', hasLang: false, hasViewport: false, description: '',
        externalScripts: [], stylesheets: [], blockingHeadScripts: [],
        scriptsMissingSri: [], mixedContentItems: [], imgsTotal: 0,
        imgsMissingAlt: 0, unsafeBlankLinks: 0, insecureForms: [],
        leaks: [], hasStackTraceLeak: false, stackTraceSample: null,
        thirdPartyOriginCount: 0, thirdPartyOrigins: [], isSpaShell: false, textLength: text.length
      };

  const stack = detectStack(headersMap, text);
  const finalUrlObj = new URL(finalUrl);

  // Run secondary checks in parallel: asset spot check + HTTP redirect check + optional 6x burst
  const assetsToSpotCheck = [...htmlInfo.stylesheets.slice(0, 3), ...htmlInfo.externalScripts.slice(0, 3)];
  const [assetChecks, httpRedirectCheck, burstStats] = await Promise.all([
    spotCheckAssets(assetsToSpotCheck, allowPrivate),
    checkHttpToHttpsRedirect(finalUrlObj, allowPrivate),
    runBurst ? runBoundedBurstTest(finalUrl, allowPrivate) : Promise.resolve(null)
  ]);

  const findings = evaluateFindings({
    finalUrl,
    statusCode: response.status,
    redirectChain,
    httpRedirectCheck,
    ttfbMs,
    byteSize,
    headersMap,
    setCookies,
    htmlInfo,
    isHtmlResponse,
    assetChecks,
    burstStats
  });

  const scores = computeAuditScores(findings);
  const stressScripts = generateStressTestScripts(finalUrl);

  const report = {
    auditedAt: new Date().toISOString(),
    inputUrl: targetUrlObj.href,
    finalUrl,
    statusCode: response.status,
    statusText: response.statusText || '',
    contentType,
    isHtmlResponse,
    ttfbMs,
    totalMs,
    byteSize,
    truncatedHtml: truncated,
    redirectChain,
    stack,
    headersSummary: {
      server: headersMap['server'] || null,
      cacheControl: headersMap['cache-control'] || null,
      contentEncoding: headersMap['content-encoding'] || null,
      cspPresent: !!headersMap['content-security-policy'],
      hstsPresent: !!headersMap['strict-transport-security'],
      xfo: headersMap['x-frame-options'] || null,
      nosniff: headersMap['x-content-type-options'] || null,
      referrerPolicy: headersMap['referrer-policy'] || null,
      permissionsPolicy: !!headersMap['permissions-policy'],
      cookieCount: setCookies.length
    },
    htmlSummary: {
      title: htmlInfo.title || null,
      isSpaShell: htmlInfo.isSpaShell,
      scriptsCount: htmlInfo.externalScripts.length,
      stylesheetsCount: htmlInfo.stylesheets.length,
      imgsTotal: htmlInfo.imgsTotal,
      imgsMissingAlt: htmlInfo.imgsMissingAlt,
      thirdPartyOriginCount: htmlInfo.thirdPartyOriginCount
    },
    assetChecks,
    burstStats,
    scores,
    findings,
    stressScripts
  };

  report.defaultPatch = buildFallbackPatches(report);
  return report;
}
