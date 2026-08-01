# Slab & Signal — live Pokemon card tracker

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

4. **Card IDs are already resolved.** The watchlist's ~96 cards carry TCGdex
   IDs (set-aware matching: only cards from the right set, preferring the
   highest collector number, which is the IR/SIR chase variant). Each card
   keeps a `candidates` list — if a pick looks wrong (the dashboard's
   TCGplayer link makes mismatches easy to spot), paste a different candidate
   into `id`. Cards flagged `unresolved` need a name tweak, then:
   ```bash
   npm run resolve
   ```
   (`npm run resolve -- --force` re-resolves everything from scratch.)

5. **Enable GitHub Pages.** Repo Settings → Pages → Source: "Deploy from a
   branch" → Branch: `main`, folder: `/docs`. Your dashboard will be at
   `https://YOURNAME.github.io/card-tracker/`.

6. **Run it once.** Repo → Actions tab → "Daily price update" → Run workflow.
   After it finishes, the dashboard has live prices and Discord gets its first
   alert batch. From then on it runs itself every day at 9 AM Eastern.

## Preview locally

```bash
npm run serve
```

serves the dashboard at http://localhost:4173 exactly as GitHub Pages will.

## Day-to-day

- **Add a card:** append it to `watchlist.json` (name, set, char `S`/`A`/`B`,
  tier `chase`/`ultra`/`holo`), run `npm run resolve`, push. If the set is new,
  add it to `SETS` in `scripts/model.js` with its release month and print
  status.
- **Set goes out of print:** flip `inPrint` to `false` in `scripts/model.js` —
  this moves its cards from trough to recovery phase.
- **Alerts:** Discord pings only on signal *changes* to or from BUY/SELL, so
  it's quiet unless something actionable happens.

## Notes and caveats

- **Momentum builds over time.** The 30/90/180-day change stats come from the
  tracker's own snapshots, so they fill in as it runs (30-day momentum after a
  month, etc.). Signals work from day one using phase/tier rules alone.
- **If TCGdex's schema or coverage disappoints,** swap the provider in
  `scripts/tcgdex.js` — it's the only file that touches the API. Alternatives
  are listed at the top of that file.
- **Not financial advice.** The model encodes market heuristics (buy troughs,
  sell spikes, avoid in-print standard hits); collectibles are speculative and
  a card can halve for reasons no model sees. Verify against recent sold
  listings before spending real money.
