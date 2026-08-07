// One-off: does TCG API have pricing (and history) for vintage EX cards that
// TCGdex has none for? Runs in Actions where TCGAPI_KEY exists; deleted once
// answered. Never prints the key.
const KEY = process.env.TCGAPI_KEY;
if (!KEY) { console.error("TCGAPI_KEY not set."); process.exit(1); }
const BASE = "https://api.tcgapi.dev/v1";
const headers = { "X-API-Key": KEY, accept: "application/json" };

async function search(q) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&game=pokemon&per_page=20`, { headers });
  const json = await res.json();
  await new Promise((r) => setTimeout(r, 300));
  return { status: res.status, json };
}

for (const q of ["Genesect-EX Plasma Blast", "Mew-EX Dragons Exalted", "Mew-EX Legendary Treasures"]) {
  const { status, json } = await search(q);
  console.log(`\n"${q}" -> ${status}, remaining=${json?.rate_limit?.daily_remaining}`);
  const cards = (json?.data || []).filter((r) => r.product_type === "Cards");
  for (const c of cards.slice(0, 5)) {
    console.log(`  id=${c.id} tcgplayer_id=${c.tcgplayer_id} "${c.name}" set=${c.set_name} rarity=${c.rarity} market=${c.market_price} low=${c.low_price}`);
  }
  if (!cards.length) console.log("  (no Cards-type hits)");
}

// Does the API expose any historical series at all, for anything?
console.log("\n--- checking for a history endpoint ---");
for (const path of ["/history/98593", "/products/98593/history", "/cards/98593/history"]) {
  const res = await fetch(`${BASE}${path}`, { headers });
  console.log(`${path} -> ${res.status}`);
  await new Promise((r) => setTimeout(r, 300));
}
