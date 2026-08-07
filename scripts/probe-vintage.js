// Round 2. Round 1: combined "name + set" queries returned zero Cards-type
// hits, same lesson as the sealed-product probe (server-side query is literal
// name matching, not fuzzy) — so search on the bare card name instead and
// filter to the right set client-side. Also need to actually read the history
// endpoint's body, not just trust a 200 status.
const KEY = process.env.TCGAPI_KEY;
if (!KEY) { console.error("TCGAPI_KEY not set."); process.exit(1); }
const BASE = "https://api.tcgapi.dev/v1";
const headers = { "X-API-Key": KEY, accept: "application/json" };

async function search(q) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&game=pokemon&per_page=30`, { headers });
  const json = await res.json();
  await new Promise((r) => setTimeout(r, 300));
  return json;
}

let firstCardId = null, firstTcgplayerId = null;
for (const q of ["Genesect-EX", "Mew-EX"]) {
  const json = await search(q);
  const cards = (json?.data || []).filter((r) => r.product_type === "Cards");
  console.log(`\n"${q}" -> ${cards.length} Cards-type hits (remaining=${json?.rate_limit?.daily_remaining})`);
  for (const c of cards) {
    console.log(`  id=${c.id} tcgplayer_id=${c.tcgplayer_id} "${c.name}" set=${c.set_name} rarity=${c.rarity} market=${c.market_price} low=${c.low_price} updated=${c.price_updated_at}`);
    if (!firstCardId && c.market_price != null) { firstCardId = c.id; firstTcgplayerId = c.tcgplayer_id; }
  }
}

console.log("\n--- history endpoint, read the actual body ---");
for (const path of [`/cards/${firstCardId}/history`, `/products/${firstTcgplayerId}/history`, `/history/${firstTcgplayerId}`]) {
  if (!firstCardId && !firstTcgplayerId) break;
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  console.log(`${path} -> ${res.status}`);
  console.log("  body:", text.slice(0, 500));
  await new Promise((r) => setTimeout(r, 300));
}
