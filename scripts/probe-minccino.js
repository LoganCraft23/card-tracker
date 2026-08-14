// One-off: resolve Minccino #BW13 (Promo) to its TCG API card id, and
// disambiguate Cosmos vs Cracked Ice holo prints (same number, same set,
// different market prices). See scripts/probe-vintage.js for the pattern.
const KEY = process.env.TCGAPI_KEY;
const BASE = "https://api.tcgapi.dev/v1";
const headers = { "X-API-Key": KEY, accept: "application/json" };

async function search(q) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&game=pokemon&per_page=50`, { headers });
  const json = await res.json();
  return json?.data || [];
}

const hits = (await search("Minccino")).filter((r) => r.product_type === "Cards" && (r.number || "").replace(/^0+/, "") === "BW13");
console.log(`=== Minccino #BW13 — ${hits.length} candidate(s) ===`);
for (const r of hits) {
  console.log(`  id=${r.id} "${r.name}" set="${r.set_name}" #${r.number} printing=${r.printing} rarity=${r.rarity} market=${r.market_price} tcgId=${r.tcgplayer_id}`);
}
if (!hits.length) console.log("  NO CANDIDATES");
