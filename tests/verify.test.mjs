import test from "node:test";
import assert from "node:assert/strict";

import { mergeSnapshot, verifySnapshot } from "../scripts/lib/ingest-core.mjs";

const THREAD = {
  id: "1560000000000000001",
  title: "Community - Linux Support",
  server: "Gray Zone Warfare",
  forumChannelId: "1561777693001777263",
  url: "https://discord.com/channels/1166365362158313522/1560000000000000001",
};

function validSnapshot() {
  return mergeSnapshot(null, {
    thread: THREAD,
    scrapedAt: "2026-11-22T00:00:00.000Z",
    messages: [
      { id: THREAD.id, ts: "2026-10-22T08:26:57.662Z", author: "Virtual Yoda", authorId: "1", content: "op" },
      { id: "1560000000000000002", ts: "2026-10-22T09:00:00.000Z", author: "tux", authorId: "2", content: "hi" },
    ],
  }).snapshot;
}

test("verifySnapshot accepts a well-formed snapshot", () => {
  const result = verifySnapshot(validSnapshot());
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("verifySnapshot rejects a messageCount that does not match", () => {
  const snapshot = validSnapshot();
  snapshot.messageCount = 99;
  const result = verifySnapshot(snapshot);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /messageCount/);
});

test("verifySnapshot rejects a missing starter message", () => {
  const snapshot = validSnapshot();
  snapshot.messages = snapshot.messages.filter((m) => m.id !== THREAD.id);
  snapshot.messageCount = snapshot.messages.length;
  const result = verifySnapshot(snapshot);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /starter/i);
});

test("verifySnapshot rejects attachment urls and mismatched message urls", () => {
  const snapshot = validSnapshot();
  snapshot.messages[1].attachments = [{ name: "a.png", type: "image", url: "https://cdn.discordapp.com/x" }];
  snapshot.messages[1].url = "https://example.com/nope";
  const result = verifySnapshot(snapshot);
  assert.equal(result.ok, false);
  const text = result.errors.join("\n");
  assert.match(text, /attachment/i);
  assert.match(text, /url/i);
});

test("verifySnapshot rejects messages with no author or authorKey", () => {
  const snapshot = validSnapshot();
  delete snapshot.messages[1].author;
  delete snapshot.messages[1].authorKey;
  const result = verifySnapshot(snapshot);
  assert.equal(result.ok, false);
  const text = result.errors.join("\n");
  assert.match(text, /author/);
  assert.match(text, /authorKey/);
});
