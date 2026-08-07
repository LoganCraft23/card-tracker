// Sealed-product data client — TCG API (https://tcgapi.dev).
// Needs a free key in TCGAPI_KEY (a GitHub Actions secret; never committed).
//
// Established by probing the live API, because the published docs contradict
// themselves:
//   - auth is the `X-API-Key` header. Bearer returns 401 (or a 402 payment
//     challenge on /search), so don't "fix" it to Bearer.
//   - `/v1/search` is the only live endpoint. /search/cards, /search/products
//     and /products all 404.
//   - query filters are IGNORED. Passing product_type= or set= returns
//     unrelated sets, so every filter here is applied client-side.
//   - per_page caps at 200 (asking for 250 echoes back 200).
//   - free tier is 100 requests/day, which is the real design constraint:
//     one query per set (~16/day) is affordable, per-product queries are not.

const BASE = "https://api.tcgapi.dev/v1";
const DELAY_MS = 350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let remaining = null; // last reported daily_remaining, for the budget guard
export const quotaRemaining = () => remaining;

async function get(path) {
  const key = process.env.TCGAPI_KEY;
  if (!key) throw new Error("TCGAPI_KEY is not set");
  const res = await fetch(BASE + path, { headers: { "X-API-Key": key, accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  const json = await res.json();
  if (typeof json?.rate_limit?.daily_remaining === "number") remaining = json.rate_limit.daily_remaining;
  await sleep(DELAY_MS);
  return json;
}

// Everything the API knows about a set name, in one request.
export async function searchSet(setName) {
  const json = await get(`/search?q=${encodeURIComponent(setName)}&game=pokemon&per_page=200`);
  return Array.isArray(json?.data) ? json.data : [];
}

// --- product classification ----------------------------------------------
// Cases and displays are wholesale multiples (a booster box case runs into the
// thousands) and code cards come back as product_type "Cards"; neither is what
// a collector tracks, so both are dropped. Order matters: exclusions first,
// then most specific format wins.
const FORMATS = [
  { re: /\b(case|display)\b/i, type: null },
  { re: /elite trainer box/i, type: "Elite Trainer Box" },
  { re: /booster box/i, type: "Booster Box" },
  { re: /booster bundle/i, type: "Booster Bundle" },
  { re: /(ultra premium|premium|special)?\s*collection/i, type: "Collection" },
  { re: /blister/i, type: "Blister" },
  { re: /booster pack/i, type: "Booster Pack" },
];

export function classify(name) {
  for (const f of FORMATS) if (f.re.test(name)) return f.type;
  return null;
}

// The API prefixes set names ("SV: Paldean Fates", "SV06: Twilight Masquerade")
// while the model keys them plainly, so compare on the normalised tail.
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
export function setMatches(apiSetName, modelSetName) {
  if (!apiSetName) return false;
  const a = norm(apiSetName);
  return modelSetName.split("/").some((part) => {
    const p = norm(part);
    // >= 3, not > 3: "151" is a real set name and was being silently dropped.
    return p.length >= 3 && a.endsWith(p);
  });
}

// Sealed rows for one model set, normalised and ready to price. A name like
// "Black Bolt / White Flare" is two real sets, so each half is queried and the
// results merged; searching only the first half misses the other's products.
//
// Always query the bare model set name. Search matches on product *name*, and
// products are named for the short set ("151 Booster Bundle"), so expanding
// "151" to its full retail title "Scarlet & Violet 151" returns zero rows.
export async function sealedForSet(modelSetName) {
  const parts = modelSetName.split("/").map((p) => p.trim());
  const seen = new Set();
  const rows = [];
  for (const part of parts) {
    for (const r of await searchSet(part)) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
    }
  }
  const out = [];
  for (const r of rows) {
    if (r.product_type !== "Sealed Products") continue;
    if (!setMatches(r.set_name, modelSetName)) continue;
    const format = classify(r.name);
    if (!format) continue;
    if (typeof r.market_price !== "number" || r.market_price <= 0) continue;
    out.push({
      id: r.id,
      name: r.name,
      format,
      set: modelSetName,
      apiSet: r.set_name,
      productId: r.tcgplayer_id ?? null,
      image: r.image_url ?? null,
      price: r.market_price,
      low: typeof r.low_price === "number" ? r.low_price : null,
      median: typeof r.median_price === "number" ? r.median_price : null,
      listings: typeof r.total_listings === "number" ? r.total_listings : null,
    });
  }
  return out;
}

// --- vintage singles -------------------------------------------------------
// TCGdex has thin-to-zero pricing for a lot of pre-2023 cards (confirmed by
// hand: several Black & White-era "-EX" prints carry no TCGplayer OR
// Cardmarket price on TCGdex at all). This API's own catalog covers them —
// same source TCGdex draws from, evidently synced more completely — and adds
// something TCGdex never had: real daily history with sales volume, at
// /cards/{id}/history. That history is a rolling window (confirmed ~7 days
// deep, not a multi-year archive), so it's a head start, not a replacement
// for building our own — collection.js appends today's price to it exactly
// like it does for a TCGdex-priced card.
//
// The API's own numeric card id (not a TCGdex id) is what this needs; there
// is no free bulk endpoint to auto-discover it, so it's a manual, one-time
// lookup per card (see scripts/probe-vintage.js pattern) recorded in
// collection.json as `vintageId`.

export async function fetchVintageCard(vintageId) {
  const json = await get(`/cards/${vintageId}`);
  const c = json?.data;
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    set: c.set_name || null,
    image: c.image_url || null,
    productId: c.tcgplayer_id ?? null,
    price: typeof c.market_price === "number" ? c.market_price : null,
    rarity: c.rarity || null,
  };
}

// Real daily history TCG API already has, oldest first — used once to seed
// history/collection-prices.json so a newly-added vintage card doesn't start
// from a single flat point the way a brand-new TCGdex-priced card does.
export async function fetchVintageHistory(vintageId) {
  const json = await get(`/cards/${vintageId}/history`);
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows
    .filter((r) => typeof r.market_price === "number")
    .map((r) => [r.date, r.market_price])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
