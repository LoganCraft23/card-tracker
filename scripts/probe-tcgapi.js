// One-off reconnaissance for the TCG API (sealed product source).
// Runs in GitHub Actions, where TCGAPI_KEY exists; it never runs locally and
// never prints the key — only status codes and response *shapes*.
//
// The published docs disagree with themselves (X-API-Key vs Bearer, /search vs
// /search/cards), so this tries the combinations and reports which are real.
// Delete this file once scripts/sealed.js is written against the answer.

const KEY = process.env.TCGAPI_KEY;
if (!KEY) {
  console.error("TCGAPI_KEY not set — nothing to probe.");
  process.exit(1);
}

const BASE = "https://api.tcgapi.dev/v1";
const AUTHS = {
  "X-API-Key": { "X-API-Key": KEY },
  "Bearer": { Authorization: `Bearer ${KEY}` },
};

// A booster box is the archetypal sealed product; if any of these return it,
// we know both the endpoint and the shape.
const PATHS = [
  "/search?q=booster%20box&game=pokemon&per_page=3",
  "/search/products?q=booster%20box&game=pokemon&per_page=3",
  "/search/sealed?q=booster%20box&game=pokemon&per_page=3",
  "/products?game=pokemon&per_page=3",
  "/search/cards?q=charizard&game=pokemon&per_page=2",
];

// Print the structure of a value without dumping (or leaking) all of it.
function shape(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return depth > 2 ? "[…]" : `[${v.length ? shape(v[0], depth + 1) : ""}]`;
  if (typeof v === "object") {
    if (depth > 2) return "{…}";
    return "{" + Object.keys(v).slice(0, 24).map((k) => `${k}:${shape(v[k], depth + 1)}`).join(", ") + "}";
  }
  if (typeof v === "string") return v.length > 40 ? "string" : JSON.stringify(v);
  return typeof v;
}

for (const [authName, headers] of Object.entries(AUTHS)) {
  for (const path of PATHS) {
    const url = BASE + path;
    let res, body;
    try {
      res = await fetch(url, { headers: { ...headers, accept: "application/json" } });
      body = await res.text();
    } catch (e) {
      console.log(`[${authName}] ${path} -> network error: ${e.message}`);
      continue;
    }
    const ok = res.status >= 200 && res.status < 300;
    let parsed = null;
    try { parsed = JSON.parse(body); } catch {}

    console.log(`\n[${authName}] ${path} -> ${res.status}`);
    if (!ok) {
      console.log("  body:", body.slice(0, 200).replace(/\s+/g, " "));
      continue;
    }
    console.log("  shape:", shape(parsed).slice(0, 900));
    // Surface the first record fully-ish so field names for sealed are visible.
    const first = parsed?.data?.[0] ?? parsed?.results?.[0] ?? null;
    if (first) console.log("  first record:", JSON.stringify(first).slice(0, 700));
    // Rate-limit headers tell us the real free-tier budget.
    const rl = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-daily-limit", "x-daily-remaining"]
      .map((h) => (res.headers.get(h) ? `${h}=${res.headers.get(h)}` : null)).filter(Boolean);
    if (rl.length) console.log("  rate limit:", rl.join(" "));
    await new Promise((r) => setTimeout(r, 400));
  }
}
console.log("\nProbe complete.");
