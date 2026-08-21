# Foil Theory — live Pokémon chase-card index

A self-updating card price tracker: daily TCGplayer market prices, buy/hold/sell
signals from a lifecycle model, a live dashboard, and Discord pings when a
signal flips. Runs entirely on free tiers — $0/month.

**How it works:** a GitHub Action runs every morning, pulls prices for your
watchlist from TCGdex (free, no API key), appends them to a growing price
history, runs the signal model, commits the results, and posts to Discord if
any card flipped to BUY or SELL. GitHub Pages serves the dashboard.

## Setup (~15 minutes, one time)

1. **Create the repo.** Make a new GitHub repository (private is fine for the
   tracker itself, but GitHub Pages on a free account requires a **public**
   repo — use public if you want the dashboard). Push this folder to it:
   ```bash
   git init && git add -A && git commit -m "initial"
   git branch -M main
   git remote add origin https://github.com/YOURNAME/card-tracker.git
   git push -u origin main
   ```

2. **Create the Discord webhook.** In your Discord server: Server Settings →
   Integrations → Webhooks → New Webhook. Pick the channel you want pinged and
   copy the webhook URL.

3. **Add the webhook as a secret.** In the GitHub repo: Settings → Secrets and
   variables → Actions → New repository secret. Name: `DISCORD_WEBHOOK_URL`,
   value: the URL you copied.

4. **The watchlist manages itself.** Every daily run starts with the
   screener (`npm run screen`): it prices every secret-rare card in every set
   the model knows and sorts the chase-art ones into **price bands** —
   `chase` ($5–$50) and `premium` ($50–$500) — keeping the top 100 of each by
   model upside (set phase × rarity tier × character popularity). Each band
   competes only against itself, so a run of expensive cards can't crowd out
   the cheaper tier. Cards rotate in and out on their own as prices move. Add
   `"pinned": true` to any entry to keep it through rebuilds; edit `BANDS` at
   the top of `scripts/screen.js` to add a tier or retune the ranges — adding
   a band costs no extra API calls, since every card is priced anyway.

5. **Enable GitHub Pages.** Repo Settings → Pages → Source: "Deploy from a
   branch" → Branch: `main`, folder: `/docs`. Your dashboard will be at
   `https://YOURNAME.github.io/card-tracker/`.

6. **Run it once.** Repo → Actions tab → "Daily price update" → Run workflow.
   After it finishes, the dashboard has live prices and Discord gets its first
   alert batch. From then on it runs itself every day at 9 AM Eastern.

## How the model reads the market

- **Momentum** comes from Cardmarket's smoothed `trend` measured against its
  30-day average, scaled ×2 to put it on the same footing as a point-to-point
  30-day change (a trailing average is centred ~15 days back). It deliberately
  does *not* use `avg7`: those are averages of actual sales, so on a card that
  sells two copies a week they swing wildly and differencing them mostly
  measures sampling noise. Once the tracker has a month of its own snapshots,
  measured history takes over and the estimate is dropped.
- **Sales noise** — how far `avg1`/`avg7` stray from `avg30` — is a direct read
  on how few sales back a quote. High noise shrinks the momentum reading toward
  zero so thin data can't fire a signal by itself.
- **Confidence** combines the TCGplayer listing spread, US/EU price
  disagreement, and that noise figure. It sets the width of the projected range
  (±12% when confident, up to ±45% when not) instead of a flat guess, and
  discounts a card's ranking in the screener.

## Does the model actually work?

Unknown yet, on purpose. `scripts/score.js` runs daily and grades every logged
prediction at 30/90/180 days against a **naive "price stays flat" baseline**,
writing `docs/accuracy.json`:

```bash
npm run score
```

If `beatsNaive` is false, the phase/tier/character machinery is decoration at
that horizon and adding more criteria won't fix it. First real verdict lands
~30 days after logging began. Until then it honestly reports having nothing to
say.

## Tracking your own collection

`collection.json` in the repo root is yours — the screener never touches it.
Every entry is priced daily by `scripts/collection.js` **regardless of value or
set**, so a vintage grail is tracked the same as a $20 chase. Cards from sets
outside `SETS` are priced but carry no signal (there's no lifecycle phase for
them) and never alert.

To fill it: star cards on the site, click **Export** in the sidebar, and commit
the file it hands you. Or add TCGdex ids by hand.

**Cards TCGdex has no pricing for** (common for pre-2023 prints — confirmed by
hand for several Black & White-era "-EX" cards) can often still be priced via
[TCG API](https://tcgapi.dev), which also backs `docs/sealed.json` and needs the
same `TCGAPI_KEY` secret. Give the entry `vintageId` (TCG API's numeric card id)
and `vintageQuery` (a name that surfaces it via TCG API's own search — the
`/cards/{id}` detail endpoint carries no price at all, only `/search` results
do, so the id alone isn't enough) instead of `id`. History is backfilled once
from TCG API's own `/cards/{id}/history` (confirmed real, but a rolling ~week,
not a deep archive) and grows day by day after that like anything else. These
never get a signal or alert — the lifecycle model is fitted on cards under 3
years old and hasn't been tested on a decade-old print.

**Alerts are scoped to this file.** Discord fires only for your holdings, on the
same rule as everything else — a flip to or from BUY/SELL. To also be pinged
about the whole screened watchlist, set `WATCHLIST_ALERTS: "on"` in
`.github/workflows/daily.yml`; anything you own is filtered out of that batch so
it can't ping you twice.

## Preview locally

```bash
npm run serve
```

serves the dashboard at http://localhost:4173 exactly as GitHub Pages will.

## Day-to-day

- **Keep a card forever:** add `"pinned": true` to its entry in
  `watchlist.json` — the screener preserves pinned cards and only competes
  the remaining slots. To hand-add a card outside the screen, append it with
  name/set (plus `pinned: true`) and run `npm run resolve`.
- **New set releases:** add it to `SETS` in `scripts/model.js` with its
  release month and print status — the screener picks up its cards the next
  morning.
- **Set goes out of print:** flip `inPrint` to `false` in `scripts/model.js` —
  this moves its cards from trough to recovery phase.
- **Alerts:** Discord pings only on signal *changes* to or from BUY/SELL, so
  it's quiet unless something actionable happens.
- **Confirmed reprint, restock, or an early return to print:** add an entry to
  `supply-events.json` (repo root), keyed by set name — `{ "type": "reprint",
  "date": "YYYY-MM-DD", "note": "...", "sources": ["..."], "decayMonths": 6 }`.
  While active, `analyze()`/`analyzeSealed()` downgrade any BUY on that set to
  AVOID, stop reading a price drop as "oversold, expect a bounce," and widen
  the confidence band — the phase model assumes supply fades on its own
  schedule, which is exactly what a reprint breaks. The effect decays linearly
  to zero over `decayMonths`. A scheduled weekly job maintains this file
  automatically (WebSearch for reprint/restock news, cross-referencing 2+
  independent sources before writing), but it's plain JSON — safe to hand-edit
  the moment you hear something before the job would otherwise catch it.

## Notes and caveats

- **Momentum is live from day one** via Cardmarket (shown with a `~` on the
  site to mark it as an estimate). The exact 30/90/180-day figures come from
  the tracker's own snapshots and replace the estimate as they fill in.
- **If TCGdex's schema or coverage disappoints,** swap the provider in
  `scripts/tcgdex.js` — it's the only file that touches the API. Alternatives
  are listed at the top of that file.
- **Not financial advice.** The model encodes market heuristics (buy troughs,
  sell spikes, avoid in-print standard hits); collectibles are speculative and
  a card can halve for reasons no model sees. Verify against recent sold
  listings before spending real money.
