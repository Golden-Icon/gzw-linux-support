# GZW Linux Support Search — Design

**Status:** Draft for approval
**Date:** 2026-11-22
**Owner:** golden

## Intent and why

The Gray Zone Warfare “Community - Linux Support” forum post is a long, active support thread (currently several hundred to ~1,000 messages, Oct 22 2026 → present). Discord’s search is slow, limited, and awkward for reading long technical answers. We want a fast, public, GitHub-hosted page that searches the whole thread: instant results, highlighted snippets, author/date filters, and links back to the original message.

## Goals

- Static site hosted on GitHub Pages; no backend, no login, no tracking.
- Search every message in the thread, including code blocks and attachment filenames.
- Instant client-side results with highlighted snippets and result counts.
- Filters: author, date range, attachments, code. Sort by relevance / newest / oldest.
- Every result links to the original Discord message; support copying the link.
- Show snapshot freshness (“updated <date> · N messages”) and a **Refresh data** button that reloads the latest committed snapshot.
- Reproducible update path: scrape in a logged-in browser → validate/ingest → commit → GitHub Pages redeploys.
- Mobile-friendly and keyboard-accessible.

## Non-goals

- Real-time sync or a bot that posts/replies.
- Searching other channels or servers (data model should allow it later).
- User accounts, comments, voting, analytics.
- Bypassing Discord permissions or scraping anything the maintainer cannot already see.
- Hosting or proxying Discord content from a server.
- Mirroring avatars, role badges, reactions, or server tags.

## Anti-goals (would make this a failure even if it works)

- Storing or exposing a Discord token or session in the repo, site, or CI.
- A “Refresh” button that pretends to fetch live Discord data when it only reloads a file.
- Fragile scraping that silently drops messages; completeness must be validated.

## Constraints

- The thread is behind a logged-in Discord session. GitHub Pages cannot fetch it at runtime.
- Discord virtualizes the message list; only mounted messages exist in the DOM.
- The thread is a forum post under `💾︱community-support-05` in the Gray Zone Warfare server, and is marked **Discoverable**.
- Discord DOM class names are hashed and change; use stable IDs/semantics with fallbacks.
- Scraping is done from the maintainer’s own logged-in browser session, not the Discord API.
- GitHub Pages is static; data updates require a commit/push.
- Approx. 1,000 messages is small enough for a fully client-side index.

## Approaches considered

### Data source

1. **Bundled snapshot (chosen).** Scrape the thread into `data/messages.json`, commit it, and search it client-side. Works for everyone without Discord, fast and free. Trade-off: point-in-time data and republished public messages.
2. **Live/local only.** A userscript reads the thread from the visitor’s own session. Always current and hosts no data, but only works for logged-in members and is clunky to share.
3. **Backend + bot/workflow.** A service with a bot token scrapes on demand. Best freshness, but adds secrets, hosting, abuse risk, and Discord admin/ToS work. Deferred.

### Search implementation

1. **Plain HTML/CSS/JS + MiniSearch (chosen).** No bundler, no build step, one small vendored ESM dependency. Fast for ~1k messages and easy to host on Pages.
2. **Vite + TypeScript + MiniSearch.** Nicer DX but adds a build pipeline for little benefit at this size.
3. **Pagefind.** Good snippets/UI but build-time HTML indexing and more moving parts; overkill for one JSON dataset.

## Design

### Files

```
index.html
assets/app.js
assets/styles.css
assets/search.js          # query parsing, filtering, snippets
vendor/minisearch.js      # committed ESM build
data/messages.json        # the snapshot
scripts/scrape.browser.js # paste-in DevTools scraper
scripts/ingest.mjs        # validate, dedupe, sort, write data + meta
scripts/verify.mjs        # completeness/schema checks
tests/*.test.mjs          # node:test for search + ingest
.github/workflows/deploy.yml
.nojekyll
robots.txt                # Disallow: /
README.md
LICENSE                   # MIT
```

### Data model

```json
{
  "thread": {
    "id": "1562744057388728382",
    "title": "Community - Linux Support",
    "server": "Gray Zone Warfare",
    "forumChannelId": "1561777693001777263",
    "url": "https://discord.com/channels/1166365362158313522/1562744057388728382"
  },
  "scrapedAt": "2026-11-22T00:00:00.000Z",
  "messageCount": 0,
  "messages": [
    {
      "id": "1562744057388728382",
      "ts": "2026-10-22T08:26:57.662Z",
      "author": "Virtual Yoda",
      "authorKey": "8f3c1a9d2e4b7c60",
      "kind": "human",
      "isStarter": true,
      "isOp": true,
      "content": "Hey guys, ...",
      "segments": [{"type": "text", "text": "..."}, {"type": "code", "lang": "bash", "text": "..."}],
      "links": ["https://..."],
      "replyTo": null,
      "attachments": [{"name": "screenshot.png", "type": "image"}],
      "embeds": [{"title": "...", "description": "...", "url": "..."}],
      "edited": false,
      "url": "https://discord.com/channels/1166365362158313522/1562744057388728382/1562744057388728382"
    }
  ]
}
```

- Store **plain text + structured segments**, never raw Discord HTML (avoids XSS and broken markup).
- Keep the display name plus a hidden, hashed `authorKey` (truncated SHA-256 of the Discord user ID). This keeps author filters stable across renames and same-name members without publishing user IDs. No avatars, badges, roles, reactions, or server tags.
- Attachments store **filename and type only** — no `cdn.discordapp.com` URL, because Discord attachment links are signed and expire. The attachment badge links to the original message, never to a dead file.
- Index `content`, code segments, embed titles/descriptions, forwarded content, poll question/options, sticker names, and attachment filenames.
- Include human messages and the starter. Discord system messages (joins, boosts, pins) are excluded and documented rather than silently dropped.
- Read messages deleted after scraping simply disappear on the next refresh.
- One thread now; `thread` + `messages` shape makes adding threads later straightforward.

### Search behavior

- Query syntax: plain terms are ANDed; `"exact phrase"`; `-term` excludes. Author/date handled by UI filters.
- MiniSearch fields: `content` (boost 3), `author` (1), attachment names (1), code segments (2). Prefix search on; fuzzy 0.2.
- Results: author, localized date, highlighted snippet around the best match, badges for code/attachment/reply, link to original, copy-link button.
- **Show context**: expand ±2 neighboring messages inline (the differentiator vs Discord).
- Sort: relevance (default), newest, oldest.
- Empty query: show newest 50 with “Load more”.
- URL state: `?q=&author=&from=&to=&sort=&has=code|attachment` so searches are shareable.
- Deep link `#m=<messageId>` scrolls to and highlights that result; “copy link” uses it.
- Keyboard: `/` focuses search, `Esc` clears, `Enter` opens the first result, `j/k` moves.
- Result count + search time.

### Refresh behavior

- Header shows “Snapshot: <date> · N messages”.
- **Refresh data** button fetches `data/messages.json?ts=<now>` with `cache: "no-store"`, validates, rebuilds the index, and compares `scrapedAt`. Success → “Updated to <date> (N messages)”; no change → “Already up to date.”
- The button never contacts Discord. Discord-side freshness comes from the maintainer running the scraper and pushing, which redeploys Pages (usually under a minute).

### Scraper and update flow

The **agent runs the initial scrape and subsequent refreshes** through its browser tooling; `scripts/scrape.browser.js` is also shipped as a self-contained paste-in DevTools script so the maintainer can reproduce a run. The initial snapshot is a required deliverable: every message from the Oct 22 starter to the newest message at scrape time.

Before writing selectors, capture a real DOM fixture of the thread (mounted message HTML plus the accessories region) into `tests/fixtures/`. Parser and ingest tests run against that fixture.

`scripts/scrape.browser.js`:

1. Verify the thread page and find the message list.
2. Click **Jump To Present** if present, then scroll up in screen-sized steps.
3. After each step, collect mounted messages by `li[id^="chat-messages-<threadId>-"]`, extracting:
   - message ID from the element ID
   - author from `[id^="message-username-"]` (`data-text`)
   - timestamp from `time[datetime]`
   - content/segments from `[id^="message-content-"]` (`<pre><code>` → code segment)
   - reply from the reply-context element
   - attachments/embeds from `[id^="message-accessories-"]`
   - edited flag
4. Stop when the starter message is loaded and two consecutive rounds add nothing new.
5. Also scroll back to the bottom once to catch messages that arrived during the walk.
6. Download `gzw-linux-support.json` with `{thread, scrapedAt, messages}`.

`scripts/ingest.mjs`:

- Validate required fields, message-ID uniqueness, timestamp order.
- Reject if the starter message or the newest previously known message is missing (guards against a partial scrape).
- Write `data/messages.json`, update `messageCount` and `scrapedAt`.
- Print a diff summary: added / removed / edited.

`scripts/verify.mjs` and tests:

- `node:test` coverage for query parsing, filtering, snippet/highlight logic, dedupe/sort, and the partial-scrape guard.
- `npm run verify` checks data shape and that every message has a valid Discord URL.

### Hosting

- GitHub repo, Pages via Actions on push to `main`; `.nojekyll`.
- `robots.txt` disallows crawling and `<meta name="robots" content="noindex">` on the page by default. The tool is for humans with the link; it should not become a search-engine archive of member messages.
- No analytics, cookies, fonts, or third-party requests. Everything is served from the repo (including MiniSearch).

### Privacy and conduct

- Only content visible in the public thread is included; private channels are never touched.
- Display names plus hidden hashed author keys only, no avatars or role data; every result links to the original.
- The thread is public Discord content; there is no separate removal workflow.
- Not affiliated with Discord or MADFINGER Games. The scraper runs on the maintainer’s own session and respects normal scrolling speed.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Discord DOM changes | Prefer IDs/semantics; verify sample counts and required fields; fail loudly in ingest |
| Virtualized list gaps | Walk from Present upward to the starter; require starter + latest message; two clean rounds |
| Partial scrape committed | `verify.mjs` + ingest guard on starter/newest message; CI runs tests |
| GitHub Pages cache | cache-busted fetch + `scrapedAt` comparison |
| Large DOM script | Chunked scrolling with waits; progress output |

## Builder-check decisions (settled)

- The **agent runs** the initial scrape and later refreshes; the paste-in DevTools script ships as a fallback. The initial full snapshot (Oct 22 → now) is a deliverable.
- Attachments: **filename/type only**, no expiring CDN links; the badge opens the original message.
- Author: display name + **hidden hashed author key** for stable filters.
- Index embeds, forwarded content, polls, stickers, and attachment names; exclude and document Discord system messages.
- Capture a **real DOM fixture** before writing parser tests.
- `noindex` by default; public repo.

## Proposed defaults (correct me if wrong)

- Include **display names** (no avatars/roles).
- Include **±2 message context** expander.
- Repo name `gzw-linux-support-search`, MIT license.
- GitHub owner/org: use the account you’ll push from; I’ll confirm before creating anything remote.

## Size

Project, not a small change. Expect a small static app plus scraper/ingest/tests and one Pages workflow.
