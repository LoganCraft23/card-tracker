// Round 5: how far back does /cards/{id}/history actually go, for both of
// the user's specific cards? This decides whether it's worth wiring in.
const KEY = process.env.TCGAPI_KEY;
if (!KEY) { console.error("TCGAPI_KEY not set."); process.exit(1); }
const BASE = "https://api.tcgapi.dev/v1";
const headers = { "X-API-Key": KEY, accept: "application/json" };

// Genesect EX (Team Plasma), Plasma Blast, id 33099
// Mew EX, Dragons Exalted, id 30790
for (const id of [33099, 30790]) {
  const res = await fetch(`${BASE}/cards/${id}/history`, { headers });
  const json = await res.json();
  const rows = json?.data || [];
  console.log(`\ncard ${id}: ${rows.length} history rows, remaining=${json?.rate_limit?.daily_remaining}`);
  if (rows.length) {
    console.log("  earliest:", JSON.stringify(rows[0]));
    console.log("  latest:  ", JSON.stringify(rows[rows.length - 1]));
    console.log("  date range:", rows[0].date, "to", rows[rows.length - 1].date);
  }
  await new Promise((r) => setTimeout(r, 400));
}
