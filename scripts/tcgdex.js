// Price data client — TCGdex (https://tcgdex.dev), no API key required.
// TCGplayer market prices are exposed on each card's `pricing` field.
//
// If TCGdex's schema differs from what's parsed here or coverage is thin for a
// set, this file is the ONLY thing you need to change. Drop-in alternatives:
//   - PokéWallet (https://www.pokewallet.io) — free tier 1,000 req/day, needs key
//   - TCG API (https://tcgapi.dev) — free tier 100 req/day, has 24h/7d/30d changes
// Keep the two exported functions' signatures the same and everything else works.

const BASE = "https://api.tcgdex.net/v2/en";
const DELAY_MS = 350; // be polite to a free API

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url, { headers: { "user-agent": "slab-and-signal-tracker" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// List all sets [{id, name, cardCount}] — used to scope name searches to a set.
export async function getSets() {
  const data = await getJSON(`${BASE}/sets`);
  await sleep(DELAY_MS);
  return Array.isArray(data) ? data : [];
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

// Fetch one card's current TCGplayer market price (USD). Returns number|null.
export async function fetchPrice(cardId) {
  const card = await getJSON(`${BASE}/cards/${cardId}`);
  await sleep(DELAY_MS);
  const p = card?.pricing?.tcgplayer;
  if (!p) return null;
  // Defensive: TCGdex nests prices by variant (normal/holofoil/reverse etc.)
  // and exposes fields like marketPrice / market / midPrice depending on version.
  const variants = typeof p === "object" ? Object.values(p) : [];
  const candidates = [];
  const dig = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of ["marketPrice", "market", "midPrice", "mid"]) {
      if (typeof obj[key] === "number") candidates.push(obj[key]);
    }
    for (const v of Object.values(obj)) if (typeof v === "object") dig(v);
  };
  dig(p);
  variants.forEach(dig);
  if (!candidates.length) return null;
  // Prefer the highest market price (usually the holo variant, which is the
  // collectible one for IR/SIR cards where only one variant exists anyway).
  return Math.max(...candidates);
}
