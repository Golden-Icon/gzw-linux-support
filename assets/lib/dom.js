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

function snippetNode(snippet) {
  const node = el("p", "snippet");
  for (const part of highlightRanges(snippet.text, snippet.ranges)) {
    if (part.match) node.append(el("mark", "", part.text));
    else node.append(document.createTextNode(part.text));
  }
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
    const body = el("p", "context-body", message.content);
    row.append(body);
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
  card.append(snippetNode(snippet));

  const actions = el("div", "result-actions");
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
