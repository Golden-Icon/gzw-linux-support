#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { mergeSnapshot, validateScrape } from "./lib/ingest-core.mjs";

function parseArgs(argv) {
  const args = { input: null, out: "data/messages.json" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else if (!args.input) args.input = arg;
  }
  return args;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function main() {
  const { input, out } = parseArgs(process.argv.slice(2));
  if (!input) {
    console.error("usage: node scripts/ingest.mjs <raw-scrape.json> [--out data/messages.json]");
    process.exit(2);
  }

  const raw = await readJson(input);
  if (!raw.thread) {
    console.error("ingest: raw scrape has no thread object");
    process.exit(1);
  }

  const validation = validateScrape(raw, raw.thread);
  if (!validation.ok) {
    console.error("ingest: scrape failed validation");
    for (const error of validation.errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  let previous = null;
  try {
    previous = await readJson(out);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const { snapshot, diff } = mergeSnapshot(previous, raw);

  await writeFile(out, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`wrote ${out}`);
  console.log(`snapshot: ${snapshot.messageCount} messages, updated ${snapshot.scrapedAt}`);
  console.log(`diff: +${diff.added} added, -${diff.removed} removed, ~${diff.edited} edited`);
}

main().catch((error) => {
  console.error(`ingest: ${error.message}`);
  process.exit(1);
});
