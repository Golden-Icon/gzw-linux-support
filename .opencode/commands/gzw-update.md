---
description: Scrape the GZW "Community - Linux Support" Discord thread and publish the updated snapshot
---

Update the GZW Linux support search site end to end. Do every step below without asking for confirmation, unless a step has a stated stop condition. Change only `data/messages.json`; never touch code, HTML, CSS, tests, README, or the scraper.

Repo: `/home/golden/Projects/gzw-linux-support`
Thread: `https://discord.com/channels/1166365362158313522/1562744057388728382`
Live site: `https://golden-icon.github.io/gzw-linux-support/`

## 1. Open the thread

List browse tabs. If a Discord tab for the thread exists, use it. Otherwise navigate to the thread URL with `group: "discord"` and wait (30s) for text `Community - Linux Support`. If the thread does not load, stop and report exactly what failed.

## 2. Scrape

The Discord page CSP blocks fetching `scripts/scrape.browser.js`, so inject it base64-encoded.

Shell: `cd /home/golden/Projects/gzw-linux-support && base64 -w0 scripts/scrape.browser.js`
Take that output (call it `SRC`) and evaluate this expression in the thread tab, `world: "main"`, timeout 30s:

```js
window.__GZW_NO_AUTORUN = true;
eval(atob("SRC"));
window.__gzwDone = false;
window.__gzwResult = null;
window.__gzwErr = null;
window.__gzwScrape({ download: false })
  .then((r) => { window.__gzwResult = r; window.__gzwDone = true; })
  .catch((e) => { window.__gzwErr = String((e && e.stack) || e); window.__gzwDone = true; });
"started";
```

Replace `SRC` with the base64 output. Do not wrap the file contents any other way.

Then poll **inside the page** (not with repeated tool calls): evaluate an async function with a 1-second `setTimeout` loop, up to 110 seconds, until `window.__gzwDone`. Return JSON with: `count` (`__gzwResult.messages.length`), whether the starter message `1562744057388728382` is present, `error` (`__gzwErr`), and the last message's `ts` and `author`.

Stop without committing if `error` is set, the starter is missing, or the scrape returns zero messages.

## 3. Transfer the scrape to disk

In the page, copy the result as JSON:

```js
navigator.clipboard.writeText(JSON.stringify(window.__gzwResult))
```

Then in the shell:

```sh
WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR=/run/user/1000 wl-paste > /tmp/opencode/raw-scrape.json
cd /home/golden/Projects/gzw-linux-support
python3 -c "import json; d=json.load(open('/tmp/opencode/raw-scrape.json')); print(len(d['messages']), d['messages'][-1]['ts'], d['messages'][-1]['author'])"
```

The printed count must match the in-page count. If it does not, stop and report.

## 4. Ingest and verify

```sh
cd /home/golden/Projects/gzw-linux-support
node scripts/ingest.mjs /tmp/opencode/raw-scrape.json
npm run verify
```

Capture the printed diff line: `+added, -removed, ~edited`.

Stop without committing if `removed` is greater than 0, or if both `added` and `edited` are 0 (nothing changed, so there is nothing to publish). In those cases report the diff and wait.

## 5. Commit only the snapshot

```sh
cd /home/golden/Projects/gzw-linux-support
git status --short
git add data/messages.json
git commit -m "chore: refresh snapshot (<N> messages)"
git push
```

Use the new message count for `<N>`. If `git status` shows any other modified file, leave it uncommitted.

## 6. Wait for the publish

The push triggers the GitHub Pages build. **Never POST a manual build** — a manual trigger racing the push is what caused past failures.

Poll every 8 seconds for up to 120 seconds:

```sh
gh api repos/Golden-Icon/gzw-linux-support/pages/builds/latest --jq '{status,commit,error:.error.message}'
```

Wait until `status` is `built` for the commit you just pushed. If it errors or does not finish, report the status and the error; do not re-trigger.

## 7. Confirm the published file

```sh
curl -s "https://golden-icon.github.io/gzw-linux-support/data/messages.json?x=$(date +%s)" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['messages']), d['scrapedAt'])"
```

The count and `scrapedAt` must match the committed snapshot.

## 8. Report

Reply with:

- new message count
- diff (`+added, -removed, ~edited`)
- commit hash
- build status
- live count and snapshot time from step 7
- the site link: `https://golden-icon.github.io/gzw-linux-support/`

Keep the report short. Do not add commentary about the process or suggest other changes.
