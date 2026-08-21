// Foil Theory — sealed product model.
//
// The lifecycle idea carries over from singles, but the mechanism is cleaner:
// a card's supply only ever grows as more packs are opened, whereas sealed
// supply *shrinks* — every box opened is one fewer box in existence. So the
// out-of-print phases get a stronger tailwind here than they do for cards.
//
// What does not carry over: rarity tier and character popularity. A booster
// box has neither. Format takes their place, and liquidity is measured
// directly from the listing count rather than inferred from a price spread.

import { getPhase, supplyEventEffect } from "./model.js";

// 12-month growth baseline by lifecycle phase. Compared with the singles
// model, hype-fade is gentler (sealed has an MSRP floor that singles lack) and
// recovery is stronger (supply is actively being destroyed by opening).
const PHASE_BASE = {
  "hype-fade": -0.14,
  "supply-trough": 0.02,
  recovery: 0.18,
  appreciation: 0.14,
};

// Boxes hold value best: most packs per unit, and they are what gets opened
// and destroyed. Retail formats churn — they are printed to hit price points
// and get discounted hard when a set is being cleared.
const FORMAT_ADJ = {
  "Booster Box": 0.06,
  "Elite Trainer Box": 0.02,
  "Booster Bundle": 0.0,
  Collection: -0.01,
  Blister: -0.05,
  "Booster Pack": -0.06,
};

// Formats a collector actually accumulates, versus retail impulse buys.
const CORE_FORMATS = new Set(["Booster Box", "Elite Trainer Box"]);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const BAND_TIGHT = 0.12, BAND_LOOSE = 0.45;

// Sealed listings are counted directly, so liquidity does not have to be
// guessed from price dispersion the way it does on the cards side.
export function confidence(price, item) {
  const flags = [];
  let score = 1;

  const n = item.listings;
  if (typeof n === "number") {
    if (n < 8) { score -= 0.35; flags.push("almost no listings"); }
    else if (n < 25) { score -= 0.15; }
  } else {
    score -= 0.12;
    flags.push("listing count unknown");
  }

  // A market price far above the lowest ask usually means junk or mislabelled
  // listings sitting under the real ones (an ETB "from $1.99" is an empty box,
  // not a deal), so a wide gap lowers trust rather than signalling a bargain.
  if (price && item.low) {
    const spread = Math.max(0, (price - item.low) / price);
    if (spread > 0.6) { score -= 0.3; flags.push("lowest listing looks like junk"); }
    else if (spread > 0.35) { score -= 0.12; }
  }

  return { score: clamp(score, 0, 1), flags };
}

// history: [[isoDate, price], ...] oldest first, from our own snapshots.
function momentum(price, history) {
  if (!history || history.length < 2) return null;
  const target = Date.now() - 30 * 86400e3;
  let best = null, bestDist = 12 * 86400e3;
  for (const [d, p] of history) {
    const dist = Math.abs(new Date(d).getTime() - target);
    if (dist < bestDist) { bestDist = dist; best = p; }
  }
  return best ? (price - best) / best : null;
}

/**
 * @param item   normalised sealed row from tcgapi.sealedForSet
 * @param history our own [[date, price]] snapshots for this product
 * @param chase  median price of this set's tracked chase cards, or null.
 *               A relative desirability read, NOT an expected value — a true
 *               EV needs per-slot pull rates, which no free source publishes.
 */
export function analyzeSealed(item, history, chase = null, supplyEvent = null) {
  const phase = getPhase({ set: item.set });
  const price = item.price;
  const mom = momentum(price, history);
  const reasons = [];
  const event = supplyEventEffect(supplyEvent);

  let growth = (PHASE_BASE[phase] ?? 0) + (FORMAT_ADJ[item.format] ?? 0);

  if (mom !== null && mom > 0.2) {
    growth -= mom * 0.5;
    reasons.push(`Up ${Math.round(mom * 100)}% in 30 days — sealed spikes on hype usually give part of it back.`);
  } else if (mom !== null && mom < -0.2 && !event) {
    growth += Math.abs(mom) * 0.3;
    reasons.push(`Down ${Math.round(Math.abs(mom) * 100)}% in 30 days — oversold sealed tends to bounce off its floor.`);
  } else if (mom !== null && mom < -0.2 && event) {
    // Sealed's core assumption is that supply only shrinks — a reprint or
    // restock breaks that directly, so a drop here isn't noise to bounce
    // back from, it's fresh boxes hitting the market.
    reasons.push(`Down ${Math.round(Math.abs(mom) * 100)}% in 30 days — consistent with the ${event.type} below, not treated as an oversold bounce.`);
  }

  if (event) {
    const penalty = (event.type === "reprint" ? 0.4 : event.type === "restock" ? 0.25 : 0.15) * event.strength;
    growth -= penalty;
    const note = event.note?.replace(/\.+$/, "");
    reasons.push(
      `${event.type === "reprint" ? "Reprint" : event.type === "restock" ? "Restock" : "Supply event"} confirmed ${event.date}` +
      `${note ? ` — ${note}` : ""}. Sealed's "supply only shrinks" assumption doesn't hold until this fades (~${event.decayMonths || 6} months out).`
    );
  }

  // A set whose chase cards are expensive keeps people opening its boxes,
  // which is what actually removes sealed supply from the market.
  if (chase !== null) {
    if (chase >= 40) { growth += 0.03; reasons.push(`Strong chase lineup (median tracked hit $${chase.toFixed(0)}) keeps boxes getting opened.`); }
    else if (chase > 0 && chase < 12) { growth -= 0.03; reasons.push(`Weak chase lineup (median tracked hit $${chase.toFixed(0)}) — less reason to open, so supply lingers.`); }
  }

  const conf = confidence(price, item);
  const inPrint = phase === "hype-fade" || phase === "supply-trough";

  let signal = "HOLD";
  if (mom !== null && mom >= 0.25) {
    signal = "SELL";
    reasons.push("Sell into the spike. Sealed runs like this rarely hold once the hype cycle turns.");
  } else if (inPrint && !CORE_FORMATS.has(item.format)) {
    signal = "AVOID";
    reasons.push("Retail format from an in-print set — these get discounted hard while the set is still on shelves.");
  } else if ((phase === "recovery" || phase === "appreciation") && CORE_FORMATS.has(item.format) && (mom === null || mom <= 0.08)) {
    signal = "BUY";
    reasons.push(
      phase === "recovery"
        ? "Out of print and still being opened — sealed supply only goes down from here."
        : "Long out of print. Survivor boxes get scarcer every year."
    );
  } else if (phase === "supply-trough" && item.format === "Booster Box") {
    signal = "BUY";
    reasons.push("Late in the print run and widely available — the classic window to accumulate boxes before it goes out of print.");
  } else if (!inPrint) {
    reasons.push("Out of print with real demand. Hold; add on dips rather than chasing.");
  } else {
    reasons.push("Still in print and freely available — no edge at current prices.");
  }

  // Every BUY branch above assumes sealed supply is shrinking on schedule —
  // exactly what a reprint or restock breaks. See model.js's analyze() for
  // the singles-side version of this same override.
  if (event && signal === "BUY") {
    signal = "AVOID";
    reasons.push(`Would otherwise be a BUY on phase alone, but the active ${event.type} overrides that — more supply is still landing.`);
  }

  const rationale = reasons[reasons.length - 1];

  if (event) {
    conf.score = Math.min(conf.score, 0.4);
    if (!conf.flags.includes(`active ${event.type}`)) conf.flags.push(`active ${event.type}`);
  }

  if (conf.flags.length) {
    reasons.push(`Price confidence is low (${conf.flags.join("; ")}) — the projection range is widened to match.`);
  }

  const proj12 = price * (1 + growth);
  const band = BAND_TIGHT + (1 - conf.score) * (BAND_LOOSE - BAND_TIGHT);
  return {
    phase, price, mom, signal, reasons, rationale,
    supplyEvent: event ? { type: event.type, date: event.date, strength: +event.strength.toFixed(2) } : null,
    confidence: +conf.score.toFixed(2), confidenceFlags: conf.flags,
    proj: [+(proj12 * (1 - band)).toFixed(2), +(proj12 * (1 + band)).toFixed(2)],
  };
}
