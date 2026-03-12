/**
 * Build the final journalist directory from accepted matches.
 *
 * Usage:  node scripts/build-directory.mjs
 *
 * Input:  data/matches-accepted.json (auto-accepted + manually reviewed)
 * Output: data/journalist-directory.json
 */

import { readFileSync, writeFileSync } from 'fs';

const accepted = JSON.parse(readFileSync('data/matches-accepted.json', 'utf-8'));

const directory = accepted.map(entry => ({
  did: entry.did,
  handle: entry.handle,
  displayName: entry.displayName || entry.name,
  topics: entry.topics || [],
  geography: entry.geography || undefined,
  outlet: entry.outlet || undefined,
  followerCount: entry.followersCount || entry.followerCount || 0,
  matchConfidence: entry.matchConfidence,
  verified: entry.verified || false,
  addedAt: new Date().toISOString(),
}));

// Deduplicate by DID
const byDid = new Map();
for (const entry of directory) {
  if (!byDid.has(entry.did)) {
    byDid.set(entry.did, entry);
  }
}

const deduped = Array.from(byDid.values());

writeFileSync('data/journalist-directory.json', JSON.stringify(deduped, null, 2));

console.log(`Built directory with ${deduped.length} journalists (from ${accepted.length} accepted matches)`);

// Stats
const verified = deduped.filter(e => e.verified).length;
const topTopics = new Map();
for (const e of deduped) {
  for (const t of e.topics) topTopics.set(t, (topTopics.get(t) || 0) + 1);
}
const sorted = [...topTopics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

console.log(`  Verified: ${verified}`);
console.log(`  Top topics: ${sorted.map(([t, c]) => `${t}(${c})`).join(', ')}`);
console.log(`\nOutput: data/journalist-directory.json`);
