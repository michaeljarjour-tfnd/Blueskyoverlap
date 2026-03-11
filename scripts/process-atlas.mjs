/**
 * Process downloaded atlas data into our seed format.
 * Prereq: curl -o data/creators-raw.json https://journalismatlas.com/assets/data/creators-data.json
 * Usage:  node scripts/process-atlas.mjs
 */

import { readFileSync, writeFileSync } from 'fs';

const raw = JSON.parse(readFileSync('data/creators-raw.json', 'utf-8'));
console.log(`Loaded ${raw.length} raw records`);

const byName = new Map();

for (const r of raw) {
  const topics = r.topic
    ? r.topic.split(/[,;]/).map(t => t.trim()).filter(Boolean)
    : [];

  const platform = (r.platform || '').toLowerCase();
  const isBluesky = platform.includes('bluesky') || platform.includes('bsky');

  const c = {
    name: (r.name || '').trim() || 'Unknown',
    outlet: (r.channel || '').trim() || undefined,
    topics,
    geography: (r.geography || '').trim() || undefined,
    primaryPlatform: (r.platform || '').trim() || undefined,
    group: (r.group || '').trim() || undefined,
    externalUrl: (r.link || '').trim() || undefined,
    hasBlueskyLink: isBluesky,
  };

  const key = c.name.toLowerCase();
  const existing = byName.get(key);

  if (existing) {
    // Merge topics from duplicate entries
    for (const t of c.topics) {
      if (!existing.topics.includes(t)) existing.topics.push(t);
    }
    // Prefer Bluesky link if found
    if (c.hasBlueskyLink && !existing.hasBlueskyLink) {
      existing.hasBlueskyLink = true;
      existing.externalUrl = c.externalUrl;
      existing.primaryPlatform = c.primaryPlatform;
    }
  } else {
    byName.set(key, { ...c });
  }
}

const deduped = Array.from(byName.values());
const bskyCount = deduped.filter(c => c.hasBlueskyLink).length;

// Topic stats
const topicCounts = new Map();
for (const c of deduped) {
  for (const t of c.topics) {
    topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
  }
}

const sorted = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

console.log(`\nDeduplicated: ${deduped.length} unique creators (from ${raw.length} records)`);
console.log(`Bluesky links found: ${bskyCount}`);
console.log(`\nTop topics:`);
for (const [topic, count] of sorted) {
  console.log(`  ${topic}: ${count}`);
}

// Show Bluesky creators
if (bskyCount > 0) {
  console.log(`\nBluesky creators:`);
  for (const c of deduped.filter(c => c.hasBlueskyLink)) {
    console.log(`  ${c.name} — ${c.externalUrl}`);
  }
}

writeFileSync('data/journalist-atlas-seed.json', JSON.stringify(deduped, null, 2));
console.log(`\nWrote ${deduped.length} creators to data/journalist-atlas-seed.json`);
