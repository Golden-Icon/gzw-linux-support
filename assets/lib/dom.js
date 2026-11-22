const ICON_COPY = "⧉";

export function formatTimestamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown date";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())} UTC`;
}

export function highlightRanges(text, ranges = []) {
  const source = String(text ?? "");
  const normalized = ranges
    .map(([start, end]) => [Math.max(0, Math.min(start, source.length)), Math.max(0, Math.min(end, source.length))])
    .filter(([start, end]) => start < end)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged = [];
  for (const [start, end] of normalized) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const parts = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: source.slice(cursor, start), match: false });
    parts.push({ text: source.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), match: false });
  if (parts.length === 0) parts.push({ text: source, match: false });
  return parts;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;

function trimUrl(url) {
  return url.replace(/[.,;:!?)\]}]+$/, "");
}

function normalizeRanges(ranges = []) {
  const normalized = ranges
    .map(([start, end]) => [Math.max(0, start), Math.max(0, end)])
    .filter(([start, end]) => start < end)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [start, end] of normalized) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function appendMarked(parent, text, from, to, ranges) {
  let cursor = from;
  for (const [rangeStart, rangeEnd] of ranges) {
    const start = Math.max(rangeStart, from);
    const end = Math.min(rangeEnd, to);
    if (start >= end) continue;
    if (start > cursor) parent.append(document.createTextNode(text.slice(cursor, start)));
    parent.append(el("mark", "", text.slice(start, end)));
    cursor = end;
  }
  if (cursor < to) parent.append(document.createTextNode(text.slice(cursor, to)));
}

function linkSpans(text, message) {
  const spans = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + url.length, url });
  }
  // Discord channel/thread mentions are spans, not anchors. They are stored in
  // message order, so find each label at or after the previous one; identical
  // labels can still point at different messages.
  let cursor = 0;
  for (const mention of message?.mentions ?? []) {
    let at = text.indexOf(mention.text, cursor);
    if (at === -1) at = text.indexOf(mention.text);
    if (at === -1) continue;
    spans.push({ start: at, end: at + mention.text.length, url: mention.url });
    cursor = at + mention.text.length;
  }
  spans.sort((a, b) => a.start - b.start);
  const out = [];
  let last = 0;
  for (const span of spans) {
    if (span.start >= last && span.end > span.start) {
      out.push(span);
      last = span.end;
    }
  }
  return out;
}

function renderLinked(node, text, spans, ranges) {
  let cursor = 0;
  for (const span of spans) {
    appendMarked(node, text, cursor, span.start, ranges);
    const link = el("a", "message-link");
    link.href = span.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    appendMarked(link, text, span.start, span.end, ranges);
    node.append(link);
    cursor = span.end;
  }
  appendMarked(node, text, cursor, text.length, ranges);
}

function snippetNode(snippet, message) {
  const node = el("p", "snippet");
  const text = String(snippet.text ?? "");
  const ranges = normalizeRanges(snippet.ranges);
  renderLinked(node, text, linkSpans(text, message), ranges);
  return node;
}

function contextBody(message) {
  const node = el("p", "context-body");
  renderLinked(node, message.content, linkSpans(message.content, message), []);
  return node;
}

export function renderContext(messages, currentId) {
  const wrap = el("div", "context");
  wrap.append(el("p", "context-label", "In the thread"));
  for (const message of messages) {
    const row = el("div", message.id === currentId ? "context-message context-current" : "context-message");
    const meta = el("div", "context-meta");
    meta.append(el("span", "context-author", message.author));
    meta.append(el("span", "context-time", formatTimestamp(message.ts)));
    row.append(meta);
    row.append(contextBody(message));
    wrap.append(row);
  }
  return wrap;
}

export function renderResult(result, handlers = {}) {
  const { message, snippet } = result;
  const card = el("article", "result");
  card.dataset.messageId = message.id;

  const meta = el("div", "result-meta");
  meta.append(el("span", "result-author", message.author));
  meta.append(el("span", "result-time", formatTimestamp(message.ts)));

  const badges = el("div", "result-badges");
  if ((message.segments ?? []).some((s) => s.type === "code")) badges.append(el("span", "badge", "code"));
  if ((message.attachments ?? []).length) badges.append(el("span", "badge", "attachment"));
  if (message.replyTo) badges.append(el("span", "badge", "reply"));
  if (message.edited) badges.append(el("span", "badge", "edited"));
  if (badges.childNodes.length) meta.append(badges);

  card.append(meta);
  card.append(snippetNode(snippet, message));

  const embedLinks = (message.embeds ?? []).filter((embed) => embed.url);
  if (embedLinks.length) {
    const row = el("div", "result-links");
    for (const embed of embedLinks) {
      const link = el("a", "embed-link", embed.title || embed.url);
      link.href = embed.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      row.append(link);
    }
    card.append(row);
  }

  const actions = el("div", "result-actions");
  if (message.replyTo) {
    const reply = el("a", "button", "Replied message");
    reply.href = message.url.replace(/\d+$/, message.replyTo);
    reply.target = "_blank";
    reply.rel = "noopener noreferrer";
    actions.append(reply);
  }
  const link = el("a", "button", "Open in Discord");
  link.href = message.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  actions.append(link);

  const copy = el("button", "button", "Copy link");
  copy.type = "button";
  copy.addEventListener("click", () => handlers.onCopy?.(message, copy));
  actions.append(copy);

  const contextButton = el("button", "button", "Show context");
  contextButton.type = "button";
  contextButton.addEventListener("click", () => handlers.onContext?.(message, card, contextButton));
  actions.append(contextButton);

  card.append(actions);
  return card;
}

export { ICON_COPY };

export function parseHash(hash) {
  const match = /^#m=(\d+)$/.exec(String(hash ?? ""));
  return match ? match[1] : null;
}
