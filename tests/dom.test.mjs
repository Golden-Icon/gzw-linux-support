import test from "node:test";
import assert from "node:assert/strict";

import { highlightRanges, formatTimestamp } from "../assets/lib/dom.js";

test("highlightRanges splits plain text into marked and unmarked parts", () => {
  const parts = highlightRanges("black screen fixed", [[0, 5], [6, 12]]);
  assert.deepEqual(parts, [
    { text: "black", match: true },
    { text: " ", match: false },
    { text: "screen", match: true },
    { text: " fixed", match: false },
  ]);
});

test("highlightRanges merges overlapping ranges without duplicating text", () => {
  const parts = highlightRanges("proton fixes", [[0, 4], [2, 6]]);
  assert.equal(parts.map((p) => p.text).join(""), "proton fixes");
  assert.equal(parts.filter((p) => p.match).map((p) => p.text).join(""), "proton");
  assert.deepEqual(parts, [
    { text: "proton", match: true },
    { text: " fixes", match: false },
  ]);
});

test("highlightRanges ignores out-of-range ranges and sorts them", () => {
  const parts = highlightRanges("abcdef", [[4, 6], [0, 2], [-5, 1], [9, 12]]);
  assert.equal(parts.map((p) => p.text).join(""), "abcdef");
  assert.deepEqual(
    parts.filter((p) => p.match).map((p) => p.text),
    ["ab", "ef"],
  );
});

test("highlightRanges returns a single plain part when there are no ranges", () => {
  assert.deepEqual(highlightRanges("hello", []), [{ text: "hello", match: false }]);
});

test("formatTimestamp renders a stable, readable UTC date", () => {
  assert.equal(formatTimestamp("2026-10-22T08:26:57.662Z"), "2026-10-22 08:26 UTC");
  assert.equal(formatTimestamp("not a date"), "unknown date");
});

test("parseHash finds a permalinked message id", async () => {
  const { parseHash } = await import("../assets/lib/dom.js");
  assert.equal(parseHash("#m=1573636888751902841"), "1573636888751902841");
  assert.equal(parseHash("#m=abc"), null);
  assert.equal(parseHash(""), null);
  assert.equal(parseHash("#section"), null);
});
