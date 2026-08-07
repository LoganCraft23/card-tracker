// The /cards/{id} detail endpoint might not carry pricing at all, unlike a
// /search hit which does. Dump the FULL body (my earlier 400-char truncation
// hid whatever comes after "attacks") to find out.
const KEY = process.env.TCGAPI_KEY;
const BASE = "https://api.tcgapi.dev/v1";
const headers = { "X-API-Key": KEY, accept: "application/json" };
const res = await fetch(`${BASE}/cards/33099`, { headers });
const json = await res.json();
console.log("full keys:", Object.keys(json?.data || {}));
console.log(JSON.stringify(json, null, 1));
