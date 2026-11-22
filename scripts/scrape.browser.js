/*
 * Gray Zone Warfare — "Community - Linux Support" thread scraper.
 *
 * Paste this whole file into the DevTools console while the thread is open and
 * logged in. It scrolls from the newest message back to the starter, extracts
 * every mounted message, and downloads `gzw-linux-support.json`.
 *
 * It can also be driven by an automated browser:
 *   window.__GZW_NO_AUTORUN = true;  // before evaluating
 *   await window.__gzwScrape({ download: false })
 *
 * Only public thread content is read. Attachment URLs are never stored.
 */
(() => {
  const THREAD = {
    id: "1562744057388728382",
    title: "Community - Linux Support",
    server: "Gray Zone Warfare",
    forumChannelId: "1561777693001777263",
    url: "https://discord.com/channels/1166365362158313522/1562744057388728382",
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function scrollParent(node) {
    let current = node.parentElement;
    while (current) {
      const style = getComputedStyle(current);
      if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 40) {
        return current;
      }
      current = current.parentElement;
    }
    return node.parentElement?.parentElement ?? null;
  }

  function messageIdOf(li) {
    const match = /(\d+)$/.exec(li.id || "");
    return match ? match[1] : null;
  }

  function authorOf(li) {
    const el = li.querySelector('[id^="message-username-"]');
    if (!el) return null;
    const name = (el.getAttribute("data-text") || el.textContent || "").trim();
    return name || null;
  }

  function authorIdOf(li) {
    const own = li.querySelector('img[src*="/avatars/"]');
    const img = own || li.querySelector('[class*="avatar"] img[src*="/avatars/"]');
    const src = img?.getAttribute("src") || "";
    const match = /\/avatars\/(\d+)\//.exec(src);
    return match ? match[1] : null;
  }

  function timestampOf(li) {
    const time = li.querySelector("time[datetime]");
    if (time?.getAttribute("datetime")) return time.getAttribute("datetime");
    const el = li.querySelector('[id^="message-timestamp-"]');
    const stamp = el?.getAttribute("datetime") || el?.getAttribute("title");
    return stamp ? new Date(stamp).toISOString() : null;
  }

  function segmentsOf(root) {
    const segments = [];
    let buffer = "";
    const flush = () => {
      const text = buffer.replace(/\n{3,}/g, "\n\n").trim();
      if (text) segments.push({ type: "text", text });
      buffer = "";
    };
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        buffer += node.nodeValue;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === "PRE") {
        const code = node.querySelector("code") || node;
        flush();
        const lang = (/language-([\w+#-]+)/.exec(code.className || "") || [])[1];
        segments.push({ type: "code", text: code.innerText, ...(lang ? { lang } : {}) });
        return;
      }
      if (tag === "BR") {
        buffer += "\n";
        return;
      }
      if (tag === "IMG") {
        if (node.alt) buffer += ` ${node.alt} `;
        return;
      }
      for (const child of node.childNodes) walk(child);
      if (/^(DIV|P|LI|BLOCKQUOTE|H[1-6])$/.test(tag)) buffer += "\n";
    };
    walk(root);
    flush();
    return segments;
  }

  function attachmentsOf(li) {
    const out = [];
    const seen = new Set();
    const links = li.querySelectorAll('[id^="message-accessories-"] a[href*="cdn.discordapp.com/attachments"]');
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const base = decodeURIComponent((href.split("?")[0].split("/").pop() || "").trim());
      const name = (link.getAttribute("download") || link.textContent || base).trim() || base;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const isImage = /\.(png|jpe?g|gif|webp|avif|heic)$/i.test(base);
      const isVideo = /\.(mp4|webm|mov)$/i.test(base);
      out.push({ name, type: isImage ? "image" : isVideo ? "video" : "file" });
    }
    return out;
  }

  function embedsOf(li) {
    const out = [];
    const seen = new Set();
    const scope = li.querySelector('[id^="message-accessories-"]') || li;
    for (const embed of scope.querySelectorAll('[class*="embed_"], [class*="embedWrapper"]')) {
      const title = (embed.querySelector('[class*="embedTitle"]')?.textContent || "").trim();
      const description = (embed.querySelector('[class*="embedDescription"]')?.textContent || "").trim();
      const url = embed.querySelector("a[href^='http']")?.getAttribute("href") || "";
      if (!title && !description && !url) continue;
      const key = `${title}|${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...(title ? { title } : {}), ...(description ? { description } : {}), ...(url ? { url } : {}) });
    }
    return out;
  }

  function extract(li, state) {
    const id = messageIdOf(li);
    if (!id) return null;
    if (li.className.includes("systemMessage") || li.querySelector('[class*="systemMessage"]')) {
      state.skippedSystem += 1;
      return null;
    }

    const contentEl = li.querySelector('[id^="message-content-"]');
    const segments = contentEl ? segmentsOf(contentEl) : [];
    let content = contentEl ? contentEl.innerText.trim() : "";
    if (!content) {
      const forwarded = li.querySelector('[class*="forward"]');
      if (forwarded) content = forwarded.innerText.trim();
    }
    for (const sticker of li.querySelectorAll('[class*="sticker"] img[alt]')) {
      content = `${content}\n[sticker] ${sticker.alt}`.trim();
    }

    const headerAuthor = authorOf(li);
    if (headerAuthor) state.lastAuthor = headerAuthor;
    const headerAuthorId = authorIdOf(li);
    if (headerAuthorId) state.lastAuthorId = headerAuthorId;

    const edited = /\(edited\)/i.test(li.innerText || "");
    const opTag = Boolean(li.querySelector('[class*="opTag"], [aria-label*="Original Poster"]'));
    const replyLink = li.querySelector(
      '[id^="message-replied-to-"] a[href*="/channels/"], [class*="repliedMessage"] a[href*="/channels/"]',
    );

    return {
      id,
      ts: timestampOf(li),
      author: headerAuthor ?? state.lastAuthor ?? null,
      authorId: headerAuthorId ?? state.lastAuthorId ?? null,
      kind: "human",
      isStarter: id === THREAD.id,
      isOp: opTag,
      content,
      segments,
      links: contentEl
        ? [...contentEl.querySelectorAll("a[href^='http']")].map((a) => a.getAttribute("href"))
        : [],
      replyTo: replyLink ? (/\/channels\/\d+\/\d+\/(\d+)/.exec(replyLink.getAttribute("href")) || [])[1] ?? null : null,
      attachments: attachmentsOf(li),
      embeds: embedsOf(li),
      edited,
    };
  }

  function mergeRecord(into, record) {
    if (!into) return { ...record };
    const merged = into;
    for (const key of ["content", "ts", "author", "authorId", "replyTo"]) {
      if (!merged[key] && record[key]) merged[key] = record[key];
    }
    if (!merged.segments?.length && record.segments?.length) merged.segments = record.segments;
    if (!merged.attachments?.length && record.attachments?.length) merged.attachments = record.attachments;
    if (!merged.embeds?.length && record.embeds?.length) merged.embeds = record.embeds;
    if (merged.author === "unknown" && record.author) merged.author = record.author;
    merged.isOp = merged.isOp || record.isOp;
    merged.isStarter = merged.isStarter || record.isStarter;
    merged.edited = merged.edited || record.edited;
    return merged;
  }

  async function scrape(options = {}) {
    const { download = true, maxRounds = 800, stepRatio = 0.85, settle = 280, log = true } = options;
    const list = document.querySelector('[aria-label^="Messages in "]');
    if (!list) throw new Error("message list not found — open the thread and stay logged in");

    const scroller = scrollParent(list);
    if (!scroller) throw new Error("scrollable message pane not found");

    const byId = new Map();
    const state = { skippedSystem: 0, lastAuthor: null, lastAuthorId: null };

    const collect = () => {
      const nodes = [...list.querySelectorAll('li[id^="chat-messages-"]')];
      let added = 0;
      for (const li of nodes) {
        const record = extract(li, state);
        if (!record) continue;
        const existing = byId.get(record.id);
        const merged = mergeRecord(existing, record);
        if (!existing) added += 1;
        byId.set(record.id, merged);
      }
      return added;
    };

    const jumpToPresent = async () => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        /jump to present/i.test(b.textContent || ""),
      );
      if (button) {
        button.click();
        await sleep(500);
      }
    };

    await jumpToPresent();
    scroller.scrollTop = scroller.scrollHeight;
    await sleep(400);
    collect();

    let quiet = 0;
    for (let round = 0; round < maxRounds; round += 1) {
      const before = byId.size;
      const previousTop = scroller.scrollTop;
      scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.max(420, scroller.clientHeight * stepRatio));
      await sleep(settle);
      collect();

      if (scroller.scrollTop === 0) {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -900, bubbles: true, cancelable: true }));
        await sleep(settle + 120);
        collect();
      }

      const added = byId.size - before;
      if (log && round % 10 === 0) {
        console.log(`[gzw-scrape] round ${round}: ${byId.size} messages, top=${scroller.scrollTop}`);
      }

      if (byId.has(THREAD.id) && added === 0 && scroller.scrollTop === 0 && previousTop === 0) quiet += 1;
      else if (added === 0) quiet += 1;
      else quiet = 0;
      if (byId.has(THREAD.id) && quiet >= 3) break;
    }

    // Catch anything posted while we were walking back.
    await jumpToPresent();
    scroller.scrollTop = scroller.scrollHeight;
    await sleep(600);
    collect();

    const messages = [...byId.values()].filter((m) => m.ts);
    messages.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    const result = {
      thread: THREAD,
      scrapedAt: new Date().toISOString(),
      skippedSystem: state.skippedSystem,
      messages,
    };

    window.__gzwResult = result;

    if (download) {
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "gzw-linux-support.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    console.log(
      `[gzw-scrape] done: ${messages.length} messages, starter=${byId.has(THREAD.id)}, skippedSystem=${state.skippedSystem}`,
    );
    return result;
  }

  window.__gzwScrape = scrape;
  if (!window.__GZW_NO_AUTORUN) scrape();
})();
