// Resolves watchlist entries to TCGdex card IDs.
// Run once (and again whenever you add cards):  npm run resolve
// Re-resolve everything (overwrites existing ids):  npm run resolve -- --force
//
// Matching: search TCGdex by name, keep only cards from the watchlist entry's
// set, prefer exact name matches, then pick the highest collector number —
// IR/SIR/secret-rare variants sit above the set's official count, so the top
// number is almost always the chase variant the watchlist means. Each card
// keeps a `candidates` list so a wrong pick is a one-line manual fix: paste a
// different candidate id into `id` and it will be left alone on future runs.

import { readFileSync, writeFileSync } from "node:fs";
import { searchCards, getSets } from "./tcgdex.js";

const PATH = new URL("../watchlist.json", import.meta.url);
const watchlist = JSON.parse(readFileSync(PATH, "utf8"));
const force = process.argv.includes("--force");

// Strip rarity suffixes we use for humans ("IR", "SIR", "SAR") and the "Shiny"
// prefix before searching. "ex" stays — it's part of the real card name.
function searchName(name) {
  return name.replace(/\s+(IR|SIR|SAR)$/i, "").replace(/^Shiny\s+/i, "").trim();
}

// Watchlist set names map to TCGdex sets by exact name; "A / B" means the
// entry spans two sets (e.g. "Black Bolt / White Flare").
const allSets = await getSets();
const setIdsByName = new Map();
for (const s of allSets) setIdsByName.set(s.name.toLowerCase(), s.id);
function setIdsFor(setName) {
  return setName
    .split("/")
    .map((part) => setIdsByName.get(part.trim().toLowerCase()))
    .filter(Boolean);
}

const num = (localId) => {
  const n = parseInt(localId, 10);
  return Number.isFinite(n) ? n : -1;
};

let resolved = 0, missing = 0;
for (const card of watchlist.cards) {
  if (card.id && !force) { resolved++; continue; }

  const setIds = setIdsFor(card.set);
  if (!setIds.length) {
    card.unresolved = true;
    missing++;
    console.warn(`✗ unknown set on TCGdex: ${card.set} (${card.name})`);
    continue;
  }

  const target = searchName(card.name);
  try {
    const results = await searchCards(target);
    const inSet = results.filter((r) => setIds.some((id) => r.id.startsWith(id + "-")));
    // Exact-name matches keep "Zapdos" from resolving to "Zapdos ex".
    const exact = inSet.filter((r) => r.name.toLowerCase() === target.toLowerCase());
    const pool = (exact.length ? exact : inSet).sort((a, b) => num(b.localId) - num(a.localId));

    if (pool.length) {
      card.id = pool[0].id;
      card.candidates = pool.slice(0, 5).map((r) => r.id);
      delete card.unresolved;
      resolved++;
      console.log(`✓ ${card.name} (${card.set}) → ${card.id}${exact.length ? "" : " [no exact name match — check candidates]"}`);
    } else {
      delete card.id;
      delete card.candidates;
      card.unresolved = true;
      missing++;
      console.warn(`✗ no in-set match: ${card.name} (${card.set})`);
    }
  } catch (e) {
    console.error(`! error resolving ${card.name}: ${e.message}`);
    missing++;
  }
}

writeFileSync(PATH, JSON.stringify(watchlist, null, 2));
console.log(`\nResolved ${resolved}, missing ${missing}. Review 'candidates' arrays for any wrong picks.`);
