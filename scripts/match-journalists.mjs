/**
 * Match atlas creators to Bluesky profiles using name search + confidence scoring.
 *
 * Usage:  node scripts/match-journalists.mjs
 *
 * Input:  data/journalist-atlas-seed.json
 * Output: data/matches-accepted.json   (score >= 65, auto-accepted)
 *         data/matches-review.json     (score 35-64, needs human review)
 *         data/matches-rejected.json   (score < 35, no good match)
 *
 * After reviewing matches-review.json, manually move confirmed entries to
 * matches-accepted.json, then run scripts/build-directory.mjs to merge into
 * data/journalist-directory.json.
 *
 * Rate limiting: 1 request per second to stay well within Bluesky limits.
 */

import { readFileSync, writeFileSync } from 'fs';

const BASE_URL = 'https://public.api.bsky.app/xrpc';
const SEARCH_LIMIT = 10;
const DELAY_MS = 1000; // 1 req/sec

// ── Confidence scoring ─────────────────────────────────────────────────────────

const JOURNALIST_KEYWORDS = /\b(journalist|reporter|editor|writer|correspondent|columnist|covering|formerly at|newsroom|newsletter|press|bureau|freelance|investigat|contributor)\b/i;

function scoreMatch(candidate, atlasName, atlasOutlet) {
  let score = 0;
  const candidateName = (candidate.displayName || '').toLowerCase().trim();
  const queryName = atlasName.toLowerCase().trim();
  const bio = (candidate.description || '').toLowerCase();

  // Display name exact match
  if (candidateName === queryName) {
    score += 40;
  } else if (candidateName.includes(queryName) || queryName.includes(candidateName)) {
    score += 25;
  }

  // Bio contains journalist keywords
  if (JOURNALIST_KEYWORDS.test(bio)) {
    score += 15;
  }

  // Bio mentions outlet
  if (atlasOutlet && bio.includes(atlasOutlet.toLowerCase())) {
    score += 10;
  }

  // Has profile photo
  if (candidate.avatar) {
    score += 5;
  }

  // Meaningful follower count
  if ((candidate.followersCount || 0) > 500) {
    score += 5;
  }

  // Handle contains part of name
  const handle = (candidate.handle || '').toLowerCase().replace(/\./g, '');
  const nameParts = queryName.split(/\s+/).filter(p => p.length > 2);
  if (nameParts.some(part => handle.includes(part))) {
    score += 5;
  }

  return score;
}

// ── Bluesky search ────────────────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function searchActors(query) {
  const url = `${BASE_URL}/app.bsky.actor.searchActors?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
      console.log(`  Rate limited, waiting ${delay}ms...`);
      await sleep(delay);
      continue;
    }

    if (!res.ok) {
      console.log(`  Search failed: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    return data.actors || [];
  }

  return [];
}

// ── Handle extraction for creators with Bluesky links ─────────────────────────

function extractHandleFromUrl(url) {
  if (!url) return null;
  const match = url.match(/bsky\.app\/profile\/([^/?#]+)/);
  return match ? match[1] : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const creators = JSON.parse(readFileSync('data/journalist-atlas-seed.json', 'utf-8'));
  console.log(`Loaded ${creators.length} creators from seed file\n`);

  const accepted = [];
  const review = [];
  const rejected = [];

  for (let i = 0; i < creators.length; i++) {
    const creator = creators[i];
    const progress = `[${i + 1}/${creators.length}]`;

    // If the atlas already has a Bluesky link, resolve directly
    if (creator.hasBlueskyLink) {
      const handle = extractHandleFromUrl(creator.externalUrl);
      if (handle) {
        console.log(`${progress} ${creator.name} — has Bluesky link: ${handle}`);
        try {
          const profileRes = await fetch(
            `${BASE_URL}/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`
          );
          if (profileRes.ok) {
            const profile = await profileRes.json();
            accepted.push({
              name: creator.name,
              did: profile.did,
              handle: profile.handle,
              displayName: profile.displayName || creator.name,
              topics: creator.topics,
              geography: creator.geography,
              outlet: creator.outlet,
              matchConfidence: 100,
              verified: true,
              source: 'atlas-bluesky-link',
            });
            await sleep(DELAY_MS);
            continue;
          }
        } catch {
          // Fall through to search
        }
      }
    }

    // Search Bluesky by name
    console.log(`${progress} ${creator.name} — searching...`);
    const candidates = await searchActors(creator.name);

    if (candidates.length === 0) {
      rejected.push({
        name: creator.name,
        outlet: creator.outlet,
        topics: creator.topics,
        geography: creator.geography,
        reason: 'no search results',
      });
      await sleep(DELAY_MS);
      continue;
    }

    // Score each candidate, pick the best
    let bestCandidate = null;
    let bestScore = 0;

    for (const c of candidates) {
      const score = scoreMatch(c, creator.name, creator.outlet);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = c;
      }
    }

    const entry = {
      name: creator.name,
      did: bestCandidate.did,
      handle: bestCandidate.handle,
      displayName: bestCandidate.displayName || '',
      description: (bestCandidate.description || '').slice(0, 200),
      followersCount: bestCandidate.followersCount || 0,
      topics: creator.topics,
      geography: creator.geography,
      outlet: creator.outlet,
      matchConfidence: bestScore,
      verified: false,
      source: 'name-search',
    };

    if (bestScore >= 65) {
      console.log(`  ✓ ACCEPTED (${bestScore}): @${bestCandidate.handle} — "${bestCandidate.displayName}"`);
      accepted.push(entry);
    } else if (bestScore >= 35) {
      console.log(`  ? REVIEW  (${bestScore}): @${bestCandidate.handle} — "${bestCandidate.displayName}"`);
      review.push(entry);
    } else {
      console.log(`  ✗ REJECTED (${bestScore}): @${bestCandidate.handle} — "${bestCandidate.displayName}"`);
      rejected.push({
        ...entry,
        reason: `low confidence (${bestScore})`,
      });
    }

    await sleep(DELAY_MS);

    // Progress checkpoint every 100
    if ((i + 1) % 100 === 0) {
      console.log(`\n--- Checkpoint: ${accepted.length} accepted, ${review.length} review, ${rejected.length} rejected ---\n`);
      // Save intermediate results
      writeFileSync('data/matches-accepted.json', JSON.stringify(accepted, null, 2));
      writeFileSync('data/matches-review.json', JSON.stringify(review, null, 2));
      writeFileSync('data/matches-rejected.json', JSON.stringify(rejected, null, 2));
    }
  }

  // Final write
  writeFileSync('data/matches-accepted.json', JSON.stringify(accepted, null, 2));
  writeFileSync('data/matches-review.json', JSON.stringify(review, null, 2));
  writeFileSync('data/matches-rejected.json', JSON.stringify(rejected, null, 2));

  console.log(`\n=== DONE ===`);
  console.log(`Accepted (auto):  ${accepted.length}`);
  console.log(`Needs review:     ${review.length}`);
  console.log(`Rejected:         ${rejected.length}`);
  console.log(`\nOutput files:`);
  console.log(`  data/matches-accepted.json`);
  console.log(`  data/matches-review.json`);
  console.log(`  data/matches-rejected.json`);
  console.log(`\nNext step: review matches-review.json, then run scripts/build-directory.mjs`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
