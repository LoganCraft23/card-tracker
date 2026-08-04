// Sends signal-change alerts to a Discord channel via webhook.
// Set DISCORD_WEBHOOK_URL as a GitHub Actions secret (see README).

const EMOJI = { BUY: "🟢", SELL: "🔴", HOLD: "🟡", AVOID: "⚪" };

/**
 * @param changes  [{name, set, signal, prev, price, reason}]
 * @param opts.title   heading for the batch ("Your collection" vs the watchlist)
 * @param opts.mention prefix with @here — reserved for holdings you actually own,
 *                     so the noisier watchlist batch can't trigger a ping.
 */
export async function sendDiscord(changes, opts = {}) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.warn("DISCORD_WEBHOOK_URL not set — skipping notification.");
    return;
  }
  if (!changes.length) return;

  const lines = changes.slice(0, 15).map(
    (c) =>
      `${EMOJI[c.signal]} **${c.signal}** — ${c.name} (${c.set}) at **$${c.price.toFixed(2)}**` +
      (c.prev ? ` _(was ${c.prev})_` : "") +
      `\n> ${c.reason}`
  );
  if (changes.length > 15) lines.push(`…and ${changes.length - 15} more on the dashboard.`);

  const heading = opts.title
    ? `${opts.mention ? "@here " : ""}**${opts.title} — ${changes.length} signal change${changes.length > 1 ? "s" : ""}:**`
    : `**Card signals changed today (${changes.length}):**`;

  const body = {
    username: "Foil Theory",
    content: `${heading}\n\n${lines.join("\n\n")}`,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
  console.log(`Discord alert sent (${changes.length} changes).`);
}
