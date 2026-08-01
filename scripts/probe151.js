// Temporary: find a query that surfaces 151's sealed products.
const KEY = process.env.TCGAPI_KEY;
const BASE = "https://api.tcgapi.dev/v1";
const H = { "X-API-Key": KEY, accept: "application/json" };
for (const q of ["151", "Scarlet & Violet 151", "Scarlet Violet 151", "151 Elite Trainer Box", "151 Booster Box"]) {
  const r = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&game=pokemon&per_page=200`, { headers: H });
  const j = await r.json();
  const rows = j?.data ?? [];
  const sealed = rows.filter(x => x.product_type === "Sealed Products");
  console.log(`q="${q}" -> total=${j?.meta?.total} rows=${rows.length} sealed=${sealed.length} has_more=${j?.meta?.has_more}`);
  console.log("   setNames:", [...new Set(sealed.map(x => x.set_name))].slice(0, 3).join(" | ") || "-");
  console.log("   sample:", sealed.slice(0, 3).map(x => x.name).join(" | ") || "-");
  await new Promise(r => setTimeout(r, 400));
}
