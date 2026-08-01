// Daily sealed-product job — run by GitHub Actions (npm run sealed).
// One TCG API request per set (~16 of the 100/day free tier), filtered to
// collector formats, priced, scored, and written to docs/sealed.json.
//
// Skips cleanly if TCGAPI_KEY is absent so the cards pipeline never depends
// on it — a missing key means no sealed data, not a failed run.

import { readFileSync, writeFileSync } from "node:fs";
import { sealedForSet, quotaRemaining } from "./tcgapi.js";
import { analyzeSealed } from "./sealed-model.js";
import { SETS } from "./model.js";

const root = new URL("..", import.meta.url);
const readOr = (p, fb) => {
  try { return JSON.parse(readFileSync(new URL(p, root), "utf8")); } catch { return fb; }
};
const write = (p, data) => writeFileSync(new URL(p, root), JSON.stringify(data, null, 2));

if (!process.env.TCGAPI_KEY) {
  console.warn("TCGAPI_KEY not set — skipping sealed update.");
  process.exit(0);
}

const history = readOr("history/sealed-prices.json", {}); // { key: [[date, price], ...] }
const cards = readOr("docs/data.json", { cards: [] });

// Median tracked chase price per set — a relative read on how desirable a
// set's hits are, reused as a sealed input. Explicitly not an expected value.
const chaseBySet = {};
for (const setName of Object.keys(SETS)) {
  const prices = cards.cards.filter((c) => c.set === setName).map((c) => c.price).sort((a, b) => a - b);
  chaseBySet[setName] = prices.length ? prices[Math.floor(prices.length / 2)] : null;
}

const today = new Date().toISOString().slice(0, 10);
const out = [];
let calls = 0;

for (const setName of Object.keys(SETS)) {
  // Leave headroom so a retry or a manual run can't blow the daily budget.
  if (quotaRemaining() !== null && quotaRemaining() < 5) {
    console.warn(`quota nearly exhausted (${quotaRemaining()} left) — stopping early`);
    break;
  }
  let rows = [];
  try {
    rows = await sealedForSet(setName);
    calls++;
  } catch (e) {
    console.error(`sealed fetch failed for ${setName}: ${e.message}`);
    continue;
  }

  for (const item of rows) {
    const key = `${item.name} | ${item.set}`;
    const hist = (history[key] || []).filter(([d]) => d !== today);
    hist.push([today, item.price]);
    history[key] = hist.slice(-400);

    const a = analyzeSealed(item, history[key], chaseBySet[setName]);
    out.push({
      name: item.name, set: item.set, format: item.format,
      productId: item.productId, image: item.image,
      listings: item.listings, low: item.low,
      ...a,
      history: history[key].slice(-180),
    });
  }
  console.log(`${setName}: ${rows.length} sealed products`);
}

// Highest model upside first, discounted by how much we trust the quote.
const upside = (c) => ((c.proj[0] + c.proj[1]) / 2) / c.price - 1;
out.sort((a, b) => upside(b) * (0.5 + 0.5 * b.confidence) - upside(a) * (0.5 + 0.5 * a.confidence));

write("history/sealed-prices.json", history);
write("docs/sealed.json", { updated: new Date().toISOString(), products: out });

const bySignal = out.reduce((a, c) => ((a[c.signal] = (a[c.signal] || 0) + 1), a), {});
console.log(
  `\nSealed: ${out.length} products across ${calls} API calls ` +
  `(${quotaRemaining() ?? "?"} requests left today). Signals: ${JSON.stringify(bySignal)}`
);
