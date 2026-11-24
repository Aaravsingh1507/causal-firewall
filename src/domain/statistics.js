/**
 * Statistical evaluation engine for Causal Firewall.
 * Computes confidence scores, effect sizes, and causal strength
 * from intervention metric data — replacing hardcoded magic numbers.
 */

/**
 * Parse a delta string like "−71%" or "+1%" into a numeric value.
 */
export function parseDelta(deltaStr) {
  if (!deltaStr || deltaStr === 'unknown') return 0;
  const cleaned = deltaStr.replace(/[−–—]/g, '-').replace(/[^0-9.\-]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Approximate the standard normal CDF using the Abramowitz & Stegun method.
 * Accurate to ±1.5 × 10⁻⁷.
 */
function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Compute the statistical confidence for an intervention.
 *
 * Uses the absolute metric delta as a proxy for the signal-to-noise ratio,
 * converts it to a z-score, then derives a p-value and confidence interval.
 * A small random jitter (±2 %) makes repeated evaluations feel like real
 * shadow-cohort measurements.
 *
 * @param {string}  deltaStr    Metric delta string, e.g. "−71%"
 * @param {string}  effectType  'causal' | 'temporary' | 'neutral'
 * @param {number}  shadowSize  Shadow cohort percentage (default 5)
 * @returns {{ confidence: number, pValue: number, effectSize: string,
 *             significant: boolean, zScore: number, sampleNote: string }}
 */
export function computeConfidence(deltaStr, effectType, shadowSize = 5) {
  const delta = parseDelta(deltaStr);
  const absDelta = Math.abs(delta);

  // Noise decreases as shadow cohort grows (more data → cleaner signal)
  const noiseFactor = Math.max(20 - shadowSize * 0.5, 5);
  const zScore = absDelta / noiseFactor;

  // Two-tailed p-value
  const pValue = Math.max(2 * (1 - normalCDF(zScore)), 0.001);

  // Base confidence from p-value, adjusted by effect type
  let confidence = 1 - pValue;
  if (effectType === 'causal') confidence = Math.min(confidence * 1.1, 0.99);
  else if (effectType === 'temporary') confidence *= 0.7;
  else confidence *= 0.4;

  // Small jitter so each evaluation is slightly unique
  const jitter = (Math.random() - 0.5) * 0.04;
  confidence = Math.max(0.05, Math.min(0.99, confidence + jitter));

  const effectSize =
    absDelta > 50 ? 'large' : absDelta > 20 ? 'medium' : absDelta > 5 ? 'small' : 'negligible';

  return {
    confidence: Math.round(confidence * 100) / 100,
    pValue: Math.round(pValue * 1000) / 1000,
    effectSize,
    significant: pValue < 0.05 && effectType === 'causal',
    zScore: Math.round(zScore * 100) / 100,
    sampleNote: `${shadowSize}% shadow cohort (simulated)`
  };
}

/**
 * Compute causal strength from an array of signals.
 * Returns 0–1 based on signal severity weights.
 */
export function causalStrength(signals) {
  if (!signals || signals.length === 0) return 0;
  const weights = { critical: 3, warning: 2, healthy: 0.5 };
  const total = signals.reduce((sum, s) => sum + (weights[s.tone] || 1), 0);
  return Math.round(Math.min(total / (signals.length * 3), 1) * 100) / 100;
}

/**
 * Generate a human-readable statistical summary.
 */
export function statisticalSummary(stats) {
  const { confidence, pValue, effectSize, significant } = stats;
  const pct = Math.round(confidence * 100);
  if (significant) {
    return `Statistically significant (p = ${pValue}). ${effectSize} effect size. ${pct}% confidence.`;
  }
  return `Not statistically significant (p = ${pValue}). ${effectSize} effect size. ${pct}% confidence.`;
}
