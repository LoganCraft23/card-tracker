// Daily job — run by GitHub Actions (or locally: npm run update)
// 1. Fetch today's TCGplayer market price for every resolved watchlist card
// 2. Append to history/prices.json (this builds real 30/90/180-day history)
// 3. Run the signal model
// 4. Diff against yesterday's signals → Discord alert on changes
// 5. Write docs/data.json for the dashboard

import { readFileSync, writeFileSync } from "node:fs";
import { fetchPrice } from "./tcgdex.js";
import { analyze } from "./model.js";
import { sendDiscord } from "./notify.js";

const root = new URL("..", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const write = (p, data) => writeFileSync(new URL(p, root), JSON.stringify(data, null, 2));

const watchlist = read("watchlist.json");
const priceHistory = read("history/prices.json"); // { cardKey: [[date, price], ...] }
const prevSignals = read("history/signals.json"); // { cardKey: "BUY" | ... }

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
  try {
    price = await fetchPrice(card.id);
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

  const a = analyze(card, price, priceHistory[key]);
  newSignals[key] = a.signal;

  const prev = prevSignals[key];
  const actionable = a.signal === "BUY" || a.signal === "SELL";
  if (prev !== a.signal && (actionable || prev === "BUY" || prev === "SELL")) {
    changes.push({
      name: card.name, set: card.set, signal: a.signal, prev: prev || null,
      price, reason: a.reasons[a.reasons.length - 1],
    });
  }

  dashboard.push({
    name: card.name, set: card.set, char: card.char, tier: card.tier || "chase",
    id: card.id, ...a,
    history: priceHistory[key].slice(-180),
  });
}

write("history/prices.json", priceHistory);
write("history/signals.json", newSignals);
write("docs/data.json", { updated: new Date().toISOString(), cards: dashboard });

console.log(`Updated ${dashboard.length} cards; ${changes.length} signal changes.`);

try {
  await sendDiscord(changes);
} catch (e) {
  console.error(e.message);
  process.exitCode = 0; // alerts failing shouldn't fail the run
}
