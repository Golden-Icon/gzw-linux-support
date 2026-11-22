import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { verifySnapshot } from "../scripts/lib/ingest-core.mjs";

const snapshot = JSON.parse(
  await readFile(new URL("../data/messages.json", import.meta.url), "utf8"),
);
const byId = new Map(snapshot.messages.map((m) => [m.id, m]));

test("the committed snapshot verifies", () => {
  const result = verifySnapshot(snapshot);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("the starter message opens the snapshot", () => {
  assert.equal(snapshot.messages[0].id, snapshot.thread.id);
  assert.equal(snapshot.messages[0].isStarter, true);
});

test("no message stores an expiring Discord CDN URL", () => {
  const raw = JSON.stringify(snapshot.messages);
  assert.equal(raw.includes("cdn.discordapp.com"), false);
});

test("a reply keeps its own body instead of the quoted parent body", () => {
  // Regression: the scraper used to take the first `message-content` element in
  // a reply, which is the parent preview. This reply to Cela must keep its own
  // text, not "Reading this, good to know im not the only one with broken voip."
  const reply = byId.get("1573636554440843295");
  assert.ok(reply, "expected reply message");
  assert.equal(reply.replyTo, "1573490927182290986");
  assert.match(reply.content, /^It may just be you/);
  assert.notEqual(reply.content, byId.get(reply.replyTo).content);
});
