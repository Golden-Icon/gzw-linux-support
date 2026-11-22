import test from "node:test";
import assert from "node:assert/strict";

import {
  hashAuthor,
  normalizeMessage,
  validateScrape,
  mergeSnapshot,
} from "../scripts/lib/ingest-core.mjs";

const THREAD = {
  id: "1560000000000000001",
  title: "Community - Linux Support",
  server: "Gray Zone Warfare",
  forumChannelId: "1561777693001777263",
  url: "https://discord.com/channels/1166365362158313522/1560000000000000001",
};

function raw(overrides = {}) {
  return {
    id: "1560000000000000002",
    ts: "2026-10-22T08:26:57.662Z",
    author: "Virtual Yoda",
    authorId: "405370809725747200",
    kind: "human",
    isStarter: false,
    isOp: false,
    content: "hello",
    segments: [],
    links: [],
    replyTo: null,
    attachments: [],
    embeds: [],
    edited: false,
    ...overrides,
  };
}

function scrape(messages) {
  return {
    thread: THREAD,
    scrapedAt: "2026-11-22T00:00:00.000Z",
    messages,
  };
}

test("hashAuthor returns 16 lowercase hex chars, stable and id-specific", () => {
  const a = hashAuthor("405370809725747200");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, hashAuthor("405370809725747200"));
  assert.notEqual(a, hashAuthor("405370809725747201"));
});

test("normalizeMessage strips attachment urls, defaults collections, and builds a Discord url", () => {
  const message = normalizeMessage(
    raw({
      attachments: [
        {
          name: "screenshot.png",
          type: "image",
          url: "https://cdn.discordapp.com/attachments/1/2/screenshot.png?ex=deadbeef",
        },
      ],
      segments: undefined,
      links: undefined,
      embeds: undefined,
    }),
    THREAD,
  );

  assert.deepEqual(message.attachments, [{ name: "screenshot.png", type: "image" }]);
  assert.deepEqual(message.segments, []);
  assert.deepEqual(message.links, []);
  assert.deepEqual(message.embeds, []);
  assert.equal(
    message.url,
    "https://discord.com/channels/1166365362158313522/1560000000000000001/1560000000000000002",
  );
  assert.equal(message.author, "Virtual Yoda");
  assert.equal(message.authorKey, hashAuthor("405370809725747200"));
  assert.equal(message.kind, "human");
});

test("validateScrape rejects a scrape with no starter message", () => {
  const result = validateScrape(scrape([raw({ id: "1560000000000000002" })]), THREAD);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /starter/i);
});

test("validateScrape rejects duplicate ids, bad timestamps and attachment urls", () => {
  const dup = validateScrape(
    scrape([
      raw({ id: THREAD.id, isStarter: true }),
      raw({ id: "1560000000000000002" }),
      raw({ id: "1560000000000000002" }),
    ]),
    THREAD,
  );
  assert.equal(dup.ok, false);
  assert.match(dup.errors.join("\n"), /duplicate/i);

  const badTs = validateScrape(
    scrape([raw({ id: THREAD.id, isStarter: true }), raw({ ts: "yesterday" })]),
    THREAD,
  );
  assert.equal(badTs.ok, false);
  assert.match(badTs.errors.join("\n"), /timestamp/i);

  const attachmentUrl = validateScrape(
    scrape([
      raw({ id: THREAD.id, isStarter: true }),
      raw({ attachments: [{ name: "a.png", type: "image", url: "https://cdn.discordapp.com/x" }] }),
    ]),
    THREAD,
  );
  assert.equal(attachmentUrl.ok, false);
  assert.match(attachmentUrl.errors.join("\n"), /attachment/i);
});

test("mergeSnapshot dedupes by id, sorts by timestamp and counts additions", () => {
  const { snapshot, diff } = mergeSnapshot(null, {
    ...scrape([
      raw({ id: THREAD.id, isStarter: true, ts: "2026-10-22T08:26:57.662Z" }),
      raw({ id: "1560000000000000003", ts: "2026-10-23T00:00:00.000Z" }),
      raw({ id: "1560000000000000002", ts: "2026-10-22T09:00:00.000Z" }),
      raw({ id: "1560000000000000002", ts: "2026-10-22T09:00:00.000Z" }),
    ]),
  });

  assert.deepEqual(
    snapshot.messages.map((m) => m.id),
    [THREAD.id, "1560000000000000002", "1560000000000000003"],
  );
  assert.equal(snapshot.messageCount, 3);
  assert.equal(diff.added, 3);
  assert.equal(diff.removed, 0);
  assert.equal(diff.edited, 0);
});

test("mergeSnapshot drops deleted messages and replaces edited bodies", () => {
  const first = mergeSnapshot(null, {
    ...scrape([
      raw({ id: THREAD.id, isStarter: true, ts: "2026-10-22T08:26:57.662Z" }),
      raw({ id: "1560000000000000002", ts: "2026-10-22T09:00:00.000Z", content: "old body" }),
      raw({ id: "1560000000000000003", ts: "2026-10-22T10:00:00.000Z", content: "gone" }),
      raw({ id: "1560000000000000004", ts: "2026-10-22T10:30:00.000Z", content: "still here" }),
    ]),
  }).snapshot;

  const { snapshot, diff } = mergeSnapshot(first, {
    ...scrape([
      raw({ id: THREAD.id, isStarter: true, ts: "2026-10-22T08:26:57.662Z" }),
      raw({ id: "1560000000000000002", ts: "2026-10-22T09:00:00.000Z", content: "new body" }),
      raw({ id: "1560000000000000004", ts: "2026-10-22T10:30:00.000Z", content: "still here" }),
      raw({ id: "1560000000000000005", ts: "2026-10-22T11:00:00.000Z", content: "fresh" }),
    ]),
  });

  assert.deepEqual(
    snapshot.messages.map((m) => m.id),
    [THREAD.id, "1560000000000000002", "1560000000000000004", "1560000000000000005"],
  );
  assert.equal(snapshot.messages[1].content, "new body");
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.equal(diff.edited, 1);
});

test("two members sharing a display name get distinct author keys", () => {
  const a = normalizeMessage(raw({ author: "tux", authorId: "100000000000000001" }), THREAD);
  const b = normalizeMessage(raw({ author: "tux", authorId: "100000000000000002" }), THREAD);
  assert.equal(a.author, b.author);
  assert.notEqual(a.authorKey, b.authorKey);
});

test("mergeSnapshot refuses a scrape missing the previous newest message", () => {
  const previous = mergeSnapshot(null, {
    ...scrape([
      raw({ id: THREAD.id, isStarter: true, ts: "2026-10-22T08:26:57.662Z" }),
      raw({ id: "1560000000000000009", ts: "2026-11-21T09:51:11.038Z" }),
    ]),
  }).snapshot;

  assert.throws(
    () =>
      mergeSnapshot(previous, {
        ...scrape([
          raw({ id: THREAD.id, isStarter: true, ts: "2026-10-22T08:26:57.662Z" }),
          raw({ id: "1560000000000000010", ts: "2026-11-22T00:00:00.000Z" }),
        ]),
      }),
    /newest|complete/i,
  );
});

test("the recorded scrape fixture ingests into a verifiable snapshot", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/raw-scrape.sample.json", import.meta.url), "utf8"),
  );
  const { snapshot, diff } = mergeSnapshot(null, fixture);

  assert.equal(snapshot.messageCount, 5);
  assert.equal(diff.added, 5);
  assert.equal(snapshot.messages[0].isStarter, true);
  assert.equal(snapshot.messages[1].replyTo, fixture.thread.id);
  assert.equal(snapshot.messages[2].segments[1].lang, "bash");
  assert.deepEqual(snapshot.messages[3].attachments, [{ name: "proton-log.txt", type: "file" }]);
  assert.equal(snapshot.messages[4].edited, true);
});

test("channel mentions keep their label and target, including identical labels", () => {
  const link = "https://discord.com/channels/1166365362158313522/1562744057388728382/";
  const message = normalizeMessage(
    raw({
      mentions: [
        { text: "Community - Linux Support", url: `${link}1566857432401973369` },
        { text: "Community - Linux Support", url: `${link}1566861381507096787` },
        { text: "drop me" },
      ],
    }),
    THREAD,
  );
  assert.deepEqual(message.mentions, [
    { text: "Community - Linux Support", url: `${link}1566857432401973369` },
    { text: "Community - Linux Support", url: `${link}1566861381507096787` },
  ]);
});
