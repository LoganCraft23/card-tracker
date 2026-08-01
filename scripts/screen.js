// Auto-screener — rebuilds the watchlist from the market instead of by hand.
//   npm run screen        (also runs first in the daily GitHub Action)
//
// Scans every set in the model's SETS map, pulls each secret-rare card
// (collector number above the set's official count), keeps chase-art cards
// currently priced between MIN_PRICE and MAX_PRICE, scores them with the same
// lifecycle model the dashboard uses, and writes the TARGET highest-upside
// cards into watchlist.json. Because it runs daily, cards fall out on their
// own when they leave the price band (or stronger candidates appear) and new
// ones enter as sets rotate through the model's phases.
//
// To keep a card no matter what the screener thinks, add `"pinned": true` to
// its entry in watchlist.json — pinned cards survive every rebuild.

import { readFileSync, writeFileSync } from "node:fs";
import { getSets, getSet, fetchCard } from "./tcgdex.js";
import { SETS, analyze } from "./model.js";

const PATH = new URL("../watchlist.json", import.meta.url);
const prev = JSON.parse(readFileSync(PATH, "utf8"));

const MIN_PRICE = 5;   // below this it isn't a chase, it's bulk
const MAX_PRICE = 50;  // user's "buy now" ceiling
const TARGET = 100;

// Character popularity drives real card demand more than playability does.
// S = franchise icons, A = strong fan favorites, everything else = B.
const S_TIER = [
  "charizard", "charmander", "charmeleon", "pikachu", "eevee", "umbreon",
  "sylveon", "espeon", "vaporeon", "jolteon", "flareon", "leafeon", "glaceon",
  "gengar", "mewtwo", "mew", "rayquaza", "lugia", "dragonite", "gyarados",
  "snorlax", "greninja", "lucario", "giratina", "garchomp",
];
const A_TIER = [
  "bulbasaur", "ivysaur", "venusaur", "squirtle", "wartortle", "blastoise",
  "gastly", "haunter", "magikarp", "dratini", "dragonair", "lapras", "ditto",
  "psyduck", "slowpoke", "vulpix", "ninetales", "growlithe", "arcanine",
  "alakazam", "machamp", "articuno", "zapdos", "moltres", "togepi", "munchlax",
  "entei", "raikou", "suicune", "ho-oh", "celebi", "tyranitar", "salamence",
  "metagross", "absol", "darkrai", "zoroark", "zorua", "mimikyu", "ceruledge",
  "gardevoir", "ralts", "kirlia", "riolu", "froakie", "victini", "reshiram",
  "zekrom", "sceptile", "blaziken", "swampert", "treecko", "torchic", "mudkip",
  "chikorita", "cyndaquil", "totodile", "turtwig", "chimchar", "piplup",
  "snivy", "tepig", "oshawott", "rowlet", "litten", "popplio", "grookey",
  "scorbunny", "sobble", "sprigatito", "fuecoco", "quaxly", "latias", "latios",
  "kyogre", "groudon", "dialga", "palkia", "arceus", "jirachi", "xerneas",
  "yveltal", "solgaleo", "lunala", "necrozma", "zacian", "zamazenta",
  "koraidon", "miraidon", "ogerpon", "terapagos", "roaring moon", "iron valiant",
];
function charFor(name) {
  const n = name.toLowerCase();
  if (S_TIER.some((p) => n.includes(p))) return "S";
  if (A_TIER.some((p) => n.includes(p))) return "A";
  return "B";
}

// Map TCGdex rarity strings onto the model's tiers; null = not a chase-art
// variant (skip it). Alt-art "illustration" and shiny cards are the chases;
// gold/hyper and plain full-art ultras trail them in collector demand.
function tierFor(rarity) {
  const r = rarity.toLowerCase();
  if (r.includes("illustration") || r.includes("shiny")) return "chase";
  if (r.includes("hyper") || r.includes("secret") || r.includes("ultra")) return "ultra";
  return null;
}
function rarityTag(rarity) {
  const r = rarity.toLowerCase();
  if (r.includes("special illustration")) return "SIR";
  if (r.includes("illustration")) return "IR";
  if (r.includes("shiny")) return "Shiny";
  if (r.includes("hyper") || r.includes("secret")) return "Gold";
  return "UR";
}

const num = (localId) => {
  const n = parseInt(localId, 10);
  return Number.isFinite(n) ? n : -1;
};

const allSets = await getSets();
const idByName = new Map(allSets.map((s) => [s.name.toLowerCase(), s.id]));

const candidates = [];
for (const setName of Object.keys(SETS)) {
  for (const part of setName.split("/")) {
    const sid = idByName.get(part.trim().toLowerCase());
    if (!sid) {
      console.warn(`set not on TCGdex yet: ${part.trim()}`);
      continue;
    }
    const s = await getSet(sid);
    const secrets = s.official ? s.cards.filter((c) => num(c.localId) > s.official) : [];
    console.log(`${s.name}: ${secrets.length} secret rares to price`);
    for (const c of secrets) {
      let d;
      try {
        d = await fetchCard(c.id);
      } catch (e) {
        console.warn(`  ! ${c.id}: ${e.message}`);
        continue;
      }
      const tier = tierFor(d.rarity);
      if (!tier) continue;
      if (d.price === null || d.price < MIN_PRICE || d.price > MAX_PRICE) continue;
      const entry = {
        name: `${d.name} ${rarityTag(d.rarity)}`,
        set: setName,
        char: charFor(d.name),
        tier,
        id: d.id,
        image: d.image,
        auto: true,
      };
      const a = analyze(entry, d.price, []);
      const upside = (a.proj[0] + a.proj[1]) / 2 / d.price - 1;
      candidates.push({ entry, price: d.price, upside });
    }
  }
}

const charRank = { S: 2, A: 1, B: 0 };
candidates.sort(
  (x, y) =>
    y.upside - x.upside ||
    charRank[y.entry.char] - charRank[x.entry.char] ||
    y.price - x.price
);

const pinned = (prev.cards || []).filter((c) => c.pinned);
const usedIds = new Set(pinned.map((c) => c.id));
const usedKeys = new Set(pinned.map((c) => `${c.name} | ${c.set}`));
const chosen = [];
for (const c of candidates) {
  if (chosen.length >= TARGET) break;
  if (usedIds.has(c.entry.id)) continue;
  // History keys are "name | set" — suffix the collector number on collisions
  // (same name + rarity twice in one set) so histories don't merge.
  let key = `${c.entry.name} | ${c.entry.set}`;
  if (usedKeys.has(key)) {
    c.entry.name += ` #${c.entry.id.split("-").pop()}`;
    key = `${c.entry.name} | ${c.entry.set}`;
    if (usedKeys.has(key)) continue;
  }
  usedIds.add(c.entry.id);
  usedKeys.add(key);
  chosen.push(c.entry);
}

writeFileSync(
  PATH,
  JSON.stringify(
    {
      note:
        "Auto-generated by scripts/screen.js: top chase-art cards priced " +
        `$${MIN_PRICE}-$${MAX_PRICE}, ranked by model upside, refreshed daily. ` +
        'Add "pinned": true to an entry to keep it through rebuilds; edit ' +
        "MIN_PRICE/MAX_PRICE/TARGET in scripts/screen.js to retune.",
      screenedAt: new Date().toISOString(),
      cards: [...pinned, ...chosen],
    },
    null,
    2
  )
);
console.log(
  `\nWatchlist rebuilt: ${pinned.length} pinned + ${chosen.length} screened ` +
  `(from ${candidates.length} in-band candidates).`
);
