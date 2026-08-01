// Slab & Signal — pricing model
// Same logic as the chat artifact, adapted to run on real daily snapshots.

export const SETS = {
  "151": { release: "2023-09", inPrint: true },
  "Obsidian Flames": { release: "2023-08", inPrint: false },
  "Paradox Rift": { release: "2023-11", inPrint: false },
  "Paldean Fates": { release: "2024-01", inPrint: false },
  "Temporal Forces": { release: "2024-03", inPrint: false },
  "Twilight Masquerade": { release: "2024-05", inPrint: false },
  "Shrouded Fable": { release: "2024-08", inPrint: false },
  "Stellar Crown": { release: "2024-09", inPrint: false },
  "Journey Together": { release: "2025-03", inPrint: true },
  "Destined Rivals": { release: "2025-05", inPrint: true },
  "Black Bolt / White Flare": { release: "2025-07", inPrint: true },
  "Mega Evolution": { release: "2025-09", inPrint: true },
  "Phantasmal Flames": { release: "2025-11", inPrint: true },
  "Ascended Heroes": { release: "2026-01", inPrint: true },
  "Chaos Rising": { release: "2026-05", inPrint: true },
  "Pitch Black": { release: "2026-07", inPrint: true },
};

const PHASE_BASE = {
  "hype-fade": -0.22,
  "supply-trough": -0.04,
  recovery: 0.14,
  appreciation: 0.11,
};

const TIER_ADJ = { chase: 0.08, ultra: -0.08, holo: -0.16 };
const CHAR_ADJ = { S: 0.05, A: 0.01, B: -0.03 };

export function monthsSince(dateStr, now = new Date()) {
  if (!dateStr) return 0;
  const [y, m] = dateStr.split("-").map(Number);
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
}

export function getPhase(card, now = new Date()) {
  const setInfo = SETS[card.set] || { release: card.release, inPrint: card.inPrint };
  const mo = monthsSince(setInfo.release, now);
  if (setInfo.inPrint) return mo < 8 ? "hype-fade" : "supply-trough";
  return mo < 36 ? "recovery" : "appreciation";
}

function pct(a, b) {
  if (!a || !b) return null;
  return (a - b) / b;
}

// history: array of [isoDate, price] snapshots, oldest first.
// Returns the snapshot closest to `days` ago (within a +/- 10 day window).
export function priceDaysAgo(history, days, now = Date.now()) {
  const target = now - days * 86400e3;
  let best = null;
  let bestDist = 10 * 86400e3;
  for (const [date, price] of history) {
    const dist = Math.abs(new Date(date).getTime() - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = price;
    }
  }
  return best;
}

// --- momentum from the second market -------------------------------------
// The tracker's own snapshots give exact point-to-point change, but only once
// it has been running a month. Cardmarket's figures cover the gap from day one.
//
// Which figures matter. avg1/avg7/avg30 are averages of *actual sales*, so on
// a card that sells a couple of copies a week avg7 is a two-sale average and
// jumps around wildly — differencing it against avg30 mostly measures sampling
// noise. `trend` is Cardmarket's own smoothed current-value estimate and is
// far steadier, so momentum is built on trend vs the 30-day average.
//
// Lag: trend is roughly "now" and a 30-day trailing average is centred ~15
// days back, so the gap spans about half a month — scaling by 2 puts it on the
// same footing as a point-to-point 30-day reading.
const TREND_LAG_SCALE = 2.0;
const MOM_CAP = 0.6;          // a real monthly move on these cards isn't beyond this
const ESTIMATE_MARGIN = 1.2;  // demand a wider move before acting on an estimate

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// How much the short averages disagree with the monthly one — a direct read on
// how few sales sit behind each number. Near 0 means a liquid, well-sampled
// card; above ~0.6 means the quotes are near-meaningless.
export function salesNoise(market) {
  const a1 = market?.cmAvg1, a7 = market?.cmAvg7, a30 = market?.cmAvg30;
  if (!a1 || !a7 || !a30) return null;
  return (Math.abs(a1 - a30) + Math.abs(a7 - a30)) / (2 * a30);
}

export function marketMomentum(market) {
  const t = market?.cmTrend, a30 = market?.cmAvg30;
  if (!t || !a30) return null;
  // A ratio of two EUR figures — unitless, so no FX conversion needed.
  const raw = ((t - a30) / a30) * TREND_LAG_SCALE;
  // Shrink toward zero when the sales data is thin, so noise can't fire a
  // signal on its own. A card with noise 1.0 gets its reading halved.
  const noise = salesNoise(market);
  const shrink = noise === null ? 0.6 : 1 / (1 + noise);
  return clamp(raw * shrink, -MOM_CAP, MOM_CAP);
}

// --- how much to trust the quoted price -----------------------------------
// A "market price" derived from a handful of thin listings deserves a wider
// projection than one where both markets and the whole listing pool agree.
// Returns { score 0..1, flags[] }.
export function confidence(price, market, eurUsd = 1.08) {
  const flags = [];
  let score = 1;

  const low = market?.low;
  if (price && low) {
    // Spread of the listing pool behind the quote. Healthy singles sit well
    // under 30%; a wide gap means the "market" is a couple of outlier asks.
    const spread = Math.max(0, (price - low) / price);
    if (spread > 0.45) { score -= 0.35; flags.push("wide listing spread"); }
    else if (spread > 0.28) { score -= 0.15; }
  } else {
    score -= 0.15;
    flags.push("no listing depth");
  }

  const cm30 = market?.cmAvg30;
  if (price && cm30) {
    // Two independent markets (US/EU) should roughly agree once converted.
    const div = Math.abs(cm30 * eurUsd - price) / price;
    if (div > 0.5) { score -= 0.3; flags.push("US and EU prices disagree"); }
    else if (div > 0.28) { score -= 0.12; }
  } else {
    score -= 0.1;
    flags.push("single market only");
  }

  // Erratic short-window averages mean very few sales back the quote.
  const noise = salesNoise(market);
  if (noise !== null) {
    if (noise > 0.6) { score -= 0.3; flags.push("thin, erratic sales"); }
    else if (noise > 0.3) { score -= 0.12; }
  }

  return { score: Math.max(0, Math.min(1, score)), flags };
}

// Band half-width: confident cards get a tight range, thin ones an honestly
// wide one, instead of a flat ±20% that implies precision nobody has.
const BAND_TIGHT = 0.12, BAND_LOOSE = 0.45;

export function analyze(card, price, history, market = null, eurUsd = 1.08) {
  const phase = getPhase(card);
  const p30 = priceDaysAgo(history, 30);
  const p90 = priceDaysAgo(history, 90);
  const p180 = priceDaysAgo(history, 180);
  const chg30 = pct(price, p30);
  const chg90 = pct(price, p90);
  const chg180 = pct(price, p180);

  // Prefer measured history; fall back to the estimate so the momentum rules
  // are live from day one rather than dormant for a month.
  const estimated = chg30 === null;
  const mom = estimated ? marketMomentum(market) : chg30;
  const momSource = chg30 !== null ? "history" : mom !== null ? "cardmarket" : "none";
  const margin = estimated ? ESTIMATE_MARGIN : 1;

  let growth = PHASE_BASE[phase] + TIER_ADJ[card.tier || "chase"] + CHAR_ADJ[card.char || "A"];
  const reasons = [];

  const via = estimated ? " (from Cardmarket 7d vs 30d averages)" : "";
  if (mom !== null && mom > 0.2 * margin) {
    growth -= mom * 0.5;
    reasons.push(`Up ~${Math.round(mom * 100)}% over the last month${via} — spikes like this usually give back a chunk.`);
  } else if (mom !== null && mom < -0.2 * margin) {
    growth += Math.abs(mom) * 0.3;
    reasons.push(`Down ~${Math.round(Math.abs(mom) * 100)}% over the last month${via} — oversold moves partially bounce.`);
  }

  const conf = confidence(price, market, eurUsd);
  const proj12 = price * (1 + growth);
  const inPrint = (SETS[card.set] || card).inPrint;
  const tier = card.tier || "chase";
  const chr = card.char || "A";

  let signal = "HOLD";
  if (mom !== null && mom >= 0.25 * margin) {
    signal = "SELL";
    reasons.push("Sell into hype. Big monthly spikes on singles rarely hold — take the exit the market is offering.");
  } else if (inPrint && tier !== "chase") {
    signal = "AVOID";
    reasons.push("Standard hits from in-print sets keep bleeding as packs get opened.");
  } else if (
    (phase === "supply-trough" || phase === "hype-fade") &&
    tier === "chase" && chr !== "B" &&
    (mom === null || mom <= 0.05 * margin)
  ) {
    signal = "BUY";
    reasons.push(
      phase === "supply-trough"
        ? "Chase card on a popular Pokemon at the supply trough — the classic accumulation window before the set goes out of print."
        : "Chase card still fading with print supply. Ladder in on the way down rather than all at once."
    );
  } else if (
    phase === "recovery" && tier === "chase" && chr !== "B" &&
    (mom === null || mom <= 0.08 * margin)
  ) {
    signal = "BUY";
    reasons.push("Out of print under three years — sealed supply is drying up and the floor is rising.");
  } else if (!inPrint && tier === "chase") {
    signal = "HOLD";
    reasons.push("Out of print with real collector demand. Hold, and add on dips rather than chasing green days.");
  } else {
    reasons.push("No strong edge either way at current price.");
  }

  // Grab this before the confidence caveat is appended — it's what the signal
  // actually rests on, and what the Discord alert quotes.
  const rationale = reasons[reasons.length - 1];

  if (conf.flags.length) {
    reasons.push(`Price confidence is low (${conf.flags.join("; ")}) — the projection range is widened to match.`);
  }

  const band = BAND_TIGHT + (1 - conf.score) * (BAND_LOOSE - BAND_TIGHT);
  return {
    phase, price, chg30, chg90, chg180, signal, reasons, rationale,
    mom, momSource,
    confidence: +conf.score.toFixed(2), confidenceFlags: conf.flags,
    proj: [+(proj12 * (1 - band)).toFixed(2), +(proj12 * (1 + band)).toFixed(2)],
  };
}
