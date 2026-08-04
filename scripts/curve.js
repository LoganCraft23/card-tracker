// The fitted value curve — shared by scripts/fit.js (which estimates the
// coefficients) and scripts/update.js (which evaluates them). Kept separate so
// neither has to import the other.
//
// Design matrix, per card:
//   [1, age, hinge(6), hinge(12), hinge(24), hinge(36), isUltra, isS, isB]
// The hinge terms make f(age) piecewise linear, free to bend at 6/12/24/36
// months rather than being forced into fixed phases. Baseline is a chase-tier
// card of an A-tier character at age 0.

export const KNOTS = [6, 12, 24, 36];
export const GROWTH_CLAMP = 0.6; // no fitted 12-month move beyond +/-60%

export function features(ageMonths, tier, char) {
  return [
    1,
    ageMonths,
    ...KNOTS.map((k) => Math.max(0, ageMonths - k)),
    tier === "ultra" ? 1 : 0,
    char === "S" ? 1 : 0,
    char === "B" ? 1 : 0,
  ];
}

export const curveAt = (coef, age, tier = "chase", char = "A") =>
  features(age, tier, char).reduce((s, v, i) => s + v * coef[i], 0);

/**
 * 12-month growth implied by the curve's own slope over the year ahead.
 * Tier and character shift the level, not the slope, so they cancel here —
 * they still matter for the price *level*, just not for this ratio.
 */
export function fittedGrowth(coef, ageMonths) {
  if (!Array.isArray(coef) || coef.length < 9) return null;
  const g = Math.exp(curveAt(coef, ageMonths + 12) - curveAt(coef, ageMonths)) - 1;
  if (!Number.isFinite(g)) return null;
  return Math.max(-GROWTH_CLAMP, Math.min(GROWTH_CLAMP, g));
}
