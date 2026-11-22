#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { verifySnapshot } from "./lib/ingest-core.mjs";

const file = process.argv[2] ?? "data/messages.json";

try {
  const snapshot = JSON.parse(await readFile(file, "utf8"));
  const result = verifySnapshot(snapshot);
  if (!result.ok) {
    console.error(`verify: ${file} is invalid`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`verify: ${file} ok — ${snapshot.messageCount} messages, updated ${snapshot.scrapedAt}`);
} catch (error) {
  console.error(`verify: ${error.message}`);
  process.exit(1);
}
