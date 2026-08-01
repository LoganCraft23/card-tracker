// Reconnaissance round 2 for the TCG API sealed source.
// Round 1 established: auth is the X-API-Key header, /v1/search is the only
// live endpoint, sealed rows carry product_type "Sealed Products", and the
// free tier is 100 requests/day.
//
// Round 2 answers what the implementation actually depends on:
//   1. how large per_page can go (quota is the binding constraint)
//   2. whether one query per set returns that set's sealed products
//   3. how often market_price is actually populated
//   4. whether product_type / set filters exist as query params
// Deleted once scripts/sealed.js is written.

const KEY = process.env.TCGAPI_KEY;
if (!KEY) { console.error("TCGAPI_KEY not set."); process.exit(1); }

const BASE = "https://api.tcgapi.dev/v1";
const headers = { "X-API-Key": KEY, accept: "application/json" };

async function get(path) {
  const res = await fetch(BASE + path, { headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  await new Promise((r) => setTimeout(r, 400));
  return { status: res.status, json, text };
}

const summarise = (rows) => {
  const sealed = rows.filter((r) => r.product_type === "Sealed Products");
  const priced = sealed.filter((r) => typeof r.market_price === "number");
  return { rows: rows.length, sealed: sealed.length, sealedPriced: priced.length,
           sample: priced.slice(0, 4).map((r) => `${r.name} $${r.market_price} (set=${r.set_name}, tcg=${r.tcgplayer_id})`) };
};

// 1 + 2 + 3: one query per set, large page
for (const q of ["Paldean Fates", "Twilight Masquerade"]) {
  const r = await get(`/search?q=${encodeURIComponent(q)}&game=pokemon&per_page=100`);
  console.log(`\n"${q}" per_page=100 -> ${r.status}`);
  if (r.json?.data) {
    console.log("  meta:", JSON.stringify(r.json.meta), "| remaining:", r.json.rate_limit?.daily_remaining);
    console.log("  ", JSON.stringify(summarise(r.json.data), null, 1).replace(/\n\s*/g, " "));
  } else console.log("  body:", r.text.slice(0, 200));
}

// 1: does per_page go beyond 100?
const big = await get(`/search?q=booster&game=pokemon&per_page=250`);
console.log(`\nper_page=250 -> ${big.status} returned=${big.json?.data?.length ?? "?"} per_page_echo=${big.json?.meta?.per_page ?? "?"}`);

// 4: do server-side filters exist?
for (const p of ["&product_type=Sealed%20Products", "&set=Paldean%20Fates", "&set_name=Paldean%20Fates"]) {
  const r = await get(`/search?q=elite%20trainer%20box&game=pokemon&per_page=20${p}`);
  const rows = r.json?.data ?? [];
  const allSealed = rows.length > 0 && rows.every((x) => x.product_type === "Sealed Products");
  console.log(`filter "${decodeURIComponent(p)}" -> ${r.status} rows=${rows.length} allSealed=${allSealed} sets=${[...new Set(rows.map(x=>x.set_name))].slice(0,3).join("|")}`);
}

// 3: what does a current, in-demand product look like?
const etb = await get(`/search?q=${encodeURIComponent("Prismatic Evolutions Elite Trainer Box")}&game=pokemon&per_page=5`);
console.log("\ncurrent ETB sample:");
for (const r of etb.json?.data ?? []) {
  console.log(`  ${r.product_type} | ${r.name} | market=${r.market_price} low=${r.low_price} listings=${r.total_listings} set=${r.set_name}`);
}
console.log("\nremaining today:", etb.json?.rate_limit?.daily_remaining);
