# GZW Linux Support Search

A fast, static search page for the **Community - Linux Support** thread on the Gray Zone Warfare Discord. Discord's own search is slow and awkward for long support threads; this tool indexes every message once and searches it instantly in your browser.

- Thread: <https://discord.com/channels/1166365362158313522/1562744057388728382>
- Parent forum: <https://discord.com/channels/1166365362158313522/1561777693001777263>

## What it does

- Searches every message, including code blocks, embeds and attachment filenames.
- Plain terms are ANDed; `"exact phrase"` requires adjacency; `-term` excludes.
- Filters by author, date range, code blocks and attachments; sorts by relevance, newest or oldest.
- Highlights the matching text and can show ±2 surrounding messages for context.
- Links every result back to the original Discord message, with a copyable permalink.
- Shows the snapshot date and message count, plus a **Refresh data** button that reloads the latest committed snapshot.

No backend, no tracking, no third-party requests.

## Using it

Open **<https://golden-icon.github.io/gzw-linux-support/>** or run it locally:

```bash
npm install
npm run serve      # http://localhost:8080
```

Keyboard: `/` focuses the search box, `Esc` clears it, `Enter` opens the first result.

## Updating the snapshot

The page is static: it cannot read Discord at runtime. Freshness comes from re-scraping and committing a new snapshot.

1. Open the thread in a logged-in Discord web session.
2. Paste `scripts/scrape.browser.js` into the DevTools console. It scrolls from the newest message back to the starter and downloads `gzw-linux-support.json`.
3. Ingest and validate it:

   ```bash
   node scripts/ingest.mjs ~/Downloads/gzw-linux-support.json
   npm run verify
   ```

4. Commit `data/messages.json`. GitHub Pages redeploys, and the **Refresh data** button picks it up.

`ingest.mjs` refuses a scrape that is missing the starter message or the previous newest message, so a partial scrape cannot overwrite good data.

## Data

`data/messages.json` is the single source of truth. Each message stores its Discord id, timestamp, display name, a hashed author key (so duplicate names and renames do not merge), plain text plus structured text/code segments, reply target, attachment names/types, embeds, and the original message URL.

It deliberately does **not** store avatars, user ids, roles, badges, reactions, or `cdn.discordapp.com` attachment links — Discord attachment URLs are signed and expire, so attachment badges link to the original message instead.

This is a snapshot of a public, discoverable Discord thread. Only content visible in that thread is included.

## Development

```bash
npm test           # unit tests (node:test)
npm run verify     # validate data/messages.json
```

```
assets/            page, styles, search core, DOM helpers
vendor/            vendored MiniSearch (MIT)
scripts/           scraper, ingest, verify
tests/             unit tests + recorded scrape fixture
data/messages.json committed snapshot
```

## Credits

Search is powered by [MiniSearch](https://github.com/lucaong/minisearch) (MIT), vendored in `vendor/`.

Not affiliated with Discord or MADFINGER Games. Gray Zone Warfare and related marks belong to their owners.

## License

MIT — see [LICENSE](LICENSE).
