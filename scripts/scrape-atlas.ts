/**
 * Scrape journalist data from journalismatlas.com
 *
 * The atlas serves its creator database as a static JSON file:
 *   https://journalismatlas.com/assets/data/creators-data.json
 *
 * Usage:  npx tsx scripts/scrape-atlas.ts
 * Output: data/journalist-atlas-seed.json
 *
 * If fetch is slow, pre-download with:
 *   curl -o data/creators-raw.json https://journalismatlas.com/assets/data/creators-data.json
 * Then run this script — it will use the local file if present.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

interface RawCreator {
  name: string;
  channel: string;
  link: string;
  platform: string;
  topic: string;
  geography: string;
  group: string;
}

export interface AtlasCreator {
  name: string;
  outlet?: string;
  topics: string[];
  geography?: string;
  primaryPlatform?: string;
  group?: string;
  externalUrl?: string;
  /** True if the atlas lists this creator with a Bluesky profile */
  hasBlueskyLink: boolean;
}

const SOURCE_URL = 'https://journalismatlas.com/assets/data/creators-data.json';
const LOCAL_CACHE = resolve(__dirname, '..', 'data', 'creators-raw.json');

async function loadRawData(): Promise<RawCreator[]> {
  // Prefer local file if it exists (faster, avoids network issues)
  if (existsSync(LOCAL_CACHE)) {
    console.log(`Using local file: ${LOCAL_CACHE}`);
    return JSON.parse(readFileSync(LOCAL_CACHE, 'utf-8'));
  }

  console.log(`Fetching from ${SOURCE_URL}...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function main() {
  const raw = await loadRawData();
  console.log(`Loaded ${raw.length} raw creator records.`);

  // Normalize into our schema
  const creators: AtlasCreator[] = raw.map((r) => {
    const topics = r.topic
      ? r.topic.split(/[,;]/).map((t) => t.trim()).filter(Boolean)
      : [];

    const isBluesky = r.platform?.toLowerCase().includes('bluesky') ||
                      r.platform?.toLowerCase().includes('bsky');

    return {
      name: r.name?.trim() || 'Unknown',
      outlet: r.channel?.trim() || undefined,
      topics,
      geography: r.geography?.trim() || undefined,
      primaryPlatform: r.platform?.trim() || undefined,
      group: r.group?.trim() || undefined,
      externalUrl: r.link?.trim() || undefined,
      hasBlueskyLink: isBluesky,
    };
  });

  // Deduplicate by name (some creators appear multiple times with different platforms)
  const byName = new Map<string, AtlasCreator>();
  for (const c of creators) {
    const key = c.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      // Merge topics
      for (const t of c.topics) {
        if (!existing.topics.includes(t)) existing.topics.push(t);
      }
      // If this entry has a Bluesky link, prefer it
      if (c.hasBlueskyLink && !existing.hasBlueskyLink) {
        existing.hasBlueskyLink = true;
        existing.externalUrl = c.externalUrl;
        existing.primaryPlatform = c.primaryPlatform;
      }
    } else {
      byName.set(key, { ...c });
    }
  }

  const deduplicated = Array.from(byName.values());

  // Stats
  const blueskyCount = deduplicated.filter((c) => c.hasBlueskyLink).length;
  const topicCounts = new Map<string, number>();
  for (const c of deduplicated) {
    for (const t of c.topics) {
      topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
    }
  }

  console.log(`\nDeduplicated: ${deduplicated.length} unique creators (from ${raw.length} records)`);
  console.log(`Bluesky links found: ${blueskyCount}`);
  console.log(`\nTop topics:`);
  const sortedTopics = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [topic, count] of sortedTopics) {
    console.log(`  ${topic}: ${count}`);
  }

  // Write output
  const outPath = resolve(__dirname, '..', 'data', 'journalist-atlas-seed.json');
  writeFileSync(outPath, JSON.stringify(deduplicated, null, 2));
  console.log(`\nWrote ${deduplicated.length} creators to ${outPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
