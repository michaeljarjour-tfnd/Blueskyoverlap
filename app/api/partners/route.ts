import { NextRequest } from 'next/server';
import { getProfile, extractHandle } from '@/lib/bsky/api';
import { getRedis } from '@/lib/redis/client';
import { getDirectoryEntries } from '@/lib/redis/directory';
import type { SpeedTier, JournalistEntry } from '@/lib/types';

export const maxDuration = 30;

// Tier priority: prefer the largest available cached set
const TIER_PRIORITY: SpeedTier[] = ['complete', 'balanced', 'quick'];

// Match type thresholds (overlap percentage)
function getMatchType(overlapPct: number): string {
  if (overlapPct > 25) return 'Woodward & Bernstein';
  if (overlapPct > 10) return 'Kara & Scott';
  if (overlapPct > 3)  return 'Thompson & Wolfe';
  return 'Buried lede';
}

interface PartnerMatch {
  did: string;
  handle: string;
  displayName: string;
  topics: string[];
  geography: string | undefined;
  overlapCount: number;
  overlapPercent: number;
  matchType: string;
  matchConfidence: number;
}

/**
 * Find the best available cached follower set for a DID.
 * Returns the Redis key and the set size, or null if nothing is cached.
 */
async function findBestFollowerSet(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  did: string
): Promise<{ key: string; size: number; tier: SpeedTier } | null> {
  // Check all tiers in one pipeline
  const pipe = redis.pipeline();
  for (const tier of TIER_PRIORITY) {
    pipe.scard(`followers:${did}:${tier}`);
  }
  const results = await pipe.exec();

  for (let i = 0; i < TIER_PRIORITY.length; i++) {
    const size = (results[i] as number) ?? 0;
    if (size > 0) {
      return {
        key: `followers:${did}:${TIER_PRIORITY[i]}`,
        size,
        tier: TIER_PRIORITY[i],
      };
    }
  }
  return null;
}

/**
 * GET /api/partners?handle=journalist.bsky.social&limit=20&topic=politics
 *
 * Ranks journalists from the directory by follower overlap with the given user.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const rawHandle = searchParams.get('handle');
  const limitParam = parseInt(searchParams.get('limit') ?? '20', 10);
  const topic = searchParams.get('topic') || undefined;

  if (!rawHandle) {
    return Response.json(
      { error: 'Missing required "handle" query parameter' },
      { status: 400 }
    );
  }

  const limit = Math.min(Math.max(1, limitParam), 100);

  const redis = getRedis();
  if (!redis) {
    return Response.json(
      { error: 'Redis is not configured. This feature requires caching.' },
      { status: 503 }
    );
  }

  try {
    // ── 1. Resolve the user's handle to a profile (gives us DID + metadata) ──
    const handle = extractHandle(rawHandle);
    const profile = await getProfile(handle);

    // ── 2. Find the user's best cached follower set ─────────────────────────
    const userSet = await findBestFollowerSet(redis, profile.did);

    if (!userSet) {
      return Response.json(
        {
          error: 'No cached followers found for this account. Please run a follower analysis first at the main page, then come back to find partners.',
        },
        { status: 404 }
      );
    }

    // Also try to get a more accurate follower count from cache metadata
    let userFollowerCount = userSet.size;
    try {
      const meta = await redis.hgetall(`cache:meta:${profile.did}:${userSet.tier}`) as Record<string, unknown> | null;
      if (meta?.followerCount) {
        userFollowerCount = Number(meta.followerCount);
      }
    } catch {
      // Non-critical — fall back to set size
    }
    // Also use profile followerCount if available and larger
    if (profile.followersCount && profile.followersCount > userFollowerCount) {
      userFollowerCount = profile.followersCount;
    }

    // ── 3. Get all journalists from the directory ───────────────────────────
    // Pull a large page — we need all of them for comparison
    const directoryPage = await getDirectoryEntries({
      topic,
      limit: 1000,
      offset: 0,
    });

    const journalists = directoryPage.entries;
    const totalJournalists = directoryPage.total;

    if (journalists.length === 0) {
      return Response.json({
        user: {
          did: profile.did,
          handle: profile.handle,
          followerCount: userFollowerCount,
        },
        matches: [],
        totalJournalists: 0,
        comparedCount: 0,
      });
    }

    // ── 4. Find which journalists have cached follower sets ─────────────────
    // First, check all journalist follower set sizes in a single pipeline
    // per tier. We check all tiers to find the best available set per journalist.
    const journalistSetInfo: Map<string, { key: string; size: number }> = new Map();

    // Batch SCARD for all journalists across all tiers
    for (const tier of TIER_PRIORITY) {
      const pipe = redis.pipeline();
      for (const j of journalists) {
        pipe.scard(`followers:${j.did}:${tier}`);
      }
      const results = await pipe.exec();

      for (let i = 0; i < journalists.length; i++) {
        const did = journalists[i].did;
        // Only set if we don't already have a better (higher-tier) set
        if (!journalistSetInfo.has(did)) {
          const size = (results[i] as number) ?? 0;
          if (size > 0) {
            journalistSetInfo.set(did, {
              key: `followers:${did}:${tier}`,
              size,
            });
          }
        }
      }
    }

    // Filter to only journalists with cached data
    const comparableJournalists: JournalistEntry[] = [];
    for (const j of journalists) {
      if (journalistSetInfo.has(j.did)) {
        comparableJournalists.push(j);
      }
    }

    if (comparableJournalists.length === 0) {
      return Response.json({
        user: {
          did: profile.did,
          handle: profile.handle,
          followerCount: userFollowerCount,
        },
        matches: [],
        totalJournalists,
        comparedCount: 0,
      });
    }

    // ── 5. Compute overlaps using pipelined SINTER ──────────────────────────
    // For performance, we batch SINTER operations in pipeline chunks.
    // Each SINTER returns the full intersection set, which we count client-side.
    // For very large sets this could be expensive, but typically journalist
    // follower caches are capped at 5k-10k, making SINTER reasonable.
    const PIPELINE_BATCH = 50; // Process 50 SINTER ops per pipeline
    const overlapCounts: Map<string, number> = new Map();

    for (let batch = 0; batch < comparableJournalists.length; batch += PIPELINE_BATCH) {
      const chunk = comparableJournalists.slice(batch, batch + PIPELINE_BATCH);
      const pipe = redis.pipeline();

      for (const j of chunk) {
        const jInfo = journalistSetInfo.get(j.did)!;
        // Use SINTERCARD if available (Redis 7+), otherwise fall back to SINTER
        // Upstash @upstash/redis may not expose sintercard, so we use sinter
        pipe.sinter(userSet.key, jInfo.key);
      }

      const results = await pipe.exec();

      for (let i = 0; i < chunk.length; i++) {
        const result = results[i];
        if (Array.isArray(result)) {
          overlapCounts.set(chunk[i].did, result.length);
        } else {
          overlapCounts.set(chunk[i].did, 0);
        }
      }
    }

    // ── 6. Score, rank, and build response ──────────────────────────────────
    const matches: PartnerMatch[] = [];

    for (const j of comparableJournalists) {
      const overlapCount = overlapCounts.get(j.did) ?? 0;
      const jSetSize = journalistSetInfo.get(j.did)!.size;

      // overlap percentage = intersection / min(userFollowers, journalistFollowers)
      const minSize = Math.min(userSet.size, jSetSize);
      const overlapPercent = minSize > 0
        ? (overlapCount / minSize) * 100
        : 0;

      matches.push({
        did: j.did,
        handle: j.handle,
        displayName: j.displayName,
        topics: j.topics,
        geography: j.geography,
        overlapCount,
        overlapPercent: Math.round(overlapPercent * 100) / 100, // 2 decimal places
        matchType: getMatchType(overlapPercent),
        matchConfidence: j.matchConfidence,
      });
    }

    // Sort by overlap percentage descending
    matches.sort((a, b) => b.overlapPercent - a.overlapPercent);

    // Apply limit
    const topMatches = matches.slice(0, limit);

    return Response.json({
      user: {
        did: profile.did,
        handle: profile.handle,
        followerCount: userFollowerCount,
      },
      matches: topMatches,
      totalJournalists,
      comparedCount: comparableJournalists.length,
    });
  } catch (err) {
    const message = (err as Error).message ?? 'An unexpected error occurred';

    // Handle specific Bluesky API errors
    if (message.includes('not found') || message.includes('Could not find')) {
      return Response.json(
        { error: `Could not find Bluesky account: ${rawHandle}` },
        { status: 404 }
      );
    }

    return Response.json(
      { error: message },
      { status: 500 }
    );
  }
}
