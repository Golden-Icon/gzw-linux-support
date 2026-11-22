import test from "node:test";
import assert from "node:assert/strict";

import {
  parseQuery,
  makeSnippet,
  createSearch,
  getContext,
  parseUrlState,
  toUrlState,
} from "../assets/lib/search-core.js";

let seq = 0;

function msg(overrides = {}) {
  seq += 1;
  const id = overrides.id ?? String(1600000000000000000n + BigInt(seq));
  const author = overrides.author ?? "tux";
  return {
    id,
    ts: overrides.ts ?? `2026-10-2${(seq % 9) + 1}T0${seq % 9}:00:00.000Z`,
    author,
    authorKey: overrides.authorKey ?? `key-${author}`,
    kind: "human",
    isStarter: false,
    isOp: false,
    content: overrides.content ?? "",
    segments: overrides.segments ?? [],
    links: overrides.links ?? [],
    replyTo: null,
    attachments: overrides.attachments ?? [],
    embeds: overrides.embeds ?? [],
    edited: false,
    url: `https://discord.com/channels/1/2/${id}`,
  };
}

const MESSAGES = [
  msg({ ts: "2026-10-22T08:00:00.000Z", author: "yoda", content: "Black screen on launch with proton" }),
  msg({ ts: "2026-10-23T08:00:00.000Z", author: "tux", content: "black screen fixed by --force in steam" }),
  msg({ ts: "2026-10-24T08:00:00.000Z", author: "yoda", content: "Wayland causes black flicker, try X11" }),
  msg({
    ts: "2026-10-25T08:00:00.000Z",
    author: "tux",
    content: "run this",
    segments: [{ type: "code", lang: "bash", text: "--force %command%" }],
  }),
  msg({
    ts: "2026-10-26T08:00:00.000Z",
    author: "penguin",
    content: "screenshot attached",
    attachments: [{ name: "proton-log.txt", type: "file" }],
  }),
  msg({
    ts: "2026-10-27T08:00:00.000Z",
    author: "penguin",
    content: "see guide",
    embeds: [{ title: "ProtonDB guide", description: "how to force proton", url: "https://example.com" }],
  }),
];

test("parseQuery understands terms, quoted phrases and exclusions", () => {
  assert.deepEqual(parseQuery('black screen -wayland "exact phrase"'), {
    terms: ["black", "screen"],
    phrases: ["exact phrase"],
    excludes: ["wayland"],
  });
  assert.deepEqual(parseQuery("--force"), { terms: ["--force"], phrases: [], excludes: [] });
});

test("plain terms are ANDed", () => {
  const search = createSearch(MESSAGES);
  const { results } = search.run({ q: "black screen" });
  assert.deepEqual(
    results.map((r) => r.message.content).sort(),
    ["Black screen on launch with proton", "black screen fixed by --force in steam"],
  );
});

test("quoted phrase requires adjacency and exclusions remove matches", () => {
  const search = createSearch(MESSAGES);
  assert.equal(search.run({ q: '"black screen"' }).results.length, 2);
  assert.equal(search.run({ q: "black screen" }).results.length, 2);
  assert.equal(search.run({ q: "black -flicker" }).results.length, 2);
});

test("punctuation-heavy code queries do not throw and still find the message", () => {
  const search = createSearch(MESSAGES);
  const { results } = search.run({ q: '--force "black screen"' });
  assert.ok(results.some((r) => r.message.content.includes("--force")));
});

test("prefix search finds proton from prot", () => {
  const search = createSearch(MESSAGES);
  const { results } = search.run({ q: "prot" });
  assert.ok(results.some((r) => /proton/i.test(r.message.content)));
});

test("author, date, has and sort filters apply", () => {
  const search = createSearch(MESSAGES);
  const yoda = search.authors().find((a) => a.name === "yoda");
  assert.equal(search.run({ authorKey: yoda.key }).results.length, 2);

  const ranged = search.run({ from: "2026-10-23", to: "2026-10-24" });
  assert.deepEqual(
    ranged.results.map((r) => r.message.ts.slice(0, 10)).sort(),
    ["2026-10-23", "2026-10-24"],
  );

  assert.deepEqual(
    search.run({ has: "code" }).results.map((r) => r.message.ts.slice(0, 10)),
    ["2026-10-25"],
  );
  assert.deepEqual(
    search.run({ has: "attachment" }).results.map((r) => r.message.ts.slice(0, 10)),
    ["2026-10-26"],
  );

  assert.deepEqual(
    search.run({ q: "black", sort: "oldest" }).results.map((r) => r.message.ts.slice(0, 10)),
    ["2026-10-22", "2026-10-23", "2026-10-24"],
  );
  assert.deepEqual(
    search.run({ q: "black", sort: "newest" }).results.map((r) => r.message.ts.slice(0, 10)),
    ["2026-10-24", "2026-10-23", "2026-10-22"],
  );
});

test("makeSnippet keeps a 20,000 character unbroken log whole and keeps ranges inside it", () => {
  const search = createSearch([
    msg({ content: `start ${"a".repeat(20000)} needle ${"z".repeat(500)} end` }),
    msg({ content: "plain" }),
  ]);
  const { results } = search.run({ q: "needle" });
  const snippet = results[0].snippet;
  assert.ok(snippet.text.length > 20000, `snippet was ${snippet.text.length} chars`);
  assert.match(snippet.text, /needle/);
  for (const [start, end] of snippet.ranges) {
    assert.ok(start >= 0 && end <= snippet.text.length && start < end);
    assert.equal(snippet.text.slice(start, end).toLowerCase(), "needle");
  }
});

test("same display name with different keys stays separate; a rename keeps one key", () => {
  const search = createSearch([
    msg({ author: "tux", authorKey: "1111111111111111", ts: "2026-10-22T08:00:00.000Z" }),
    msg({ author: "tux", authorKey: "2222222222222222", ts: "2026-10-23T08:00:00.000Z" }),
    msg({ author: "old-name", authorKey: "3333333333333333", ts: "2026-10-24T08:00:00.000Z" }),
    msg({ author: "new-name", authorKey: "3333333333333333", ts: "2026-10-25T08:00:00.000Z" }),
  ]);
  const authors = search.authors();
  assert.equal(authors.filter((a) => a.name === "tux").length, 2);
  const renamed = authors.find((a) => a.key === "3333333333333333");
  assert.equal(renamed.name, "new-name");
  assert.equal(renamed.count, 2);
});

test("getContext clamps at both ends", () => {
  const list = MESSAGES.slice(0, 5);
  assert.equal(getContext(list, list[0].id).length, 3);
  assert.equal(getContext(list, list[4].id).length, 3);
  assert.equal(getContext(list, list[2].id).length, 5);
  assert.equal(getContext(list, list[2].id, 1).length, 3);
});

test("URL state round-trips", () => {
  const state = {
    q: "black screen",
    authorKey: "abc",
    from: "2026-10-01",
    to: "2026-10-31",
    sort: "newest",
    has: "code",
  };
  const round = parseUrlState(toUrlState(state));
  assert.deepEqual(round, state);
  assert.deepEqual(parseUrlState(""), {
    q: "",
    authorKey: "",
    from: "",
    to: "",
    sort: "relevance",
    has: "",
  });
});

test("an empty query lists the thread oldest first, not newest first", () => {
  const search = createSearch(MESSAGES);
  const { results } = search.run({});
  const stamps = results.map((r) => r.message.ts);
  assert.deepEqual(stamps, [...stamps].sort());
  assert.equal(stamps[0], "2026-10-22T08:00:00.000Z");
});

test("an unmatched opening quote is treated as a phrase being typed", () => {
  const parsed = parseQuery('"black screen');
  assert.deepEqual(parsed.phrases, ["black screen"]);
  const search = createSearch(MESSAGES);
  const { results } = search.run({ q: '"black screen' });
  assert.ok(results.some((r) => r.message.content.includes("Black screen")));
});

test("a snippet does not repeat the message body", () => {
  const search = createSearch(MESSAGES);
  const { results } = search.run({ q: "--force" });
  const snippet = results[0].snippet.text.toLowerCase();
  assert.equal(snippet.split("--force").length - 1, 1);
});

test("substring matches are not dropped when a token match also exists", () => {
  const search = createSearch([
    msg({ content: "landing gear down", ts: "2026-10-22T08:00:00.000Z" }),
    msg({ content: "Wayland works now", ts: "2026-10-23T08:00:00.000Z" }),
    msg({ content: "an island of calm", ts: "2026-10-24T08:00:00.000Z" }),
  ]);
  const { results } = search.run({ q: "land" });
  assert.equal(results.length, 3);
});

test("a normal long post is shown whole, not cut to a window", () => {
  const body = `${"context line\n".repeat(60)}python ./gzw_voip_fix-autodetect.py\n${"more detail\n".repeat(30)}`;
  const search = createSearch([msg({ content: body })]);
  const { results } = search.run({ q: "voip" });
  assert.equal(results[0].snippet.text, body);
  assert.ok(results[0].snippet.text.includes("gzw_voip_fix-autodetect.py"));
  assert.equal(results[0].snippet.ranges.length, 1);
});
