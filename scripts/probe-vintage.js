// Resolve the 17 vintage cards (PriceCharting collection, >$10) to TCG API
// card ids. Reports every candidate per target so prints (Holofoil vs Reverse
// Holo, "Radiant Collection" vs base set) can be picked correctly rather than
// guessed — the Genesect/Mew EX episode showed how much price differs by print.
const KEY = process.env.TCGAPI_KEY;
const BASE = "https://api.tcgapi.dev/v1";
const headers = { "X-API-Key": KEY, accept: "application/json" };

const targets = [
  { name: "Mew EX", set: "Legendary Treasures", num: "RC24", wantReverseHolo: false },
  { name: "Genesect EX", set: "Plasma Blast", num: "97", wantReverseHolo: false },
  { name: "Reshiram", set: "Legendary Treasures", num: "RC22", wantReverseHolo: false },
  { name: "Reshiram", set: "Black & White", num: "113", wantReverseHolo: false },
  { name: "Latias EX", set: "Plasma Freeze", num: "85", wantReverseHolo: false },
  { name: "Shaymin EX", set: "Legendary Treasures", num: "RC21", wantReverseHolo: false },
  { name: "Brigette", set: "BREAKthrough", num: "161", wantReverseHolo: false },
  { name: "Mewtwo", set: "Legendary Treasures", num: "53", wantReverseHolo: true },
  { name: "Minccino", set: "Promo", num: "BW13", wantReverseHolo: false },
  { name: "Pawniard", set: "Noble Victories", num: "81", wantReverseHolo: true },
  { name: "Charizard EX", set: "Promo", num: "XY29", wantReverseHolo: false },
  { name: "Blaziken", set: "Dark Explorers", num: "17", wantReverseHolo: false },
  { name: "Slowpoke", set: "Undaunted", num: "66", wantReverseHolo: false },
  { name: "Deoxys EX", set: "Promo", num: "BW82", wantReverseHolo: false },
  { name: "Mewtwo EX", set: "Promo", num: "BW45", wantReverseHolo: false },
  { name: "Gardevoir", set: "Legendary Treasures", num: "RC10", wantReverseHolo: false },
  { name: "Hariyama", set: "Undaunted", num: "14", wantReverseHolo: true },
];

async function search(q) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&game=pokemon&per_page=50`, { headers });
  const json = await res.json();
  return json?.data || [];
}

for (const t of targets) {
  const hits = (await search(t.name)).filter((r) => r.product_type === "Cards");
  // Loose set match: PriceCharting's short names vs TCG API's fuller ones.
  const setHits = hits.filter((r) => (r.set_name || "").toLowerCase().includes(t.set.toLowerCase().split(" ")[0]));
  const numHits = setHits.filter((r) => (r.number || "").replace(/^0+/, "") === t.num.replace(/^0+/, ""));
  const pool = numHits.length ? numHits : setHits.length ? setHits : hits.slice(0, 8);
  console.log(`\n=== ${t.name} #${t.num} (${t.set}) — reverseHolo=${t.wantReverseHolo} ===`);
  for (const r of pool.slice(0, 8)) {
    console.log(`  id=${r.id} "${r.name}" set="${r.set_name}" #${r.number} printing=${r.printing} rarity=${r.rarity} market=${r.market_price} tcgId=${r.tcgplayer_id}`);
  }
  if (!pool.length) console.log("  NO CANDIDATES");
  await new Promise((r) => setTimeout(r, 350));
}
