import { getRedis } from './client';
import { fetchFollowers, getEngagedUsers } from '@/lib/bsky/api';
import type { SpeedTier, EngagementStats } from '@/lib/types';

const TTL_SECONDS = 60 * 60 * 24; // 24 hours

const SPEED_CAPS: Record<SpeedTier, number | null> = {
  quick: 2000,
  balanced: 5000,
  complete: null,
};

// ── Key helpers ────────────────────────────────────────────────────────────────

function followerKey(did: string, tier: SpeedTier) {
  return `followers:${did}:${tier}`;
}

function engagementKey(did: string, tier: SpeedTier) {
  return `engagement:${did}:${tier}`;
}

function metaKey(did: string, tier: SpeedTier) {
  return `cache:meta:${did}:${tier}`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns the cached follower set or fetches + caches it.
 * Falls back to a plain fetch if Redis is not configured.
 */
export async function getOrFetchFollowers(
  did: string,
  tier: SpeedTier,
  onProgress?: (fetched: number, max: number) => void,
  signal?: AbortSignal
): Promise<{ set: Set<string>; fromCache: boolean }> {
  const redis = getRedis();
  const max = SPEED_CAPS[tier];
  const key = followerKey(did, tier);

  if (redis) {
    try {
      const cached = (await redis.smembers(key)) as string[];
      if (cached && cached.length > 0) {
        return { set: new Set(cached), fromCache: true };
      }
    } catch {
      // Redis error — fall through to fresh fetch
    }
  }

  // Fresh fetch
  const set = await fetchFollowers(did, max, onProgress, signal);

  // Fire-and-forget cache write — don't block the caller waiting for Redis
  if (redis && set.size > 0) {
    void (async () => {
      try {
        const members = Array.from(set);
        // Store in Redis in chunks (SADD has a practical limit)
        const CHUNK = 2000;
        for (let i = 0; i < members.length; i += CHUNK) {
          await redis.sadd(key, ...members.slice(i, i + CHUNK));
        }
        await redis.expire(key, TTL_SECONDS);
        await redis.hset(metaKey(did, tier), {
          cachedAt: new Date().toISOString(),
          followerCount: set.size,
        });
        await redis.expire(metaKey(did, tier), TTL_SECONDS);
      } catch {
        // Non-fatal — continue without caching
      }
    })();
  }

  return { set, fromCache: false };
}

/**
 * Returns the cached engagement set or fetches + caches it.
 */
export async function getOrFetchEngagement(
  did: string,
  tier: SpeedTier,
  maxPosts: number,
  onProgress?: (analyzed: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ set: Set<string>; stats: EngagementStats; fromCache: boolean }> {
  const redis = getRedis();
  const key = engagementKey(did, tier);

  if (redis) {
    try {
      const cached = (await redis.smembers(key)) as string[];
      if (cached && cached.length > 0) {
        return {
          set: new Set(cached),
          stats: { totalLikes: 0, totalReposts: 0, postsAnalyzed: maxPosts },
          fromCache: true,
        };
      }
    } catch {
      // Fall through
    }
  }

  const { engagers, stats } = await getEngagedUsers(did, maxPosts, onProgress, signal);

  // Fire-and-forget cache write — don't block caller waiting for Redis
  if (redis && engagers.size > 0) {
    void (async () => {
      try {
        const members = Array.from(engagers);
        // Chunk to avoid oversized Redis requests (was missing chunking)
        const CHUNK = 2000;
        for (let i = 0; i < members.length; i += CHUNK) {
          await redis.sadd(key, ...members.slice(i, i + CHUNK));
        }
        await redis.expire(key, TTL_SECONDS);
      } catch {
        // Non-fatal
      }
    })();
  }

  return { set: engagers, stats, fromCache: false };
}

/**
 * Returns the count of the intersection of two follower sets.
 * Uses Redis SINTERCARD if both sets are cached, otherwise falls back to JS.
 */
export async function intersectCount(
  set1: Set<string>,
  set2: Set<string>,
  did1: string,
  did2: string,
  tier: SpeedTier
): Promise<number> {
  const redis = getRedis();

  if (redis) {
    try {
      const count = await redis.sintercard(
        2,
        followerKey(did1, tier),
        followerKey(did2, tier)
      );
      if (typeof count === 'number' && count > 0) return count;
    } catch {
      // Fall through to JS
    }
  }

  let count = 0;
  const [smaller, larger] = set1.size <= set2.size ? [set1, set2] : [set2, set1];
  for (const did of smaller) {
    if (larger.has(did)) count++;
  }
  return count;
}

/** Returns whether a DID's follower set is already in Redis cache. */
export async function isCached(did: string, tier: SpeedTier): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const count = await redis.scard(followerKey(did, tier));
    return typeof count === 'number' && count > 0;
  } catch {
    return false;
  }
}
