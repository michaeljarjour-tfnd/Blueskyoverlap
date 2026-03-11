import { getRedis } from './client';
import type { SpeedTier, FetchDataType } from '@/lib/types';

const PARTIAL_TTL = 60 * 60; // 1 hour — partial data expires if abandoned
const FINAL_TTL = 60 * 60 * 24; // 24 hours — same as existing cache
const CHUNK_SIZE = 2000; // SADD batch size

// ── Key helpers ──────────────────────────────────────────────────────────────

function progressKey(did: string, tier: SpeedTier, dataType: FetchDataType) {
  return `fetch:progress:${did}:${tier}:${dataType}`;
}

function partialKey(did: string, tier: SpeedTier, dataType: FetchDataType) {
  return `fetch:partial:${did}:${tier}:${dataType}`;
}

function finalKey(did: string, tier: SpeedTier, dataType: FetchDataType) {
  return dataType === 'followers'
    ? `followers:${did}:${tier}`
    : `engagement:${did}:${tier}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface ChunkedProgress {
  cursor?: string;
  fetched: number;
  total: number;
  /** For engagement: post URIs from the initial feed fetch.
   *  Stored as JSON string via hset, but Upstash may auto-deserialize
   *  it back into an array, so consumers must handle both types. */
  feedUris?: string | string[];
  /** For engagement: index of next post to process */
  postIndex?: number;
}

/** Check if the final (complete) set already exists in Redis */
export async function isFinalCached(
  did: string,
  tier: SpeedTier,
  dataType: FetchDataType
): Promise<{ cached: boolean; count: number }> {
  const redis = getRedis();
  if (!redis) return { cached: false, count: 0 };
  try {
    const count = await redis.scard(finalKey(did, tier, dataType));
    return { cached: typeof count === 'number' && count > 0, count: count ?? 0 };
  } catch {
    return { cached: false, count: 0 };
  }
}

/** Get in-progress state (cursor, fetched count, etc.) */
export async function getProgress(
  did: string,
  tier: SpeedTier,
  dataType: FetchDataType
): Promise<ChunkedProgress | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const data = await redis.hgetall(progressKey(did, tier, dataType));
    if (!data || Object.keys(data).length === 0) return null;
    const raw = data as Record<string, unknown>;
    // feedUris may be a string (JSON) or already an array (Upstash auto-deserializes valid JSON)
    const rawFeedUris = raw.feedUris;
    let feedUris: string | string[] | undefined;
    if (Array.isArray(rawFeedUris)) {
      feedUris = rawFeedUris as string[];
    } else if (typeof rawFeedUris === 'string' && rawFeedUris.length > 0) {
      feedUris = rawFeedUris;
    }
    return {
      cursor: (raw.cursor as string) || undefined,
      fetched: parseInt(String(raw.fetched ?? '0'), 10),
      total: parseInt(String(raw.total ?? '0'), 10),
      feedUris,
      postIndex: raw.postIndex != null
        ? parseInt(String(raw.postIndex), 10)
        : undefined,
    };
  } catch {
    return null;
  }
}

/** Save in-progress state */
export async function saveProgress(
  did: string,
  tier: SpeedTier,
  dataType: FetchDataType,
  progress: ChunkedProgress
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = progressKey(did, tier, dataType);
    const fields: Record<string, string> = {
      fetched: String(progress.fetched),
      total: String(progress.total),
    };
    if (progress.cursor) fields.cursor = progress.cursor;
    // feedUris may be a string (JSON) or an array — always store as JSON string
    if (progress.feedUris) {
      fields.feedUris = typeof progress.feedUris === 'string'
        ? progress.feedUris
        : JSON.stringify(progress.feedUris);
    }
    if (progress.postIndex !== undefined) fields.postIndex = String(progress.postIndex);
    await redis.hset(key, fields);
    await redis.expire(key, PARTIAL_TTL);
  } catch {
    // Non-fatal
  }
}

/** Add DIDs to the partial (in-progress) set */
export async function addToPartialSet(
  did: string,
  tier: SpeedTier,
  dataType: FetchDataType,
  members: string[]
): Promise<void> {
  const redis = getRedis();
  if (!redis || members.length === 0) return;
  try {
    const key = partialKey(did, tier, dataType);
    for (let i = 0; i < members.length; i += CHUNK_SIZE) {
      const chunk = members.slice(i, i + CHUNK_SIZE);
      await redis.sadd(key, ...(chunk as [string, ...string[]]));
    }
    await redis.expire(key, PARTIAL_TTL);
  } catch {
    // Non-fatal
  }
}

/** Get the count of members in the partial set */
export async function getPartialCount(
  did: string,
  tier: SpeedTier,
  dataType: FetchDataType
): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    return (await redis.scard(partialKey(did, tier, dataType))) ?? 0;
  } catch {
    return 0;
  }
}

/** Promote partial set to final: RENAME + set 24h TTL + delete progress */
export async function finalizeSet(
  did: string,
  tier: SpeedTier,
  dataType: FetchDataType
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const pKey = partialKey(did, tier, dataType);
    const fKey = finalKey(did, tier, dataType);
    await redis.rename(pKey, fKey);
    await redis.expire(fKey, FINAL_TTL);
    // Also set metadata for compatibility with existing cache system
    if (dataType === 'followers') {
      const count = await redis.scard(fKey);
      const metaKey = `cache:meta:${did}:${tier}`;
      await redis.hset(metaKey, {
        cachedAt: new Date().toISOString(),
        followerCount: count ?? 0,
      });
      await redis.expire(metaKey, FINAL_TTL);
    }
    await redis.del(progressKey(did, tier, dataType));
  } catch {
    // Non-fatal
  }
}

/** Clean up partial data (on error or stale cursor) */
export async function cleanupPartial(
  did: string,
  tier: SpeedTier,
  dataType: FetchDataType
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(partialKey(did, tier, dataType));
    await redis.del(progressKey(did, tier, dataType));
  } catch {
    // Non-fatal
  }
}
