// Shared card classification — used by the screener (which builds the daily
// watchlist) and by the collection job (which prices whatever you own, even
// cards the screener would never pick up).

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

export function charFor(name) {
  const n = name.toLowerCase();
  if (S_TIER.some((p) => n.includes(p))) return "S";
  if (A_TIER.some((p) => n.includes(p))) return "A";
  return "B";
}

// Map TCGdex rarity strings onto the model's tiers. The screener treats null
// as "not a chase variant, skip"; the collection job keeps it, because you own
// what you own — it just prices a plain holo as the ordinary card it is.
export function tierFor(rarity) {
  const r = (rarity || "").toLowerCase();
  if (r.includes("illustration") || r.includes("shiny")) return "chase";
  if (r.includes("hyper") || r.includes("secret") || r.includes("ultra")) return "ultra";
  return null;
}

export function rarityTag(rarity) {
  const r = (rarity || "").toLowerCase();
  if (r.includes("special illustration")) return "SIR";
  if (r.includes("illustration")) return "IR";
  if (r.includes("shiny")) return "Shiny";
  if (r.includes("hyper") || r.includes("secret")) return "Gold";
  if (r.includes("ultra")) return "UR";
  return "";
}
