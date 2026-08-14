// Price data client — TCGdex (https://tcgdex.dev), no API key required.
// TCGplayer market prices are exposed on each card's `pricing` field.
//
// If TCGdex's schema differs from what's parsed here or coverage is thin for a
// set, this file is the ONLY thing you need to change. Drop-in alternatives:
//   - PokéWallet (https://www.pokewallet.io) — free tier 1,000 req/day, needs key
//   - TCG API (https://tcgapi.dev) — free tier 100 req/day, has 24h/7d/30d changes
// Keep the two exported functions' signatures the same and everything else works.

const BASE = "https://api.tcgdex.net/v2/en";
const DELAY_MS = 150; // be polite to a free API (the screener makes ~1000 calls)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url, { headers: { "user-agent": "foil-theory-tracker" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// List all sets [{id, name, cardCount}] — used to scope name searches to a set.
export async function getSets() {
  const data = await getJSON(`${BASE}/sets`);
  await sleep(DELAY_MS);
  return Array.isArray(data) ? data : [];
}

// Fetch one set's full card list + official count. Resolution works from this
// (not name search) so secret-rare variants can't be missed.
export async function getSet(setId) {
  const data = await getJSON(`${BASE}/sets/${setId}`);
  await sleep(DELAY_MS);
  return {
    id: data.id,
    name: data.name,
    official: data?.cardCount?.official ?? null,
    cards: (data.cards || []).map((c) => ({ id: c.id, name: c.name, localId: c.localId })),
  };
}

// Search for a card by name; returns candidate cards [{id, name, set}]
export async function searchCards(name) {
  const url = `${BASE}/cards?name=${encodeURIComponent(name)}`;
  const data = await getJSON(url);
  await sleep(DELAY_MS);
  return (Array.isArray(data) ? data : []).map((c) => ({
    id: c.id,
    name: c.name,
    localId: c.localId,
  }));
}

// The TCGplayer variant block backing the price we quote — the one with the
// highest market price. Its low/mid/high fields describe that same listing
// pool, which is what makes the spread meaningful.
function pickVariant(card) {
  const p = card?.pricing?.tcgplayer;
  if (!p || typeof p !== "object") return null;
  let best = null;
  for (const v of Object.values(p)) {
    if (!v || typeof v !== "object") continue;
    const m = typeof v.marketPrice === "number" ? v.marketPrice : null;
    if (m === null) continue;
    if (!best || m > best.marketPrice) best = v;
  }
  return best;
}

// Fetch one card's detail: TCGplayer market price (USD, number|null), rarity,
// art URL (append /low.webp or /high.webp to display), and a `market` block
// carrying the listing spread plus Cardmarket's rolling averages — the inputs
// for momentum and liquidity scoring.
export async function fetchCard(cardId) {
  const card = await getJSON(`${BASE}/cards/${cardId}`);
  await sleep(DELAY_MS);
  const v = pickVariant(card);
  const cm = card?.pricing?.cardmarket || null;
  return {
    id: card.id,
    name: card.name,
    localId: card.localId,
    rarity: card.rarity || "",
    illustrator: card.illustrator || null,
    standardLegal: card?.legal?.standard === true,
    image: card.image || null,
    price: v?.marketPrice ?? null,
    // TCGplayer's own product id for the variant we quote — lets the dashboard
    // deep-link to the exact listing page instead of a name search.
    productId: v?.productId ?? null,
    market: {
      // USD, from the variant we quote
      low: v?.lowPrice ?? null,
      mid: v?.midPrice ?? null,
      high: v?.highPrice ?? null,
      directLow: v?.directLowPrice ?? null,
      // EUR, Cardmarket rolling averages — an independent second market
      cmAvg1: cm?.avg1 ?? null,
      cmAvg7: cm?.avg7 ?? null,
      cmAvg30: cm?.avg30 ?? null,
      cmTrend: cm?.trend ?? null,
    },
  };
}

// EUR→USD rate, so the two markets can be compared on one scale. ECB data via
// frankfurter.app (free, no key). Falls back to a static rate if it's down —
// this only feeds a divergence *ratio*, so a stale rate degrades gracefully.
const FX_FALLBACK = 1.08;
export async function getEurUsd() {
  try {
    const d = await getJSON("https://api.frankfurter.app/latest?from=EUR&to=USD");
    const r = d?.rates?.USD;
    return typeof r === "number" && r > 0 ? r : FX_FALLBACK;
  } catch {
    console.warn("FX lookup failed — using fallback EUR/USD rate");
    return FX_FALLBACK;
  }
}

// Fetch one card's current TCGplayer market price (USD). Returns number|null.
export async function fetchPrice(cardId) {
  return (await fetchCard(cardId)).price;
}
