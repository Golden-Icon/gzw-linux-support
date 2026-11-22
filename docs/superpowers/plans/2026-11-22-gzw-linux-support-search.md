# GZW Linux Support Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static GitHub Pages site that searches every message in the Gray Zone Warfare “Community - Linux Support” Discord thread, with fast filters, highlighted snippets, context, and links back to Discord.

**Architecture:** A no-build static site (plain HTML/CSS/ES modules) loads a committed `data/messages.json` snapshot and builds a MiniSearch index in the browser. A paste-in browser scraper produces the snapshot; a Node ingest CLI validates, normalizes, and writes it. GitHub Actions runs tests and deploys Pages.

**Tech Stack:** HTML, CSS, vanilla ES modules, MiniSearch, Node 20+ (`node:test`, `node:crypto`), GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-11-22-gzw-linux-support-search-design.md`

## Global Constraints

- Static hosting only: no backend, no server-side fetch, no analytics, cookies, third-party fonts, or runtime CDN requests.
- Node >= 20, ES modules everywhere (`"type": "module"`).
- Thread: `1562744057388728382`; server: `1166365362158313522`; forum channel: `1561777693001777263`; title `Community - Linux Support`.
- Data stores display name + hidden hashed `authorKey`; no avatars, user IDs, roles, badges, reactions, or server tags.
- Attachments: `{name, type}` only. Never store `cdn.discordapp.com` attachment URLs.
- Index text, code, embed titles/descriptions, forwarded content, polls, stickers, attachment filenames. Exclude Discord system messages and document it.
- `data/messages.json` is the single source of truth; UI never invents messages.
- Public repo, MIT license, `noindex` + `robots.txt` disallow.
- Every result links to `https://discord.com/channels/1166365362158313522/1562744057388728382/<messageId>`.

## Review Focus

1. Queries containing punctuation, `-`, quotes, `:` or code fragments (`--force`, `"black screen"`) must not throw or silently return nothing.
2. A re-scrape where messages were deleted or edited must not resurrect deleted IDs or keep stale bodies.
3. Very long messages, unbroken logs, and large code blocks must produce bounded snippets and render without layout breakage.
4. Duplicate display names and renamed members must not merge author filters or crash grouping.
5. A partial scrape (missing starter or missing previous newest message) must be rejected before it overwrites good data.

Each line gets a test in the task that owns the code: Task 2 (deleted/edited, duplicate authors), Task 3 (queries, long snippets), Task 5 (partial scrape guard).

---

### Task 1: Scaffold and data contract

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `assets/lib/search-core.js` (empty export placeholder)
- Create: `tests/smoke.test.mjs`
- Create: `data/.gitkeep`

**Interfaces:**
- Produces: `npm test` runs `node --test tests/`; `npm run serve` starts a static server on port 8080.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "gzw-linux-support-search",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "serve": "npx --yes serve -l 8080 .",
    "ingest": "node scripts/ingest.mjs",
    "verify": "node scripts/verify.mjs"
  },
  "devDependencies": {
    "minisearch": "^7.1.2"
  }
}
```

- [ ] **Step 2: Create `.gitignore`** with `node_modules/`, `.DS_Store`, `*.log`, `raw-scrape.json`.

- [ ] **Step 3: Write `tests/smoke.test.mjs`**

```js
import test from "node:test";
import assert from "node:assert/strict";

test("test harness runs", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 4: Run `npm install` and `npm test`**

Expected: one passing test.

- [ ] **Step 5: Commit**

```bash
git init
git add package.json package-lock.json .gitignore tests/smoke.test.mjs data/.gitkeep
git commit -m "chore: scaffold static search project"
```

---

### Task 2: Ingest core and CLI

**Files:**
- Create: `scripts/lib/ingest-core.mjs`
- Create: `scripts/ingest.mjs`
- Create: `tests/ingest.test.mjs`

**Interfaces:**
- Consumes: raw scrape shape `{thread, scrapedAt, messages: RawMessage[]}`.
- Produces:
  - `hashAuthor(userId: string) -> string` — first 16 hex chars of SHA-256.
  - `normalizeMessage(raw, thread) -> Message`
  - `validateScrape(raw, thread) -> {ok: boolean, errors: string[]}`
  - `mergeSnapshot(previous: Snapshot|null, incoming: RawScrape, options?) -> {snapshot: Snapshot, diff: {added, removed, edited}}`
  - CLI: `node scripts/ingest.mjs <raw.json> [--out data/messages.json]`

**Message shape (exact):**

```js
{
  id, ts, author, authorKey, kind, isStarter, isOp,
  content, segments: [{type:"text"|"code", text, lang?}],
  links: [], replyTo, attachments: [{name, type}],
  embeds: [{title?, description?, url?}], edited, url
}
```

- [ ] **Step 1: Write failing tests in `tests/ingest.test.mjs`**

Assertions:
- `hashAuthor("405370809725747200")` is 16 lowercase hex chars and stable.
- `normalizeMessage` drops any `url` from attachments, defaults `segments`/`links`/`embeds` to `[]`, sets `url` from thread + message id.
- `validateScrape` rejects: missing starter (`id === thread.id`), duplicate ids, non-ISO `ts`, and any attachment URL.
- `mergeSnapshot` dedupes by id, sorts by `ts`, counts added/removed/edited.
- **Review Focus test:** an existing message absent from the new scrape appears in `diff.removed` and is not in the output; an edited body replaces the old one.
- **Review Focus test:** two different user IDs producing the same display name yield different `authorKey`s.
- Completeness guard: throws when the previous newest message id is absent from the incoming scrape.

- [ ] **Step 2: Run `npm test`**

Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `scripts/lib/ingest-core.mjs`**

Use `node:crypto` `createHash("sha256")`. `normalizeMessage` builds the exact shape; `mergeSnapshot` uses a `Map` keyed by id. Throw `Error` with a readable message on guard failure.

- [ ] **Step 4: Implement `scripts/ingest.mjs`**

Read JSON, validate, merge with existing `data/messages.json` if present, write pretty JSON with `messageCount`, `scrapedAt`, and print the diff. Exit non-zero on validation/guard errors.

- [ ] **Step 5: Run `npm test`**

Expected: all ingest tests PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/ingest-core.mjs scripts/ingest.mjs tests/ingest.test.mjs
git commit -m "feat: add snapshot ingest and validation"
```

---

### Task 3: Verify CLI

**Files:**
- Create: `scripts/verify.mjs`
- Create: `tests/verify.test.mjs`

**Interfaces:**
- Consumes: `Snapshot`.
- Produces: `verifySnapshot(snapshot) -> {ok, errors}` exported from `scripts/lib/ingest-core.mjs`; CLI exits 1 with errors.

- [ ] **Step 1: Write failing tests**

- Valid fixture passes.
- `messageCount !== messages.length` fails.
- Missing starter fails.
- Any attachment with `url` fails.
- Message URL not matching thread/id fails.
- Missing `authorKey` or `author` fails.

- [ ] **Step 2: Run tests, expect FAIL.**

- [ ] **Step 3: Implement `verifySnapshot` and `scripts/verify.mjs`.**

- [ ] **Step 4: Run tests and `npm run verify` against a fixture; expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/ingest-core.mjs scripts/verify.mjs tests/verify.test.mjs
git commit -m "feat: add snapshot verifier"
```

---

### Task 4: Search core

**Files:**
- Create: `assets/lib/search-core.js`
- Create: `vendor/minisearch.js` (copy `node_modules/minisearch/dist/es/index.js`)
- Create: `tests/search.test.mjs`

**Interfaces:**
- Consumes: `Message[]`.
- Produces:
  - `parseQuery(input) -> {terms: string[], phrases: string[], excludes: string[]}`
  - `createSearch(messages) -> {run(filters): SearchResult[], authors(): {key,name,count}[], messagesById: Map}`
  - `SearchFilters = {q, authorKey, from, to, sort: "relevance"|"newest"|"oldest", has: "code"|"attachment"|null, limit, offset}`
  - `SearchResult = {message, score, snippet: {text, ranges: [start,end][]}}`
  - `makeSnippet(content, query, width=180) -> {text, ranges}`
  - `getContext(messages, id, radius=2) -> Message[]`
  - `parseUrlState(search) / toUrlState(state) -> string`

- [ ] **Step 1: Write failing tests**

- Plain terms AND: `"black screen"` matches only messages containing both.
- Quoted phrase matches adjacency; `-wayland` excludes.
- Punctuation/code query `--force "black screen"` does not throw and finds `--force`.
- Prefix search finds `proton` from `prot`.
- Author filter returns only that `authorKey`.
- Date range is inclusive of `from`/`to` day boundaries in UTC.
- `has: "code"` requires a code segment; `has: "attachment"` requires attachments.
- Sort newest/oldest is by `ts`; relevance keeps score order.
- **Review Focus test:** a 20,000-char unbroken log yields a snippet <= 220 chars and ranges inside it.
- **Review Focus test:** duplicate display names yield separate author entries; renamed member with same key groups under the latest name.
- `getContext` clamps at both ends and returns at most `2*radius+1`.
- URL state round-trips `q/author/from/to/sort/has`.

- [ ] **Step 2: Run tests, expect FAIL.**

- [ ] **Step 3: Implement `parseQuery` and `makeSnippet`.**

Tokenize on whitespace; quoted strings become phrases; leading `-` becomes excludes; strip surrounding quotes. Snippet finds the earliest term/phrase match, clamps a window, returns absolute ranges.

- [ ] **Step 4: Vendor MiniSearch and implement `createSearch`/`getContext`/URL state.**

Fields: `content` (boost 3), `author` (1), `attachmentNames` (1), `embedText` (2), `codeText` (2). Options: `prefix: true, fuzzy: 0.2`. Post-filter phrases, excludes, author/date/has. For empty `q`, start from all messages sorted newest and apply filters.

- [ ] **Step 5: Run tests, expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add assets/lib/search-core.js vendor/minisearch.js tests/search.test.mjs
git commit -m "feat: add client-side search core"
```

---

### Task 5: Scraper and first snapshot

**Files:**
- Create: `scripts/scrape.browser.js`
- Create: `tests/fixtures/raw-scrape.sample.json`
- Create: `data/messages.json`

**Interfaces:**
- Produces: `window.__gzwScrape({download = true}) -> Promise<RawScrape>`, and a downloaded `gzw-linux-support.json`.
- Raw message shape: `{id, ts, author, authorId, content, segments, links, replyTo, attachments:[{name,type}], embeds, edited, isStarter, isOp, isSystem}`.

- [ ] **Step 1: Write the self-contained IIFE scraper.**

Walk algorithm: find `[aria-label^="Messages in "]` list, click `Jump To Present`, then repeatedly scroll the scrollable ancestor up by 0.85 × viewport with 300 ms waits, collecting `li[id^="chat-messages-<threadId>-"]` after each step. Stop when the starter id is present and 3 consecutive rounds add no new ids; cap 600 rounds. Then click `Jump To Present` once more and collect one final round to catch messages posted during the walk.

Extract author via `[id^="message-username-"]` `data-text`, `authorId` from the avatar `src` match `/avatars\/(\d+)\//`, timestamp from `time[datetime]`, content from `[id^="message-content-"]` (split `pre code` into code segments). Also capture forwarded-message bodies, embed title/description/url, poll question/options, and sticker names into the content/embed fields. Reply id from the reply-context link; attachments (name and type only) and embeds from `[id^="message-accessories-"]`; edited from header text; `isStarter` when the id equals the thread id; `isOp` when the OP badge is present. Skip elements whose class contains `systemMessage`; log skipped-system counts and progress every 10 rounds.

- [ ] **Step 2: Run a live scrape through the agent browser tooling.**

Verify: starter id present; count > 500; newest `ts` within 30 minutes; five spot-checked messages match the page. Save raw JSON outside the repo.

- [ ] **Step 3: Add a small fixture `tests/fixtures/raw-scrape.sample.json`** (5 messages, one code block, one attachment, one reply, one edited) and extend ingest tests to run `mergeSnapshot` on it.

- [ ] **Step 4: Run `node scripts/ingest.mjs <raw.json>` then `npm run verify`.**

Expected: `data/messages.json` written, verifier passes, count printed.

- [ ] **Step 5: Commit scraper, fixture, and data.**

```bash
git add scripts/scrape.browser.js tests/fixtures/raw-scrape.sample.json data/messages.json tests/ingest.test.mjs
git commit -m "feat: add scraper and initial thread snapshot"
```

---

### Task 6: Static UI

**Files:**
- Create: `index.html`
- Create: `assets/styles.css`
- Create: `assets/app.js`
- Create: `assets/lib/dom.js`
- Create: `tests/dom.test.mjs`

**Interfaces:**
- Consumes: `createSearch`, `parseQuery`, `parseUrlState`, `toUrlState`, `getContext`.
- Produces: `highlightRanges(text, ranges) -> [{text, match}]`, `renderResult(result, handlers) -> HTMLElement`, `renderContext(messages) -> HTMLElement`.

- [ ] **Step 1: Write failing tests for `highlightRanges`** (plain, overlapping, out-of-range) and `parseUrlState` defaults.

- [ ] **Step 2: Implement `assets/lib/dom.js` pure splitter using `textContent`/`document.createTextNode`/`<mark>`; no `innerHTML` with message data.**

- [ ] **Step 3: Build `index.html` and `assets/styles.css`.**

Header: title, snapshot date/count, thread link, Refresh button, GitHub link. Search form with input, author select, from/to date inputs, sort select, has select, clear button. Results region with count and live region. Empty query shows newest 50. Responsive single-column under 720 px; dark theme; focus rings.

- [ ] **Step 4: Build `assets/app.js`.**

Load `data/messages.json`, `createSearch`, debounce input 80 ms, update URL with `replaceState`, render result cards (author, date, snippet with `<mark>`, code/attachment badge, Discord link, copy-link, context toggle). “Load more” increments limit by 50. Show a friendly error if data fails to load.

- [ ] **Step 5: Manual browser check at `npm run serve`.**

Search `black`, `proton`, `--force`, a quoted phrase, filter by author/date, check mobile width. Expected: results, highlights, no console errors.

- [ ] **Step 6: Commit**

```bash
git add index.html assets/styles.css assets/app.js assets/lib/dom.js tests/dom.test.mjs
git commit -m "feat: add search page"
```

---

### Task 7: Refresh, permalinks, context, keyboard

**Files:**
- Modify: `assets/app.js`
- Modify: `assets/lib/dom.js`
- Modify: `assets/styles.css`
- Modify: `tests/dom.test.mjs`

**Interfaces:**
- Consumes: existing UI.
- Produces: `refreshData() -> Promise<void>`, `focusMessage(id) -> void`.

- [ ] **Step 1: Write failing tests** for hash parsing (`#m=<id>`) and context rendering count.

- [ ] **Step 2: Implement the Refresh button.**

`fetch("data/messages.json?ts=" + Date.now(), {cache:"no-store"})`; on success validate shape, compare `scrapedAt`, rebuild search, update header; toast “Updated to <date>” or “Already up to date.” Disable while running.

- [ ] **Step 3: Implement permalinks, context, keyboard.**

Copy link uses `#m=<id>`; on load/`hashchange`, find and scroll to the message, highlight for 2 s. Context toggle inserts ±2 neighbors with an “in thread” divider. `/` focuses input, `Esc` clears, `Enter` opens the first result.

- [ ] **Step 4: Manual browser check** of refresh (no change), permalink, context, keyboard. Expected: no errors, no layout break.

- [ ] **Step 5: Commit**

```bash
git add assets/app.js assets/lib/dom.js assets/styles.css tests/dom.test.mjs
git commit -m "feat: add refresh, permalinks, context and keyboard"
```

---

### Task 8: Pages deploy and docs

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `.nojekyll`
- Create: `robots.txt`
- Create: `README.md`
- Create: `LICENSE`
- Modify: `index.html` (noindex meta)

- [ ] **Step 1: Add `robots.txt`** with `User-agent: *\nDisallow: /`, `.nojekyll`, and `<meta name="robots" content="noindex">`.

- [ ] **Step 2: Add the workflow.**

On push to `main` and `workflow_dispatch`: checkout, setup-node 20, `npm ci`, `npm test`, `npm run verify`, configure-pages, upload artifact from repo root, deploy-pages.

- [ ] **Step 3: Write `README.md`.**

What it is, live URL placeholder, how search works, how to update (agent runs scraper → ingest → verify → commit), data fields/privacy (public thread, names only, no attachment URLs), not affiliated with Discord/MADFINGER, MIT.

- [ ] **Step 4: Create the GitHub repo and push.**

Only if `gh auth status` is authenticated; otherwise stop and ask the user for owner/repo. Enable Pages via Actions.

- [ ] **Step 5: Verify the deployed site** loads, searches, and refreshes. Record the URL in README.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/deploy.yml .nojekyll robots.txt README.md LICENSE index.html
git commit -m "chore: add Pages deployment and docs"
```

---

### Task 9: End-to-end verification

- [ ] `npm test` — all tests pass.
- [ ] `npm run verify` — snapshot valid; starter present; count matches.
- [ ] Browser: search a known phrase, filter author + date, open context, copy permalink, refresh button, mobile viewport, no console errors.
- [ ] Confirm no attachment CDN URLs: `grep -c "cdn.discordapp.com" data/messages.json` returns 0.
- [ ] Confirm no avatar/role URLs in data; confirm `messageCount` equals length.
- [ ] Commit any fixes; report the deployed URL and what was verified.
