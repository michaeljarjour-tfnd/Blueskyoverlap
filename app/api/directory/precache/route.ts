import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis/client';
import { fetchFollowerPage } from '@/lib/bsky/api';
import { isCached } from '@/lib/redis/followers';

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000; // 50s budget within 60s timeout
const SAMPLE_SIZE = 10_000; // Random sample stored for fast ranking
const CHUNK_SIZE = 2_000;

/** Fisher-Yates shuffle, then take first n elements. */
function randomSample(arr: string[], n: number): string[] {
  if (arr.length <= n) return arr;
  // Partial Fisher-Yates — only shuffle the first n positions
  const result = [...arr];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (result.length - i));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(0, n);
}

/**
 * POST /api/directory/precache — Admin: pre-cache followers for directory journalists
 *
 * For each uncached journalist:
 *   1. Fetches ALL followers (no cap)
 *   2. Stores a random 5K sample in Redis (unbiased for overlap ranking)
 *   3. Stores full count in metadata
 *
 * Processes as many journalists as time allows per call.
 * Call repeatedly to work through the full directory.
 *
 * Returns: { processed, cached, skipped, remaining }
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: 'Redis not configured' }, { status: 500 });
  }

  const deadline = Date.now() + TIME_BUDGET_MS;

  // Get all journalist DIDs from the directory
  const allDids = await redis.zrange('dir:journalists', 0, -1) as string[];
  if (allDids.length === 0) {
    return NextResponse.json({ error: 'Directory is empty — seed it first' }, { status: 404 });
  }

  let processed = 0;
  let cached = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const did of allDids) {
    if (Date.now() >= deadline) break;

    // Check if already cached
    const alreadyCached = await isCached(did, 'quick');
    if (alreadyCached) {
      skipped++;
      continue;
    }

    // Fetch ALL followers (no cap — we sample afterward for accuracy)
    try {
      const allFollowers: string[] = [];
      let cursor: string | undefined;

      while (Date.now() < deadline) {
        const page = await fetchFollowerPage(did, cursor, undefined, deadline);
        allFollowers.push(...page.dids);
        cursor = page.nextCursor;
        if (!cursor) break;
      }

      if (allFollowers.length > 0) {
        // Take a random sample for Redis storage (unbiased for overlap ranking)
        const sample = randomSample(allFollowers, SAMPLE_SIZE);

        // Store sample permanently (no TTL)
        const key = `followers:${did}:quick`;
        for (let i = 0; i < sample.length; i += CHUNK_SIZE) {
          const chunk = sample.slice(i, i + CHUNK_SIZE);
          await redis.sadd(key, ...(chunk as [string, ...string[]]));
        }
        await redis.persist(key);

        // Metadata — store FULL count so we can extrapolate from sample
        const metaKey = `cache:meta:${did}:quick`;
        await redis.hset(metaKey, {
          cachedAt: new Date().toISOString(),
          followerCount: allFollowers.length,
          sampleSize: sample.length,
          source: 'directory-precache',
        });
        await redis.persist(metaKey);

        cached++;
      }

      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'TIME_BUDGET_EXCEEDED') break;
      errors.push(`${did}: ${msg}`);
      processed++;
    }
  }

  const remaining = allDids.length - skipped - cached - errors.length;

  return NextResponse.json({
    processed,
    cached,
    skipped,
    remaining: Math.max(0, remaining),
    errors: errors.length > 0 ? errors : undefined,
    total: allDids.length,
  });
}
