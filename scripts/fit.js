// Fits the value curve from data instead of from my priors:  npm run fit
// (runs daily in the Action, right after the screener captures the sample)
//
// THE IDEA. Every morning the screener prices ~1,000 secret rares from sets
// released between 2023 and 2026. That is a synthetic cohort: the same kind of
// object observed at many different ages on a single day. So the shape of the
// value curve can be recovered from one snapshot — age variation comes from
// sets having different release dates, not from waiting around.
//
// THE MODEL.
//     log(price) = f(ageMonths) + tier effect + character effect + noise
// f is piecewise linear with knots at 6/12/24/36 months, built from hinge
// terms, so the curve can bend where the market actually bends rather than
// being forced into the four fixed phases I hardcoded. Projected 12-month
// growth for a card is then just  exp(f(age+12) - f(age)) - 1  — the curve's
// own slope over the year ahead, per rarity and character tier.
//
// WHAT IS AND IS NOT IDENTIFIED — the important part.
//
// Every set sits at exactly one age, and no two sets share an age (verified:
// 16 sets, 16 distinct ages, zero overlap). So in a single snapshot the age
// terms are perfectly collinear with set identity: the "age curve" is 16 set
// fixed effects relabelled. It cannot distinguish "cards fall with age" from
// "these particular old sets are cheap", and it duly reports a steady decline
// with no recovery — the opposite of the thesis — because our oldest sets are
// only just reaching the age where recovery would begin.
//   => the age curve is reported but marked unidentified, and never promoted.
//
// Character and rarity ARE identified, because they vary *within* every set
// (151 alone has 42 cards across 3 character tiers and 2 rarity tiers). Those
// coefficients are real measurements of what the market pays.
//
// Note they measure price *levels*, not growth: Charizard being worth 5x a
// Bidoof says nothing about which appreciates faster. Identifying growth needs
// the same card observed as it ages — a time series, not a snapshot — which is
// what `withinCard` below accumulates.
//
// Nothing here touches the live signals. Both models are logged daily and
// scored against each other by score.js; promotion is a deliberate switch.

import { readFileSync, writeFileSync } from "node:fs";
import { SETS, monthsSince } from "./model.js";
import { KNOTS, features, curveAt, fittedGrowth } from "./curve.js";

const root = new URL("..", import.meta.url);
const readOr = (p, fb) => {
  try { return JSON.parse(readFileSync(new URL(p, root), "utf8")); } catch { return fb; }
};
const write = (p, data) => writeFileSync(new URL(p, root), JSON.stringify(data, null, 2));

const RIDGE = 1e-6;     // numerical stability only, not real regularisation
const MIN_SAMPLE = 200; // below this the fit is not trustworthy enough to publish

// --- tiny linear algebra (no dependencies) --------------------------------
// Solves (XtX + ridge*I) b = Xty by Gauss-Jordan with partial pivoting.
export function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null; // singular
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

export function ols(X, y, ridge = RIDGE) {
  const n = X.length, p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b2 = a; b2 < p; b2++) XtX[a][b2] += X[i][a] * X[i][b2];
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b2 = 0; b2 < a; b2++) XtX[a][b2] = XtX[b2][a];
    XtX[a][a] += ridge;
  }
  return solve(XtX, Xty);
}

// --- run ------------------------------------------------------------------
{
  const sample = readOr("history/cross-section.json", { cards: [] }).cards;
  const now = new Date();

  const rows = [];
  for (const c of sample) {
    const info = SETS[c.set];
    if (!info || !c.price || c.price <= 0) continue;
    const age = monthsSince(info.release, now);
    if (age < 0 || age > 60) continue;
    rows.push({ age, tier: c.tier, char: c.char, y: Math.log(c.price) });
  }

  if (rows.length < MIN_SAMPLE) {
    write("docs/model-fit.json", {
      fitted: false, n: rows.length,
      reason: `only ${rows.length} usable rows; need ${MIN_SAMPLE}`,
      updated: now.toISOString(),
    });
    console.log(`Not enough data to fit (${rows.length} rows) — keeping hand-set priors.`);
    process.exit(0);
  }

  const X = rows.map((r) => features(r.age, r.tier, r.char));
  const y = rows.map((r) => r.y);
  const coef = ols(X, y);

  if (!coef || coef.some((v) => !Number.isFinite(v))) {
    write("docs/model-fit.json", { fitted: false, n: rows.length, reason: "singular design matrix", updated: now.toISOString() });
    console.log("Fit failed (singular) — keeping hand-set priors.");
    process.exit(0);
  }

  // Goodness of fit, in log space.
  const yBar = y.reduce((a, b) => a + b, 0) / y.length;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < rows.length; i++) {
    const pred = X[i].reduce((s, v, j) => s + v * coef[j], 0);
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - yBar) ** 2;
  }
  const r2 = 1 - ssRes / ssTot;
  const residSd = Math.sqrt(ssRes / (rows.length - coef.length));

  // The deliverable: 12-month growth implied by the curve's own slope, by age.
  const growthAt = (age) => fittedGrowth(coef, age);
  const byAge = {};
  for (let a = 0; a <= 48; a += 3) byAge[a] = +growthAt(a).toFixed(4);

  const ages = rows.map((r) => r.age);
  const counts = rows.reduce((acc, r) => {
    acc.tier[r.tier] = (acc.tier[r.tier] || 0) + 1;
    acc.char[r.char] = (acc.char[r.char] || 0) + 1;
    return acc;
  }, { tier: {}, char: {} });

  // --- the properly identified age estimate: same card, observed ageing ----
  // Cross-sectional age is confounded with set identity, so the honest way to
  // learn a growth curve is within-card change over time. This accumulates
  // from our own snapshots and reports its status until there is enough.
  const MIN_DAYS = 25, MIN_CARDS = 40;
  const priceHist = readOr("history/prices.json", {});
  const watch = readOr("watchlist.json", { cards: [] }).cards;
  const setOf = new Map(watch.map((c) => [`${c.name} | ${c.set}`, c.set]));
  const buckets = {};
  let usable = 0, maxSpanDays = 0;
  for (const [key, series] of Object.entries(priceHist)) {
    if (!Array.isArray(series) || series.length < 2) continue;
    const first = series[0], last = series[series.length - 1];
    const days = (new Date(last[0]) - new Date(first[0])) / 86400e3;
    maxSpanDays = Math.max(maxSpanDays, days);
    if (days < MIN_DAYS || !first[1] || !last[1]) continue;
    const set = setOf.get(key);
    const info = set && SETS[set];
    if (!info) continue;
    usable++;
    const annualised = Math.pow(last[1] / first[1], 365 / days) - 1;
    const age = Math.round(monthsSince(info.release, now) / 6) * 6; // 6-month buckets
    (buckets[age] ??= []).push(annualised);
  }
  const withinCard = {
    status: usable >= MIN_CARDS ? "estimated" : "accumulating",
    usableCards: usable,
    longestSpanDays: Math.round(maxSpanDays),
    needs: `${MIN_CARDS} cards with ${MIN_DAYS}+ days of history`,
    growthByAgeBucket: Object.fromEntries(
      Object.entries(buckets)
        .filter(([, v]) => v.length >= 8)
        .map(([age, v]) => [age, { n: v.length, medianAnnualised: +v.sort((a, b) => a - b)[Math.floor(v.length / 2)].toFixed(4) }])
    ),
  };

  write("docs/model-fit.json", {
    fitted: true,
    updated: now.toISOString(),
    identified: {
      characterAndRarity: true,
      ageCurve: false,
      why: "Each set sits at exactly one age, so cross-sectional age terms are collinear with set identity. Character and rarity vary within sets, so those effects are measurable.",
    },
    withinCard,
    n: rows.length,
    r2: +r2.toFixed(4),
    residSd: +residSd.toFixed(4),
    ageRange: [Math.min(...ages), Math.max(...ages)],
    counts,
    knots: KNOTS,
    coef,
    // Multiplicative effects, easier to read than log coefficients.
    effects: {
      ultraVsChase: +(Math.exp(coef[6]) - 1).toFixed(4),
      sVsA: +(Math.exp(coef[7]) - 1).toFixed(4),
      bVsA: +(Math.exp(coef[8]) - 1).toFixed(4),
    },
    // Reported for the record and for shadow scoring — NOT a usable forecast.
    ageCurveUnidentified: true,
    growth12moByAgeMonths: byAge,
  });

  console.log(`Fitted on ${rows.length} cards (ages ${Math.min(...ages)}-${Math.max(...ages)} months), R2=${r2.toFixed(3)}, resid sd=${residSd.toFixed(3)}`);
  console.log(`  ultra vs chase ${(Math.exp(coef[6]) - 1) * 100 >= 0 ? "+" : ""}${((Math.exp(coef[6]) - 1) * 100).toFixed(0)}%,` +
              ` S vs A ${((Math.exp(coef[7]) - 1) * 100).toFixed(0)}%, B vs A ${((Math.exp(coef[8]) - 1) * 100).toFixed(0)}%`);
  console.log("  [unidentified] cross-sectional age curve:", [0, 6, 12, 24, 36].map((a) => `${a}mo ${(growthAt(a) * 100).toFixed(0)}%`).join("  "));
  console.log(`  within-card growth: ${withinCard.status} — ${withinCard.usableCards} cards usable, longest span ${withinCard.longestSpanDays}d (needs ${withinCard.needs})`);
}
