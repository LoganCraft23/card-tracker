// Resolves watchlist entries to TCGdex card IDs.
// Run once (and again whenever you add cards):  npm run resolve
// Re-resolve everything (overwrites existing ids):  npm run resolve -- --force
//
// Matching: download each watchlist set's full card list, find cards with the
// right name, and pick the variant numbered ABOVE the set's official count —
// that's what makes a card an IR/SIR/secret rare, so this can't fall back to
// the cheap base version the way name search could. Cards whose name asks for
// a chase variant ("... IR", "... SIR", "Shiny ...") that the set simply
// doesn't contain are flagged `unresolved` instead of silently tracking the
// base card. Each resolved card keeps a `candidates` list (all same-name
// variants, highest number first) — to override a pick, paste a candidate
// into `id`; it will be left alone on future runs unless you pass --force.

import { readFileSync, writeFileSync } from "node:fs";
import { getSets, getSet } from "./tcgdex.js";

const PATH = new URL("../watchlist.json", import.meta.url);
const watchlist = JSON.parse(readFileSync(PATH, "utf8"));
const force = process.argv.includes("--force");

// Strip rarity suffixes we use for humans ("IR", "SIR", "SAR") and the "Shiny"
// prefix before matching. "ex" stays — it's part of the real card name.
const searchName = (name) =>
  name.replace(/\s+(IR|SIR|SAR)$/i, "").replace(/^Shiny\s+/i, "").trim();
// These markers mean the watchlist wants the secret-rare art variant.
const wantsChase = (name) => /(\s(IR|SIR|SAR)$)|(^Shiny\s)/i.test(name);
const num = (localId) => {
  const n = parseInt(localId, 10);
  return Number.isFinite(n) ? n : -1;
};

// Watchlist set names map to TCGdex sets by exact name; "A / B" means the
// entry spans two sets (e.g. "Black Bolt / White Flare").
const allSets = await getSets();
const setIdByName = new Map(allSets.map((s) => [s.name.toLowerCase(), s.id]));
const setCache = new Map();
async function setsFor(setName) {
  const out = [];
  for (const part of setName.split("/")) {
    const id = setIdByName.get(part.trim().toLowerCase());
    if (!id) continue;
    if (!setCache.has(id)) setCache.set(id, await getSet(id));
    out.push(setCache.get(id));
  }
  return out;
}

let resolved = 0, missing = 0;
for (const card of watchlist.cards) {
  if (card.id && !force) { resolved++; continue; }

  const sets = await setsFor(card.set);
  if (!sets.length) {
    card.unresolved = true;
    missing++;
    console.warn(`✗ unknown set on TCGdex: ${card.set} (${card.name})`);
    continue;
  }

  const target = searchName(card.name).toLowerCase();
  const pool = [];
  for (const s of sets) {
    const exact = s.cards.filter((c) => c.name.toLowerCase() === target);
    // Fallback covers small naming drift ("Garchomp ex" listed as "Garchomp-ex" etc.)
    const loose = exact.length
      ? exact
      : s.cards.filter((c) => c.name.toLowerCase().startsWith(target));
    for (const c of loose) pool.push({ ...c, secret: s.official !== null && num(c.localId) > s.official });
  }
  pool.sort((a, b) => num(b.localId) - num(a.localId));

  const pick = wantsChase(card.name) ? pool.find((c) => c.secret) : pool[0];
  if (pick) {
    card.id = pick.id;
    card.candidates = pool.slice(0, 6).map((c) => c.id);
    delete card.unresolved;
    resolved++;
    console.log(`✓ ${card.name} (${card.set}) → ${pick.id}`);
  } else {
    delete card.id;
    delete card.candidates;
    card.unresolved = true;
    missing++;
    console.warn(
      pool.length
        ? `✗ no secret-rare variant of ${card.name} in ${card.set} (base exists: ${pool[0].id})`
        : `✗ no match: ${card.name} (${card.set})`
    );
  }
}

writeFileSync(PATH, JSON.stringify(watchlist, null, 2));
console.log(`\nResolved ${resolved}, missing ${missing}. Review 'candidates' arrays for any wrong picks.`);
