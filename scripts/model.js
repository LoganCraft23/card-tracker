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

export function analyze(card, price, history) {
  const phase = getPhase(card);
  const p30 = priceDaysAgo(history, 30);
  const p90 = priceDaysAgo(history, 90);
  const p180 = priceDaysAgo(history, 180);
  const chg30 = pct(price, p30);
  const chg90 = pct(price, p90);
  const chg180 = pct(price, p180);

  let growth = PHASE_BASE[phase] + TIER_ADJ[card.tier || "chase"] + CHAR_ADJ[card.char || "A"];
  const reasons = [];

  if (chg30 !== null && chg30 > 0.2) {
    growth -= chg30 * 0.5;
    reasons.push(`Up ${Math.round(chg30 * 100)}% in 30 days — spikes like this usually give back a chunk.`);
  } else if (chg30 !== null && chg30 < -0.2) {
    growth += Math.abs(chg30) * 0.3;
    reasons.push(`Down ${Math.round(Math.abs(chg30) * 100)}% in 30 days — oversold moves partially bounce.`);
  }

  const proj12 = price * (1 + growth);
  const inPrint = (SETS[card.set] || card).inPrint;
  const tier = card.tier || "chase";
  const chr = card.char || "A";

  let signal = "HOLD";
  if (chg30 !== null && chg30 >= 0.25) {
    signal = "SELL";
    reasons.push("Sell into hype. Big 30-day spikes on singles rarely hold — take the exit the market is offering.");
  } else if (inPrint && tier !== "chase") {
    signal = "AVOID";
    reasons.push("Standard hits from in-print sets keep bleeding as packs get opened.");
  } else if (
    (phase === "supply-trough" || phase === "hype-fade") &&
    tier === "chase" && chr !== "B" &&
    (chg30 === null || chg30 <= 0.05)
  ) {
    signal = "BUY";
    reasons.push(
      phase === "supply-trough"
        ? "Chase card on a popular Pokemon at the supply trough — the classic accumulation window before the set goes out of print."
        : "Chase card still fading with print supply. Ladder in on the way down rather than all at once."
    );
  } else if (
    phase === "recovery" && tier === "chase" && chr !== "B" &&
    (chg30 === null || chg30 <= 0.08)
  ) {
    signal = "BUY";
    reasons.push("Out of print under three years — sealed supply is drying up and the floor is rising.");
  } else if (!inPrint && tier === "chase") {
    signal = "HOLD";
    reasons.push("Out of print with real collector demand. Hold, and add on dips rather than chasing green days.");
  } else {
    reasons.push("No strong edge either way at current price.");
  }

  return {
    phase, price, chg30, chg90, chg180, signal, reasons,
    proj: [+(proj12 * 0.8).toFixed(2), +(proj12 * 1.2).toFixed(2)],
  };
}
