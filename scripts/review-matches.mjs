/**
 * Interactive review helper for journalist matches.
 *
 * Usage: node scripts/review-matches.mjs
 *
 * First auto-promotes high-likelihood matches (score 50-64 with strong handle match).
 * Then presents remaining review entries one at a time for quick y/n decisions.
 *
 * Input:  data/matches-accepted.json, data/matches-review.json
 * Output: data/matches-accepted.json (updated), data/matches-review.json (updated)
 */

import { readFileSync, writeFileSync } from 'fs';
import * as readline from 'readline';

const accepted = JSON.parse(readFileSync('data/matches-accepted.json', 'utf-8'));
const review = JSON.parse(readFileSync('data/matches-review.json', 'utf-8'));

console.log(`\nLoaded: ${accepted.length} accepted, ${review.length} to review\n`);

// ── Phase 1: Auto-promote obvious matches ────────────────────────────────────

function nameMatchesHandle(name, handle) {
  const nameParts = name.toLowerCase().split(/\s+/).filter(p => p.length > 2);
  const cleanHandle = handle.toLowerCase().replace(/\.bsky\.social$/, '').replace(/\./g, '');
  // At least 2 name parts found in handle, or full name compressed matches
  const matchCount = nameParts.filter(p => cleanHandle.includes(p)).length;
  if (matchCount >= 2) return true;
  // Full name without spaces
  const fullName = nameParts.join('');
  if (cleanHandle.includes(fullName)) return true;
  return false;
}

const autoPromoted = [];
const remaining = [];

for (const entry of review) {
  const displayNameMatch = entry.displayName &&
    entry.displayName.toLowerCase().trim() === entry.name.toLowerCase().trim();

  // Auto-promote if: display name matches exactly, OR handle contains the name
  if (entry.matchConfidence >= 45 && (displayNameMatch || nameMatchesHandle(entry.name, entry.handle))) {
    entry.verified = false; // Mark as auto-promoted, not human-verified
    entry.source = 'auto-promoted';
    autoPromoted.push(entry);
  } else {
    remaining.push(entry);
  }
}

console.log(`Auto-promoted ${autoPromoted.length} obvious matches (name clearly in handle)`);
console.log(`Remaining for manual review: ${remaining.length}\n`);

accepted.push(...autoPromoted);

// Save checkpoint
writeFileSync('data/matches-accepted.json', JSON.stringify(accepted, null, 2));
writeFileSync('data/matches-review.json', JSON.stringify(remaining, null, 2));

if (remaining.length === 0) {
  console.log('Nothing left to review! Run: node scripts/build-directory.mjs');
  process.exit(0);
}

// ── Phase 2: Interactive review ──────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

const newAccepted = [];
const newRejected = [];
const skippedEntries = [];

console.log('For each match, enter: y=accept, n=reject, s=skip, q=quit\n');
console.log('─'.repeat(70));

for (let i = 0; i < remaining.length; i++) {
  const e = remaining[i];
  const progress = `[${i + 1}/${remaining.length}]`;

  console.log(`\n${progress} ${e.name} (atlas) → @${e.handle} "${e.displayName}"`);
  console.log(`   Score: ${e.matchConfidence} | Followers: ${e.followersCount || '?'} | Outlet: ${e.outlet || '?'}`);
  console.log(`   Bio: ${(e.description || '').slice(0, 100)}`);
  console.log(`   🔗 https://bsky.app/profile/${e.handle}`);

  const answer = await ask('   Accept? (y/n/s/q): ');
  const choice = answer.trim().toLowerCase();

  if (choice === 'q') {
    // Save remaining as still-to-review
    skippedEntries.push(...remaining.slice(i));
    break;
  } else if (choice === 'y') {
    e.verified = true;
    newAccepted.push(e);
  } else if (choice === 'n') {
    newRejected.push(e);
  } else {
    skippedEntries.push(e);
  }
}

rl.close();

// Save results
accepted.push(...newAccepted);
writeFileSync('data/matches-accepted.json', JSON.stringify(accepted, null, 2));
writeFileSync('data/matches-review.json', JSON.stringify(skippedEntries, null, 2));

// Append rejected to rejected file if it exists
try {
  const existingRejected = JSON.parse(readFileSync('data/matches-rejected.json', 'utf-8'));
  existingRejected.push(...newRejected);
  writeFileSync('data/matches-rejected.json', JSON.stringify(existingRejected, null, 2));
} catch {
  writeFileSync('data/matches-rejected.json', JSON.stringify(newRejected, null, 2));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`Done! Accepted: +${newAccepted.length} (${accepted.length} total)`);
console.log(`Rejected: +${newRejected.length}`);
console.log(`Still to review: ${skippedEntries.length}`);
console.log(`\nNext: node scripts/build-directory.mjs`);
