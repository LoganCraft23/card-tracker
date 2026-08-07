// Round 4. Round 3 found the real naming convention: TCG API uses a SPACE
// ("Genesect EX") and disambiguates prints via a parenthetical, e.g.
// "Genesect EX (Team Plasma)" for the Plasma Blast set that TCGdex has zero
// pricing for — and it IS priced there ($25.03). Confirm Mew EX the same way,
// get full field shapes (need an id for daily re-fetching), and test whether
// a real historical-price endpoint exists or whether "history" would have to
// mean our own accumulated daily snapshots going forward.
const KEY = process.env.TCGAPI_KEY;
if (!KEY) { console.error("TCGAPI_KEY not set."); process.exit(1); }
const BASE = "https://api.tcgapi.dev/v1";
const headers = { "X-API-Key": KEY, accept: "application/json" };

let sample = null;
for (const q of ["Genesect EX", "Mew EX"]) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&game=pokemon&per_page=20`, { headers });
  const json = await res.json();
  console.log(`\n"${q}" -> ${json?.data?.length ?? 0} hits, remaining=${json?.rate_limit?.daily_remaining}`);
  for (const r of json?.data || []) {
    console.log(`  "${r.name}" set=${r.set_name} market=${r.market_price} low=${r.low_price} id=${r.id} tcgplayer_id=${r.tcgplayer_id}`);
    if (!sample && r.market_price != null && /Dragons Exalted|Legendary Treasures|Plasma Blast/i.test(r.set_name)) sample = r;
  }
  await new Promise((r) => setTimeout(r, 400));
}

if (sample) {
  console.log("\nfull sample record:", JSON.stringify(sample, null, 1));
  console.log("\n--- trying history endpoints against a real id/tcgplayer_id ---");
  for (const path of [
    `/cards/${sample.id}/history`, `/history/${sample.id}`,
    `/products/${sample.tcgplayer_id}/history`, `/history/${sample.tcgplayer_id}`,
    `/cards/${sample.id}`, // maybe detail view embeds a history array
  ]) {
    const res = await fetch(`${BASE}${path}`, { headers });
    const text = await res.text();
    console.log(`${path} -> ${res.status}`);
    console.log("  body:", text.slice(0, 400));
    await new Promise((r) => setTimeout(r, 400));
  }
} else {
  console.log("\nno usable vintage sample found to test history against.");
}
