import { NextRequest } from 'next/server';
import { getProfile, extractHandle } from '@/lib/bsky/api';
import { getRedis } from '@/lib/redis/client';
import { getDirectoryEntries } from '@/lib/redis/directory';
import type { SpeedTier, JournalistEntry } from '@/lib/types';

export const maxDuration = 30;

// Tier priority: prefer the largest available cached set
const TIER_PRIORITY: SpeedTier[] = ['complete', 'balanced', 'quick'];

// Jaccard-based overlap tiers
function getOverlapLevel(jaccard: number): 'high' | 'medium' | 'low' {
  if (jaccard >= 0.10) return 'high';
  if (jaccard >= 0.03) return 'medium';
  return 'low';
}

/**
 * Compute size similarity score (0-1).
 * Returns 1.0 if within ±20% of user's size, decays smoothly outside.
 */
function sizeSimilarity(userSize: number, theirSize: number): number {
  if (userSize === 0 || theirSize === 0) return 0;
  const ratio = Math.min(userSize, theirSize) / Math.max(userSize, theirSize);
  // ratio of 0.8+ (within ±20%) → score of 1.0
  // ratio of 0.5 → score ≈ 0.5
  // ratio of 0.1 → score ≈ 0.1
  if (ratio >= 0.8) return 1.0;
  // Smooth decay: map 0..0.8 → 0..0.8
  return ratio;
}

/**
 * Compute topic overlap score (0-1).
 * Supports multiple user topics — scores based on how many match.
 */
function topicSimilarity(userTopics: string[], journalistTopics: string[]): number {
  if (userTopics.length === 0 || journalistTopics.length === 0) return 0;

  const jLower = journalistTopics.map(t => t.toLowerCase());
  let matches = 0;

  for (const ut of userTopics) {
    const lower = ut.toLowerCase();
    // Exact match
    if (jLower.some(j => j === lower)) {
      matches++;
    } else if (jLower.some(j => j.includes(lower) || lower.includes(j))) {
      // Partial match counts as half
      matches += 0.5;
    }
  }

  // Score = fraction of user topics that matched (capped at 1)
  return Math.min(matches / userTopics.length, 1.0);
}

/**
 * Compute geography match score (0-1).
 */
function geoSimilarity(userGeo: string | undefined, journalistGeo: string | undefined): number {
  if (!userGeo || !journalistGeo) return 0;
  const uLower = userGeo.toLowerCase().trim();
  const jLower = journalistGeo.toLowerCase().trim();
  if (uLower === jLower) return 1.0;
  // Partial match
  if (jLower.includes(uLower) || uLower.includes(jLower)) return 0.5;
  return 0;
}

interface PartnerMatch {
  did: string;
  handle: string;
  displayName: string;
  geography: string | undefined;
  overlapCount: number;
  jaccard: number;           // intersection / union (0-1)
  overlapLevel: 'high' | 'medium' | 'low';
  // New audience potential
  newForYou: number;         // their followers you don't have
  newForThem: number;        // your followers they don't have
  theirFollowerCount: number;
  // Composite ranking signals (so UI can show "why")
  compositeScore: number;
  signals: {
    sizeMatch: boolean;      // within ±20% of user size
    topicMatch: boolean;     // shares a topic with user
    geoMatch: boolean;       // same geography
  };
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
 * GET /api/partners?handle=journalist.bsky.social&limit=20&topics=Politics,Tech&geography=US
 *
 * Ranks journalists from the directory by a composite score:
 *   - Jaccard follower overlap (40%)
 *   - Account size similarity (30%)
 *   - Topic match (20%)
 *   - Geography match (10%)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const rawHandle = searchParams.get('handle');
  const limitParam = parseInt(searchParams.get('limit') ?? '20', 10);
  // Accept comma-separated topics (e.g. "Politics,Tech") or single topic
  const topicsRaw = searchParams.get('topics') || searchParams.get('topic') || '';
  const userTopics = topicsRaw ? topicsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const userGeo = searchParams.get('geography') || undefined;

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
          error: 'no_cache',
          user: {
            did: profile.did,
            handle: profile.handle,
            followerCount: profile.followersCount ?? 0,
          },
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
    // No topic/geo hard filter — we score everything and rank by composite
    const directoryPage = await getDirectoryEntries({
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
    const journalistSetInfo: Map<string, { key: string; size: number }> = new Map();

    for (const tier of TIER_PRIORITY) {
      const pipe = redis.pipeline();
      for (const j of journalists) {
        pipe.scard(`followers:${j.did}:${tier}`);
      }
      const results = await pipe.exec();

      for (let i = 0; i < journalists.length; i++) {
        const did = journalists[i].did;
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
    const PIPELINE_BATCH = 50;
    const overlapCounts: Map<string, number> = new Map();

    for (let batch = 0; batch < comparableJournalists.length; batch += PIPELINE_BATCH) {
      const chunk = comparableJournalists.slice(batch, batch + PIPELINE_BATCH);
      const pipe = redis.pipeline();

      for (const j of chunk) {
        const jInfo = journalistSetInfo.get(j.did)!;
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
    // Composite weights
    const W_JACCARD = 0.40;
    const W_SIZE    = 0.30;
    const W_TOPIC   = 0.20;
    const W_GEO     = 0.10;

    const matches: PartnerMatch[] = [];

    for (const j of comparableJournalists) {
      const overlapCount = overlapCounts.get(j.did) ?? 0;
      const jSetSize = journalistSetInfo.get(j.did)!.size;

      // Jaccard similarity = intersection / union
      const union = userSet.size + jSetSize - overlapCount;
      const jaccard = union > 0 ? overlapCount / union : 0;

      // Normalize Jaccard for composite: cap at 0.20 = max contribution
      const jaccardNorm = Math.min(jaccard / 0.20, 1.0);

      // Size similarity
      const sizeScore = sizeSimilarity(userFollowerCount, jSetSize);

      // Topic similarity (soft signal, not hard filter)
      const topicScore = topicSimilarity(userTopics, j.topics);

      // Geography similarity
      const geoScore = geoSimilarity(userGeo, j.geography);

      // Composite score
      const compositeScore =
        W_JACCARD * jaccardNorm +
        W_SIZE    * sizeScore +
        W_TOPIC   * topicScore +
        W_GEO     * geoScore;

      // New audience potential
      const newForYou = Math.max(0, jSetSize - overlapCount);
      const newForThem = Math.max(0, userSet.size - overlapCount);

      matches.push({
        did: j.did,
        handle: j.handle,
        displayName: j.displayName,
        geography: j.geography,
        overlapCount,
        jaccard: Math.round(jaccard * 10000) / 10000,
        overlapLevel: getOverlapLevel(jaccard),
        newForYou,
        newForThem,
        theirFollowerCount: jSetSize,
        compositeScore: Math.round(compositeScore * 1000) / 1000,
        signals: {
          sizeMatch: sizeScore >= 0.8,
          topicMatch: topicScore > 0,
          geoMatch: geoScore > 0,
        },
      });
    }

    // Sort by composite score descending
    matches.sort((a, b) => b.compositeScore - a.compositeScore);

    // Apply limit
    const topMatches = matches.slice(0, limit);

    return Response.json({
      user: {
        did: profile.did,
        handle: profile.handle,
        followerCount: userFollowerCount,
        sampleSize: userSet.size,
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
