#!/usr/bin/env node
/**
 * Backfill follower counts for all accepted journalist matches.
 * Fetches from Bluesky's getProfile API and updates the JSON file in-place.
 *
 * Usage: node scripts/backfill-follower-counts.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCEPTED_PATH = join(__dirname, '..', 'data', 'matches-accepted.json');
const BASE_URL = 'https://public.api.bsky.app/xrpc';
const DELAY_MS = 200; // Be nice to the API

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const entries = JSON.parse(readFileSync(ACCEPTED_PATH, 'utf-8'));
  console.log(`Backfilling follower counts for ${entries.length} journalists...\n`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const progress = `[${i + 1}/${entries.length}]`;

    try {
      const actor = entry.did || entry.handle;
      const res = await fetch(
        `${BASE_URL}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`
      );

      if (res.ok) {
        const profile = await res.json();
        const count = profile.followersCount ?? 0;
        entry.followersCount = count;
        console.log(`${progress} ${entry.displayName || entry.name}: ${count.toLocaleString()} followers`);
        updated++;
      } else if (res.status === 429) {
        console.log(`${progress} Rate limited, waiting 5s...`);
        await sleep(5000);
        i--; // Retry this entry
        continue;
      } else {
        console.log(`${progress} ${entry.displayName || entry.name}: HTTP ${res.status} — skipped`);
        failed++;
      }
    } catch (err) {
      console.log(`${progress} ${entry.displayName || entry.name}: ${err.message} — skipped`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  // Write back
  writeFileSync(ACCEPTED_PATH, JSON.stringify(entries, null, 2) + '\n');
  console.log(`\nDone! Updated: ${updated}, Failed: ${failed}`);
  console.log(`Written to ${ACCEPTED_PATH}`);
}

main().catch(console.error);
