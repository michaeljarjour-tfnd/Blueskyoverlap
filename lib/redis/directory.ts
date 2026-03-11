/**
 * Redis-backed journalist directory.
 *
 * Key schema (no TTL — long-lived curated data):
 *   dir:journalists          Sorted Set  (score = addedAt timestamp)
 *   dir:journalist:{did}     Hash         metadata per journalist
 *   dir:topic:{topic}        Set          DIDs covering this topic
 *   dir:geo:{geography}      Set          DIDs in this geography
 *   dir:version              String       last-updated ISO timestamp
 */

import { getRedis } from './client';
import type { JournalistEntry } from '@/lib/types';

// ── Seed / Add ───────────────────────────────────────────────────────────────

/** Bulk-load journalists into the directory. Idempotent — re-seeding updates. */
export async function seedDirectory(entries: JournalistEntry[]): Promise<number> {
  const redis = getRedis();
  if (!redis) throw new Error('Redis not configured');

  const pipeline = redis.pipeline();
  let count = 0;

  for (const entry of entries) {
    const ts = new Date(entry.addedAt).getTime();

    // Master sorted set
    pipeline.zadd('dir:journalists', { score: ts, member: entry.did });

    // Per-journalist hash
    pipeline.hset(`dir:journalist:${entry.did}`, {
      handle: entry.handle,
      displayName: entry.displayName,
      topics: JSON.stringify(entry.topics),
      geography: entry.geography ?? '',
      outlet: entry.outlet ?? '',
      matchConfidence: entry.matchConfidence,
      verified: entry.verified ? '1' : '0',
      addedAt: entry.addedAt,
    });

    // Topic indexes
    for (const topic of entry.topics) {
      pipeline.sadd(`dir:topic:${topic}`, entry.did);
    }

    // Geography index
    if (entry.geography) {
      pipeline.sadd(`dir:geo:${entry.geography}`, entry.did);
    }

    count++;
  }

  // Version stamp
  pipeline.set('dir:version', new Date().toISOString());

  await pipeline.exec();
  return count;
}

/** Add a single journalist to the directory. */
export async function addJournalist(entry: JournalistEntry): Promise<void> {
  await seedDirectory([entry]);
}

/** Remove a journalist from the directory. */
export async function removeJournalist(did: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  // Read current metadata to clean up indexes
  const meta = await redis.hgetall(`dir:journalist:${did}`);
  if (!meta) return;

  const pipeline = redis.pipeline();

  pipeline.zrem('dir:journalists', did);
  pipeline.del(`dir:journalist:${did}`);

  // Remove from topic indexes
  const topics = parseTopics(meta.topics);
  for (const topic of topics) {
    pipeline.srem(`dir:topic:${topic}`, did);
  }

  // Remove from geography index
  if (meta.geography) {
    pipeline.srem(`dir:geo:${meta.geography}`, did);
  }

  await pipeline.exec();
}

// ── Query ────────────────────────────────────────────────────────────────────

export interface DirectoryQuery {
  topic?: string;
  geography?: string;
  limit?: number;
  offset?: number;
}

export interface DirectoryPage {
  entries: JournalistEntry[];
  total: number;
}

/** Get paginated directory entries with optional topic/geography filter. */
export async function getDirectoryEntries(
  query: DirectoryQuery = {}
): Promise<DirectoryPage> {
  const redis = getRedis();
  if (!redis) return { entries: [], total: 0 };

  const { topic, geography, limit = 50, offset = 0 } = query;

  let dids: string[];
  let total: number;

  if (topic && geography) {
    // Intersection of topic and geography sets
    const topicDids = await redis.smembers(`dir:topic:${topic}`);
    const geoDids = new Set(await redis.smembers(`dir:geo:${geography}`));
    const intersection = topicDids.filter(d => geoDids.has(d));
    total = intersection.length;
    dids = intersection.slice(offset, offset + limit);
  } else if (topic) {
    const all = await redis.smembers(`dir:topic:${topic}`);
    total = all.length;
    dids = all.slice(offset, offset + limit);
  } else if (geography) {
    const all = await redis.smembers(`dir:geo:${geography}`);
    total = all.length;
    dids = all.slice(offset, offset + limit);
  } else {
    // All journalists, paginated from sorted set
    total = await redis.zcard('dir:journalists');
    dids = await redis.zrange('dir:journalists', offset, offset + limit - 1, { rev: true });
  }

  if (dids.length === 0) return { entries: [], total };

  // Fetch metadata for each DID
  const entries = await Promise.all(dids.map(did => getJournalistByDid(did)));
  return {
    entries: entries.filter((e): e is JournalistEntry => e !== null),
    total,
  };
}

/** Look up a single journalist by DID. */
export async function getJournalistByDid(did: string): Promise<JournalistEntry | null> {
  const redis = getRedis();
  if (!redis) return null;

  const meta = await redis.hgetall(`dir:journalist:${did}`) as Record<string, unknown> | null;
  if (!meta || !meta.handle) return null;

  return {
    did,
    handle: String(meta.handle),
    displayName: String(meta.displayName || ''),
    topics: parseTopics(meta.topics),
    geography: meta.geography ? String(meta.geography) : undefined,
    outlet: meta.outlet ? String(meta.outlet) : undefined,
    matchConfidence: Number(meta.matchConfidence) || 0,
    verified: meta.verified === '1' || meta.verified === 1 || meta.verified === true,
    addedAt: String(meta.addedAt || ''),
  };
}

// ── Stats ────────────────────────────────────────────────────────────────────

export interface DirectoryStats {
  totalJournalists: number;
  topics: string[];
  geographies: string[];
  lastUpdated: string | null;
}

export async function getDirectoryStats(): Promise<DirectoryStats> {
  const redis = getRedis();
  if (!redis) return { totalJournalists: 0, topics: [], geographies: [], lastUpdated: null };

  const [totalJournalists, version, topicKeys, geoKeys] = await Promise.all([
    redis.zcard('dir:journalists'),
    redis.get('dir:version') as Promise<string | null>,
    scanKeys(redis, 'dir:topic:*'),
    scanKeys(redis, 'dir:geo:*'),
  ]);

  return {
    totalJournalists,
    topics: topicKeys.map(k => k.replace('dir:topic:', '')).sort(),
    geographies: geoKeys.map(k => k.replace('dir:geo:', '')).sort(),
    lastUpdated: version,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTopics(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

/** SCAN for keys matching a pattern. Upstash REST doesn't support SCAN natively,
 *  so we use KEYS (fine for small key spaces like our directory indexes). */
async function scanKeys(redis: NonNullable<ReturnType<typeof getRedis>>, pattern: string): Promise<string[]> {
  try {
    return await redis.keys(pattern);
  } catch {
    return [];
  }
}
