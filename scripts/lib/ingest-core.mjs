import { createHash } from "node:crypto";

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function hashAuthor(userId) {
  return createHash("sha256").update(String(userId)).digest("hex").slice(0, 16);
}

function discordUrl(thread, messageId) {
  return `${String(thread.url).replace(/\/+$/, "")}/${messageId}`;
}

function cleanEmbed(embed) {
  const out = {};
  for (const key of ["title", "description", "url"]) {
    if (typeof embed?.[key] === "string" && embed[key].trim()) out[key] = embed[key];
  }
  return out;
}

export function normalizeMessage(raw, thread) {
  const id = String(raw.id);
  const authorId = raw.authorId == null ? null : String(raw.authorId);
  return {
    id,
    ts: raw.ts,
    author: raw.author ?? "unknown",
    authorKey: authorId ? hashAuthor(authorId) : hashAuthor(`name:${raw.author ?? "unknown"}`),
    kind: raw.kind ?? "human",
    isStarter: raw.isStarter ?? id === String(thread.id),
    isOp: Boolean(raw.isOp),
    content: raw.content ?? "",
    segments: Array.isArray(raw.segments) ? raw.segments : [],
    links: Array.isArray(raw.links) ? raw.links : [],
    replyTo: raw.replyTo ?? null,
    attachments: (Array.isArray(raw.attachments) ? raw.attachments : []).map((a) => ({
      name: a.name,
      type: a.type,
    })),
    embeds: (Array.isArray(raw.embeds) ? raw.embeds : []).map(cleanEmbed).filter((e) => Object.keys(e).length),
    mentions: (Array.isArray(raw.mentions) ? raw.mentions : [])
      .filter((m) => typeof m?.text === "string" && typeof m?.url === "string")
      .map((m) => ({ text: m.text, url: m.url })),
    edited: Boolean(raw.edited),
    url: discordUrl(thread, id),
  };
}

export function validateScrape(raw, thread) {
  const errors = [];
  const messages = Array.isArray(raw?.messages) ? raw.messages : null;

  if (!messages) {
    return { ok: false, errors: ["scrape has no messages array"] };
  }

  const ids = new Set();
  for (const message of messages) {
    if (message == null || message.id == null) {
      errors.push("message with no id");
      continue;
    }
    const id = String(message.id);
    if (ids.has(id)) errors.push(`duplicate message id ${id}`);
    ids.add(id);

    if (typeof message.ts !== "string" || !ISO_UTC.test(message.ts) || Number.isNaN(Date.parse(message.ts))) {
      errors.push(`message ${id} has an invalid ISO timestamp: ${message.ts}`);
    }

    for (const attachment of Array.isArray(message.attachments) ? message.attachments : []) {
      if (attachment?.url) errors.push(`message ${id} attachment ${attachment.name} carries a CDN url`);
    }
  }

  if (!ids.has(String(thread.id))) {
    errors.push(`starter message ${thread.id} is missing`);
  }

  return { ok: errors.length === 0, errors };
}

function fingerprint(message) {
  return JSON.stringify({
    content: message.content,
    segments: message.segments,
    links: message.links,
    replyTo: message.replyTo,
    attachments: message.attachments,
    embeds: message.embeds,
    mentions: message.mentions,
    edited: message.edited,
    author: message.author,
    authorKey: message.authorKey,
  });
}

function sortByTs(messages) {
  return [...messages].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.id.localeCompare(b.id));
}

export function mergeSnapshot(previous, incoming, options = {}) {
  const thread = incoming.thread ?? previous?.thread;
  // The browser scraper can observe the same message across several scroll
  // rounds; collapse those before validating so only genuinely bad input fails.
  const rawMessages = Array.isArray(incoming.messages)
    ? [...new Map(incoming.messages.map((m) => [String(m?.id), m])).values()]
    : incoming.messages;
  const deduped = { ...incoming, messages: rawMessages };
  const validation = validateScrape(deduped, thread);
  if (!validation.ok) {
    throw new Error(`scrape is invalid:\n${validation.errors.join("\n")}`);
  }

  const normalized = [];
  const seen = new Set();
  for (const raw of rawMessages) {
    const id = String(raw.id);
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(normalizeMessage(raw, thread));
  }
  const messages = sortByTs(normalized);

  if (previous?.messages?.length && options.requireLatestMessage !== false) {
    const newest = sortByTs(previous.messages).at(-1);
    if (!seen.has(String(newest.id))) {
      throw new Error(
        `scrape looks incomplete: previous newest message ${newest.id} (${newest.ts}) is absent`,
      );
    }
  }

  const before = new Map((previous?.messages ?? []).map((m) => [m.id, m]));
  const after = new Map(messages.map((m) => [m.id, m]));

  let added = 0;
  let edited = 0;
  for (const [id, message] of after) {
    const old = before.get(id);
    if (!old) added += 1;
    else if (fingerprint(old) !== fingerprint(message)) edited += 1;
  }
  let removed = 0;
  for (const id of before.keys()) if (!after.has(id)) removed += 1;

  return {
    snapshot: {
      thread,
      scrapedAt: incoming.scrapedAt ?? new Date().toISOString(),
      messageCount: messages.length,
      messages,
    },
    diff: { added, removed, edited },
  };
}

export function verifySnapshot(snapshot) {
  const errors = [];
  if (!snapshot?.thread?.id || !snapshot?.thread?.url) {
    return { ok: false, errors: ["snapshot has no thread id/url"] };
  }
  const messages = snapshot.messages;
  if (!Array.isArray(messages)) return { ok: false, errors: ["snapshot has no messages array"] };

  if (snapshot.messageCount !== messages.length) {
    errors.push(`messageCount ${snapshot.messageCount} does not match ${messages.length} messages`);
  }

  const ids = new Set();
  for (const message of messages) {
    if (ids.has(message?.id)) errors.push(`duplicate message id ${message.id}`);
    if (message?.id != null) ids.add(message.id);

    for (const field of ["author", "authorKey", "ts", "url", "content"]) {
      if (message?.[field] === undefined || message?.[field] === null) {
        errors.push(`message ${message?.id} is missing ${field}`);
      }
    }
    const expectedUrl = `${String(snapshot.thread.url).replace(/\/+$/, "")}/${message?.id}`;
    if (message?.url !== expectedUrl) {
      errors.push(`message ${message?.id} has an unexpected url ${message?.url}`);
    }
    for (const attachment of message?.attachments ?? []) {
      if (attachment.url) errors.push(`message ${message.id} attachment carries a CDN url`);
    }
  }

  if (!ids.has(String(snapshot.thread.id))) errors.push("starter message is missing");

  return { ok: errors.length === 0, errors };
}
