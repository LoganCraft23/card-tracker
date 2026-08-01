// Grades the model against what actually happened:  npm run score
// (also runs daily in the GitHub Action, after the price update)
//
// Every run of update.js logs what the model claimed — price, projected range,
// signal — into history/predictions.json. This reads those old entries back,
// finds what the card was really worth 30/90/180 days later, and scores them.
//
// The number that matters is the comparison against the naive baseline. A
// "price stays exactly flat" forecast is surprisingly hard to beat on
// collectibles; if the model's error isn't lower than the baseline's, the
// phase/tier/character machinery is decoration and no amount of extra
// criteria will fix that. Everything else here is diagnostics.

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readOr = (p, fallback) => {
  try { return JSON.parse(readFileSync(new URL(p, root), "utf8")); } catch { return fallback; }
};
const write = (p, data) => writeFileSync(new URL(p, root), JSON.stringify(data, null, 2));

const predictions = readOr("history/predictions.json", {});
const priceHistory = readOr("history/prices.json", {});

const HORIZONS = [30, 90, 180];
const DAY = 86400e3;
const TOLERANCE = 7 * DAY; // a snapshot within a week of the target date counts

// Closest snapshot to `whenMs`, or null if nothing lands close enough.
function priceOn(history, whenMs) {
  let best = null, bestDist = TOLERANCE;
  for (const [date, price] of history || []) {
    const dist = Math.abs(new Date(date).getTime() - whenMs);
    if (dist <= bestDist) { bestDist = dist; best = price; }
  }
  return best;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pctOf = (n, d) => (d ? n / d : null);

const results = {};
const signalReturns = {}; // signal -> [realized return]

for (const horizon of HORIZONS) {
  const modelErr = [], naiveErr = [], hits = [], dirHits = [];

  for (const [key, log] of Object.entries(predictions)) {
    const hist = priceHistory[key];
    if (!hist) continue;

    for (const entry of log) {
      const madeAt = new Date(entry.d).getTime();
      // A 12-month projection sampled at 30 days is only 1/12 realized, so
      // compare against the straight-line share of the move to that date.
      const realized = priceOn(hist, madeAt + horizon * DAY);
      if (realized === null || !entry.p) continue;

      const mid = (entry.lo + entry.hi) / 2;
      const fraction = horizon / 365;
      const expected = entry.p + (mid - entry.p) * fraction;

      modelErr.push(Math.abs(pctOf(realized - expected, entry.p)));
      naiveErr.push(Math.abs(pctOf(realized - entry.p, entry.p)));

      // Did the outcome land inside the band, scaled to this horizon?
      const lo = entry.p + (entry.lo - entry.p) * fraction;
      const hi = entry.p + (entry.hi - entry.p) * fraction;
      hits.push(realized >= lo && realized <= hi ? 1 : 0);

      // Direction only: did it move the way the model leaned?
      const predUp = mid > entry.p, actUp = realized > entry.p;
      if (Math.abs(realized - entry.p) / entry.p > 0.02) dirHits.push(predUp === actUp ? 1 : 0);

      if (horizon === 90 && entry.s) {
        (signalReturns[entry.s] ||= []).push(pctOf(realized - entry.p, entry.p));
      }
    }
  }

  results[horizon] = {
    samples: modelErr.length,
    modelMAPE: modelErr.length ? +(mean(modelErr) * 100).toFixed(2) : null,
    naiveMAPE: naiveErr.length ? +(mean(naiveErr) * 100).toFixed(2) : null,
    bandHitRate: hits.length ? +(mean(hits) * 100).toFixed(1) : null,
    directionAccuracy: dirHits.length ? +(mean(dirHits) * 100).toFixed(1) : null,
  };
  const r = results[horizon];
  r.beatsNaive =
    r.modelMAPE !== null && r.naiveMAPE !== null ? r.modelMAPE < r.naiveMAPE : null;
}

const bySignal = {};
for (const [sig, rets] of Object.entries(signalReturns)) {
  bySignal[sig] = { n: rets.length, avgReturn90d: +(mean(rets) * 100).toFixed(2) };
}

const logged = Object.values(predictions).reduce((a, l) => a + l.length, 0);
const oldest = Object.values(predictions)
  .flat()
  .reduce((a, e) => (!a || e.d < a ? e.d : a), null);
const daysCollected = oldest
  ? Math.round((Date.now() - new Date(oldest).getTime()) / DAY)
  : 0;

const report = {
  generated: new Date().toISOString(),
  predictionsLogged: logged,
  daysCollected,
  horizons: results,
  bySignal,
};
write("docs/accuracy.json", report);

console.log(`Predictions logged: ${logged} across ${daysCollected} day(s) of history.`);
for (const h of HORIZONS) {
  const r = results[h];
  if (!r.samples) {
    console.log(`  ${h}d: no matured predictions yet (needs ${h} days of history).`);
    continue;
  }
  console.log(
    `  ${h}d: n=${r.samples} model MAPE ${r.modelMAPE}% vs naive ${r.naiveMAPE}% ` +
    `→ ${r.beatsNaive ? "model wins" : "NAIVE WINS — model adds no value at this horizon"}; ` +
    `band hit ${r.bandHitRate}%, direction ${r.directionAccuracy}%`
  );
}
if (Object.keys(bySignal).length) {
  console.log("  90d realized return by signal:", JSON.stringify(bySignal));
}
if (!logged || daysCollected < 30) {
  console.log(
    "\nToo early for a verdict — the first real scores land ~30 days after logging began."
  );
}
