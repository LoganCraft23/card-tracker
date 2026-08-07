// Round 3: zero "Cards"-type hits even on the bare hyphenated name is
// suspicious enough that the product_type filter itself might be wrong, or
// this API might not carry singles at all despite being generically "Cards"
// named. Dump raw, unfiltered responses to find out what's actually there.
const KEY = process.env.TCGAPI_KEY;
if (!KEY) { console.error("TCGAPI_KEY not set."); process.exit(1); }
const BASE = "https://api.tcgapi.dev/v1";
const headers = { "X-API-Key": KEY, accept: "application/json" };

for (const q of ["Genesect-EX", "Genesect EX", "Pikachu", "Charizard"]) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&game=pokemon&per_page=10`, { headers });
  const json = await res.json();
  const types = {};
  for (const r of json?.data || []) types[r.product_type] = (types[r.product_type] || 0) + 1;
  console.log(`\n"${q}" -> total=${json?.meta?.total} product_types=${JSON.stringify(types)} remaining=${json?.rate_limit?.daily_remaining}`);
  for (const r of (json?.data || []).slice(0, 4)) {
    console.log(`  [${r.product_type}] "${r.name}" set=${r.set_name} market=${r.market_price}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
