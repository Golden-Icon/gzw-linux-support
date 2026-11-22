import MiniSearch from "../../vendor/minisearch.js";

const ELLIPSIS = "…";
const DEFAULT_LIMIT = 50;

export function parseQuery(input = "") {
  const terms = [];
  const phrases = [];
  const excludes = [];
  let raw = String(input ?? "").trim();
  // An opening quote that is never closed is a phrase being typed, not a
  // literal quote character: finish it instead of returning nothing.
  if ((raw.match(/"/g) ?? []).length % 2 === 1) raw += '"';
  const pattern = /-"([^"]*)"|"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    if (match[1] !== undefined) {
      const value = match[1].trim().toLowerCase();
      if (value) excludes.push(value);
    } else if (match[2] !== undefined) {
      const value = match[2].trim().toLowerCase();
      if (value) phrases.push(value);
    } else {
      const token = match[3];
      if (token.startsWith("-") && !token.startsWith("--") && token.length > 1) {
        excludes.push(token.slice(1).toLowerCase());
      } else {
        terms.push(token.toLowerCase());
      }
    }
  }
  return { terms, phrases, excludes };
}

function matchSpans(haystack, needle) {
  const spans = [];
  if (!needle) return spans;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    spans.push([index, index + needle.length]);
    index = haystack.indexOf(needle, index + needle.length);
  }
  return spans;
}

export function makeSnippet(content, query, width = 180) {
  const text = String(content ?? "");
  const parsed = typeof query === "string" ? parseQuery(query) : query;
  const needles = [...parsed.terms, ...parsed.phrases].filter(Boolean);
  const lower = text.toLowerCase();

  let firstMatch = -1;
  for (const needle of needles) {
    const index = lower.indexOf(needle);
    if (index !== -1 && (firstMatch === -1 || index < firstMatch)) firstMatch = index;
  }

  let start = 0;
  if (firstMatch > width / 3) start = Math.max(0, firstMatch - Math.floor(width / 3));
  let end = Math.min(text.length, start + width);
  if (end - start < width) start = Math.max(0, end - width);
  if (end - start > width) end = start + width;

  const prefix = start > 0 ? ELLIPSIS : "";
  const suffix = end < text.length ? ELLIPSIS : "";
  const slice = text.slice(start, end);
  const ranges = [];
  const sliceLower = slice.toLowerCase();
  for (const needle of needles) {
    for (const [from, to] of matchSpans(sliceLower, needle)) {
      ranges.push([from + prefix.length, to + prefix.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);

  return { text: `${prefix}${slice}${suffix}`, ranges };
}

function allText(message) {
  return (message.segments ?? []).map((s) => s.text).join("\n");
}

function embedText(message) {
  return (message.embeds ?? [])
    .map((e) => [e.title, e.description].filter(Boolean).join(" "))
    .join("\n");
}

function attachmentNames(message) {
  return (message.attachments ?? []).map((a) => a.name).filter(Boolean).join("\n");
}

function searchableText(message) {
  return [message.content, allText(message), embedText(message), attachmentNames(message), message.author]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function snippetText(message) {
  // `content` already carries the segment text; appending the segments repeats
  // the whole body in every snippet. Add only what content does not include.
  const body = message.content || allText(message);
  const segmentText = (message.segments ?? [])
    .map((s) => s.text)
    .filter((text) => text && !body.includes(text))
    .join("\n");
  const extras = [segmentText, embedText(message), attachmentNames(message)].filter(Boolean);
  return [body, ...extras].filter(Boolean).join("\n");
}

function compareTs(a, b) {
  return Date.parse(a.message.ts) - Date.parse(b.message.ts);
}

export function createSearch(messages) {
  const list = [...messages];
  const messagesById = new Map(list.map((m) => [m.id, m]));
  const texts = new Map(list.map((m) => [m.id, searchableText(m)]));

  const mini = new MiniSearch({
    idField: "id",
    fields: ["content", "embedText", "attachmentNames", "author"],
    storeFields: ["id"],
  });
  mini.addAll(
    list.map((m) => ({
      id: m.id,
      content: m.content,
      embedText: embedText(m),
      attachmentNames: attachmentNames(m),
      author: m.author,
    })),
  );

  function matchesQuery(message, parsed) {
    const text = texts.get(message.id) ?? "";
    for (const term of parsed.terms) if (!text.includes(term)) return false;
    for (const phrase of parsed.phrases) if (!text.includes(phrase)) return false;
    for (const exclude of parsed.excludes) if (text.includes(exclude)) return false;
    return true;
  }

  function inDateRange(message, from, to) {
    const ts = Date.parse(message.ts);
    if (from) {
      const start = Date.parse(`${from}T00:00:00.000Z`);
      if (!Number.isNaN(start) && ts < start) return false;
    }
    if (to) {
      const end = Date.parse(`${to}T23:59:59.999Z`);
      if (!Number.isNaN(end) && ts > end) return false;
    }
    return true;
  }

  function run(filters = {}) {
    const parsed = parseQuery(filters.q ?? "");
    const hasQuery = parsed.terms.length > 0 || parsed.phrases.length > 0;

    // MiniSearch supplies relevance scores, but it tokenizes on word boundaries
    // and can drop substring hits. Iterate every message for correctness and
    // use the scores only as a ranking hint.
    const scores = new Map();
    if (hasQuery) {
      const query = [...parsed.terms, ...parsed.phrases].join(" ");
      try {
        for (const hit of mini.search(query, {
          prefix: true,
          fuzzy: 0.2,
          combineWith: "AND",
          boost: { content: 3, embedText: 2, attachmentNames: 1, author: 1 },
        })) {
          scores.set(hit.id, hit.score);
        }
      } catch {
        // An unparseable query still gets the substring pass below.
      }
    }

    let results = [];
    for (const message of list) {
      if (hasQuery && !matchesQuery(message, parsed)) continue;
      if (filters.authorKey && message.authorKey !== filters.authorKey) continue;
      if (filters.has === "code" && !(message.segments ?? []).some((s) => s.type === "code")) continue;
      if (filters.has === "attachment" && !(message.attachments ?? []).length) continue;
      if (!inDateRange(message, filters.from, filters.to)) continue;

      results.push({
        message,
        score: scores.get(message.id) ?? 0,
        snippet: hasQuery
          ? makeSnippet(snippetText(message), parsed)
          : makeSnippet(message.content, parsed),
      });
    }

    const sort = filters.sort ?? "relevance";
    if (sort === "newest") results.sort((a, b) => compareTs(b, a));
    else if (sort === "oldest") results.sort(compareTs);
    else if (hasQuery) results.sort((a, b) => b.score - a.score || compareTs(b, a));
    // Browsing without a query reads like the thread: oldest at the top.
    else results.sort(compareTs);

    const total = results.length;
    const offset = Math.max(0, filters.offset ?? 0);
    const limit = filters.limit ?? DEFAULT_LIMIT;
    results = results.slice(offset, offset + limit);

    return { results, total };
  }

  function authors() {
    const byKey = new Map();
    for (const message of list) {
      const entry = byKey.get(message.authorKey) ?? {
        key: message.authorKey,
        name: message.author,
        count: 0,
        latest: -Infinity,
      };
      entry.count += 1;
      const ts = Date.parse(message.ts);
      if (ts > entry.latest) {
        entry.latest = ts;
        entry.name = message.author;
      }
      byKey.set(message.authorKey, entry);
    }
    return [...byKey.values()]
      .map(({ key, name, count }) => ({ key, name, count }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  }

  return { run, authors, messagesById };
}

export function getContext(messages, id, radius = 2) {
  const index = messages.findIndex((m) => m.id === id);
  if (index === -1) return [];
  const start = Math.max(0, index - radius);
  const end = Math.min(messages.length, index + radius + 1);
  return messages.slice(start, end);
}

export function parseUrlState(search) {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const sort = params.get("sort");
  const has = params.get("has");
  return {
    q: params.get("q") ?? "",
    authorKey: params.get("author") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    sort: sort === "newest" || sort === "oldest" ? sort : "relevance",
    has: has === "code" || has === "attachment" ? has : "",
  };
}

export function toUrlState(state = {}) {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.authorKey) params.set("author", state.authorKey);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.sort && state.sort !== "relevance") params.set("sort", state.sort);
  if (state.has) params.set("has", state.has);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}
