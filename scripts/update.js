// Daily job — run by GitHub Actions (or locally: npm run update)
// 1. Fetch today's market data for every resolved watchlist card
// 2. Append to history/prices.json (this builds real 30/90/180-day history)
// 3. Run the signal model
// 4. Log today's prediction so scripts/score.js can grade it later
// 5. Diff against yesterday's signals → Discord alert on changes
// 6. Write docs/data.json for the dashboard

import { readFileSync, writeFileSync } from "node:fs";
import { fetchCard, getEurUsd } from "./tcgdex.js";
import { analyze } from "./model.js";
import { sendDiscord } from "./notify.js";

const root = new URL("..", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const readOr = (p, fallback) => {
  try { return read(p); } catch { return fallback; }
};
const write = (p, data) => writeFileSync(new URL(p, root), JSON.stringify(data, null, 2));

const watchlist = read("watchlist.json");
const priceHistory = read("history/prices.json"); // { cardKey: [[date, price], ...] }
const prevSignals = read("history/signals.json"); // { cardKey: "BUY" | ... }
const predictions = readOr("history/predictions.json", {}); // { cardKey: [entry, ...] }

const eurUsd = await getEurUsd();
console.log(`EUR/USD ${eurUsd}`);

const today = new Date().toISOString().slice(0, 10);
const changes = [];
const dashboard = [];
const newSignals = {};

for (const card of watchlist.cards) {
  const key = `${card.name} | ${card.set}`;
  if (!card.id || card.unresolved) {
    console.warn(`skip (unresolved): ${key}`);
    continue;
  }

  let price = null;
  let image = card.image || null;
  let market = null;
  let productId = null;
  try {
    const detail = await fetchCard(card.id);
    price = detail.price;
    image = image || detail.image;
    market = detail.market;
    productId = detail.productId;
  } catch (e) {
    console.error(`fetch failed for ${key}: ${e.message}`);
  }
  if (price === null) {
    console.warn(`no price for ${key}`);
    continue;
  }

  const hist = priceHistory[key] || [];
  // one snapshot per day; overwrite if re-run same day
  const filtered = hist.filter(([d]) => d !== today);
  filtered.push([today, price]);
  // keep ~13 months of daily snapshots
  priceHistory[key] = filtered.slice(-400);

  const a = analyze(card, price, priceHistory[key], market, eurUsd);
  newSignals[key] = a.signal;

  // Log what the model claimed today so its accuracy can be measured later.
  // One entry per day; re-running the same day overwrites rather than stacks.
  const log = (predictions[key] || []).filter((e) => e.d !== today);
  log.push({
    d: today, p: price, lo: a.proj[0], hi: a.proj[1],
    s: a.signal, c: a.confidence, src: a.momSource,
  });
  predictions[key] = log.slice(-400);

  const prev = prevSignals[key];
  const actionable = a.signal === "BUY" || a.signal === "SELL";
  if (prev !== a.signal && (actionable || prev === "BUY" || prev === "SELL")) {
    changes.push({
      name: card.name, set: card.set, signal: a.signal, prev: prev || null,
      price, reason: a.rationale,
    });
  }

  dashboard.push({
    name: card.name, set: card.set, char: card.char, tier: card.tier || "chase",
    id: card.id, image, productId, ...a,
    history: priceHistory[key].slice(-180),
  });
}

write("history/prices.json", priceHistory);
write("history/signals.json", newSignals);
write("history/predictions.json", predictions);
write("docs/data.json", { updated: new Date().toISOString(), eurUsd, cards: dashboard });

const withMomentum = dashboard.filter((c) => c.momSource !== "none").length;
console.log(
  `Updated ${dashboard.length} cards; ${changes.length} signal changes; ` +
  `${withMomentum} with live momentum.`
);

try {
  await sendDiscord(changes);
} catch (e) {
  console.error(e.message);
  process.exitCode = 0; // alerts failing shouldn't fail the run
}
