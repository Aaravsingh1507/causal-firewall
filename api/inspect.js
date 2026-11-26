/**
 * Vercel Serverless Function: POST /api/inspect
 *
 * Inspects a real public URL's HTTP status, headers, HTML health,
 * linked JS/CSS bundles, and bounded concurrency readiness.
 */

import { auditWebsite } from '../src/domain/site-auditor.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST /api/inspect.' }));
    return;
  }

  try {
    let body = req.body;
    if (!body || typeof body === 'string') {
      if (typeof body === 'string') {
        body = JSON.parse(body || '{}');
      } else {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString('utf8');
        body = raw ? JSON.parse(raw) : {};
      }
    }

    const url = body?.url;
    const runBurst = Boolean(body?.runBurst);

    if (!url || typeof url !== 'string') {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Missing required "url" field.' }));
      return;
    }

    const report = await auditWebsite({ url, runBurst }, { allowPrivate: false });
    res.statusCode = 200;
    res.end(JSON.stringify(report));
  } catch (err) {
    const msg = err?.message || 'Failed to inspect website.';
    const isClientError = /Invalid URL|Missing required|Only HTTP|Blocked|Please enter|DNS lookup failed|No DNS records/i.test(msg);
    res.statusCode = isClientError ? 400 : 502;
    res.end(JSON.stringify({ error: msg }));
  }
}
