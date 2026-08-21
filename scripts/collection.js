// Daily collection job — prices what you actually own (npm run collection).
//
// Deliberately independent of the screener. watchlist.json rotates every
// morning, so a card you hold can drop out of it; this job prices your cards
// by id whatever their price and whatever set they're from, which is the whole
// point — a $900 grail gets tracked the same as a $20 chase.
//
// Alerts follow the same rule as the watchlist: fire only when a holding flips
// to or from BUY/SELL. Cards from sets the model doesn't know are still priced
// and shown, but never alerted on, because there's no lifecycle phase for them.

import { readFileSync, writeFileSync } from "node:fs";
import { fetchCard, getSets, getEurUsd } from "./tcgdex.js";
import { fetchVintageCard, fetchVintageHistory, quotaRemaining } from "./tcgapi.js";
import { SETS, analyze } from "./model.js";
import { charFor, tierFor, rarityTag } from "./classify.js";
import { sendDiscord } from "./notify.js";

const root = new URL("..", import.meta.url);
const readOr = (p, fb) => {
  try { return JSON.parse(readFileSync(new URL(p, root), "utf8")); } catch { return fb; }
};
const write = (p, data) => writeFileSync(new URL(p, root), JSON.stringify(data, null, 2));

const collection = readOr("collection.json", { cards: [], sealed: [] });
const cards = (collection.cards || []).filter((c) => (c.id || c.vintageId) && !/^example/i.test(c.note || ""));
const sealedWanted = (collection.sealed || []).filter((s) => s.productId && !/^example/i.test(s.note || ""));

if (!cards.length && !sealedWanted.length) {
  // Write the empty shape anyway so the dashboard fetch resolves instead of
  // 404-ing, and the Mine tab can show its "nothing here yet" state.
  write("docs/collection.json", { updated: new Date().toISOString(), totalValue: 0, costBasis: 0, costedItems: 0, items: [] });
  console.log("collection.json has no real entries — nothing to track yet.");
  process.exit(0);
}

const history = readOr("history/collection-prices.json", {});
const prevSignals = readOr("history/collection-signals.json", {});
const sealedData = readOr("docs/sealed.json", { products: [] });
const supplyEvents = readOr("supply-events.json", { sets: {} }).sets || {};

const eurUsd = await getEurUsd();
const allSets = await getSets();

// TCGdex names Black Bolt and White Flare separately while the model keys them
// as one entry, so map each real set name onto its model key.
const modelKeyFor = (tcgdexSetName) => {
  if (!tcgdexSetName) return null;
  const n = tcgdexSetName.toLowerCase();
  for (const key of Object.keys(SETS)) {
    if (key.split("/").some((part) => part.trim().toLowerCase() === n)) return key;
  }
  return null;
};
const setNameById = new Map(allSets.map((s) => [s.id, s.name]));

const today = new Date().toISOString().slice(0, 10);
const items = [];
const changes = [];
const newSignals = {};

// A quota guard for the shared TCGAPI_KEY budget: sealed.js already spent
// ~16 of 100 today, so vintage lookups stop early rather than risking sealed
// tomorrow's run over a handful of collectible cards.
const VINTAGE_QUOTA_FLOOR = 10;

for (const owned of cards) {
  const key = owned.vintageId ? `vintage:${owned.vintageId}` : owned.id;
  let name, set, image, productId, price, rarity, market = null, vintage = false;

  if (owned.vintageId) {
    vintage = true;
    if (!process.env.TCGAPI_KEY) {
      console.warn(`skip ${key}: TCGAPI_KEY not set`);
      continue;
    }
    if (!owned.vintageQuery) {
      console.warn(`skip ${key}: needs a "vintageQuery" search string (the pricing endpoint only returns results by name search, not by id)`);
      continue;
    }
    if (quotaRemaining() !== null && quotaRemaining() < VINTAGE_QUOTA_FLOOR) {
      console.warn(`skip ${key}: TCG API quota too low (${quotaRemaining()} left)`);
      continue;
    }
    let d;
    try {
      d = await fetchVintageCard(owned.vintageId, owned.vintageQuery);
    } catch (e) {
      console.error(`skip ${key}: ${e.message}`);
      continue;
    }
    if (!d || d.price === null) {
      console.warn(`no price for ${key}${d ? ` (${d.name})` : ""} — check vintageQuery still finds this id`);
      continue;
    }
    ({ name, set, image, productId, price, rarity } = d);
  } else {
    let d;
    try {
      d = await fetchCard(owned.id);
    } catch (e) {
      console.error(`skip ${owned.id}: ${e.message}`);
      continue;
    }
    if (d.price === null) {
      console.warn(`no price for ${owned.id} (${d.name})`);
      continue;
    }
    name = d.name; image = d.image; productId = d.productId; price = d.price; rarity = d.rarity; market = d.market;
    // Card ids are "<setId>-<localId>"; the set id can itself contain hyphens.
    const setId = owned.id.slice(0, owned.id.lastIndexOf("-"));
    set = setNameById.get(setId) || setId;
  }

  const modelSet = vintage ? null : modelKeyFor(set); // vintage sets are never in SETS — see note below

  // A brand-new card starts as a single flat point; TCG API's own history
  // gives a vintage card a real running start instead — seeded once, the
  // first time this key is ever seen, then grown day by day like any other.
  if (vintage && !history[key]) {
    try {
      const backfill = await fetchVintageHistory(owned.vintageId);
      if (backfill.length) history[key] = backfill;
    } catch (e) {
      console.warn(`history backfill failed for ${key}: ${e.message}`);
    }
  }

  const hist = (history[key] || []).filter(([dt]) => dt !== today);
  hist.push([today, price]);
  history[key] = hist.slice(-400);

  const tag = rarityTag(rarity);
  const entry = {
    name: `${name}${tag ? " " + tag : ""}`,
    set: modelSet || set,
    char: charFor(name),
    tier: tierFor(rarity) || "chase",
  };

  let a = null;
  if (modelSet) {
    a = analyze({ ...entry, set: modelSet }, price, history[key], market, eurUsd, supplyEvents[modelSet]);
    newSignals[key] = a.signal;
    const prev = prevSignals[key];
    const actionable = a.signal === "BUY" || a.signal === "SELL";
    if (prev !== a.signal && (actionable || prev === "BUY" || prev === "SELL")) {
      changes.push({
        name: entry.name, set: entry.set, signal: a.signal, prev: prev || null,
        price, reason: a.rationale,
      });
    }
  }

  // The lifecycle model was fitted on cards 1-36 months old (see
  // docs/model-fit.json); nothing here has been validated against a card
  // that's been out of print for over a decade, so vintage cards are never
  // scored even though SETS could technically be extended to cover them —
  // that's a real, undertested extrapolation, not just a missing entry.
  const unmodelledReason = vintage
    ? "Vintage card — priced from TCG API since TCGdex has no market data for this printing. Not scored: the lifecycle model is fitted on cards under 3 years old, and a decade-old print is a different regime it hasn't been tested against."
    : "This set isn't in the lifecycle model, so it's tracked for price only — no signal, no alerts.";

  const qty = owned.qty ?? 1;
  items.push({
    kind: "card", id: key, name: entry.name, set: entry.set,
    image, productId,
    qty, paid: owned.paid ?? null,
    value: +(price * qty).toFixed(2),
    modelled: !!modelSet,
    ...(a || { price, signal: null, reasons: [unmodelledReason], proj: null, confidence: null, confidenceFlags: [] }),
    history: history[key].slice(-180),
  });
}

// Sealed reuses the daily sealed run rather than spending TCG API quota again;
// that means only products from the tracked sets can be matched.
for (const owned of sealedWanted) {
  const p = sealedData.products.find((x) => x.productId === owned.productId);
  if (!p) {
    console.warn(`sealed ${owned.productId} not in the tracked sets — skipped`);
    continue;
  }
  const key = `sealed:${owned.productId}`;
  newSignals[key] = p.signal;
  const prev = prevSignals[key];
  const actionable = p.signal === "BUY" || p.signal === "SELL";
  if (prev !== p.signal && (actionable || prev === "BUY" || prev === "SELL")) {
    changes.push({ name: p.name, set: p.set, signal: p.signal, prev: prev || null, price: p.price, reason: p.rationale });
  }
  const qty = owned.qty ?? 1;
  items.push({
    kind: "sealed", id: key, name: p.name, set: p.set, format: p.format,
    image: p.image, productId: p.productId, isSealed: true,
    qty, paid: owned.paid ?? null, value: +(p.price * qty).toFixed(2), modelled: true,
    price: p.price, signal: p.signal, reasons: p.reasons, proj: p.proj,
    confidence: p.confidence, confidenceFlags: p.confidenceFlags, phase: p.phase,
    mom: p.mom, history: p.history,
  });
}

const totalValue = items.reduce((a, i) => a + i.value, 0);
const cost = items.reduce((a, i) => a + (i.paid != null ? i.paid * i.qty : 0), 0);
const costed = items.filter((i) => i.paid != null);

write("history/collection-prices.json", history);
write("history/collection-signals.json", newSignals);
write("docs/collection.json", {
  updated: new Date().toISOString(),
  totalValue: +totalValue.toFixed(2),
  costBasis: +cost.toFixed(2),
  costedItems: costed.length,
  items,
});

console.log(`Collection: ${items.length} holdings worth $${totalValue.toFixed(2)}; ${changes.length} signal changes.`);

try {
  await sendDiscord(changes, { title: "Your collection", mention: true });
} catch (e) {
  console.error(e.message);
}
