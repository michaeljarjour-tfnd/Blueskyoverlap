import { NextRequest } from 'next/server';
import { fetchFollowerPage, fetchAuthorFeedUris, fetchPostEngagement } from '@/lib/bsky/api';
import {
  isFinalCached,
  getProgress,
  saveProgress,
  addToPartialSet,
  getPartialCount,
  finalizeSet,
  cleanupPartial,
} from '@/lib/redis/chunked-fetch';
import type { FetchChunkRequest, FetchChunkResponse, SpeedTier } from '@/lib/types';

export const maxDuration = 10;

const TIME_BUDGET_MS = 7_000; // Leave 3s margin within 10s timeout
const FOLLOWER_PAGE_DELAY = 100; // ms between follower pages

const SPEED_CAPS: Record<SpeedTier, number> = {
  quick: 2_000,
  balanced: 5_000,
  complete: 1_000_000,
};

function json(data: FetchChunkResponse, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as FetchChunkRequest;
  const { did, tier, dataType, maxPosts = 60, totalFollowers } = body;

  if (!did || !tier || !dataType) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Check if final set already exists in Redis
  const { cached, count } = await isFinalCached(did, tier, dataType);
  if (cached) {
    return json({ status: 'cached', fetched: count, total: count });
  }

  const startTime = Date.now();
  const deadline = startTime + TIME_BUDGET_MS;

  if (dataType === 'followers') {
    return await fetchFollowerChunk(did, tier, startTime, deadline, totalFollowers);
  } else {
    return await fetchEngagementChunk(did, tier, maxPosts, startTime, deadline);
  }
}

// ── Follower chunking ────────────────────────────────────────────────────────

async function fetchFollowerChunk(
  did: string,
  tier: SpeedTier,
  startTime: number,
  deadline: number,
  totalFollowers?: number
): Promise<Response> {
  const cap = SPEED_CAPS[tier];
  const progress = await getProgress(did, tier, 'followers');

  let cursor = progress?.cursor;
  let fetched = progress?.fetched ?? 0;
  const total = totalFollowers ?? progress?.total ?? cap;
  let pagesThisChunk = 0;

  try {
    while (Date.now() < deadline) {
      const page = await fetchFollowerPage(did, cursor, undefined, deadline);

      if (page.dids.length > 0) {
        await addToPartialSet(did, tier, 'followers', page.dids);
        fetched += page.dids.length;
        pagesThisChunk++;
      }

      cursor = page.nextCursor;

      // Done conditions: no more pages, or hit the cap
      if (!cursor || fetched >= cap) {
        await finalizeSet(did, tier, 'followers');
        const finalCount = await getFinalCount(did, tier, 'followers');
        return json({ status: 'complete', fetched: finalCount, total });
      }

      // Small delay between pages to avoid rate limits
      if (Date.now() < deadline - 500) {
        await new Promise((r) => setTimeout(r, FOLLOWER_PAGE_DELAY));
      }
    }
  } catch (err) {
    // If the cursor became invalid (e.g. stale), start over
    if ((err as Error).message?.includes('HTTP 400')) {
      await cleanupPartial(did, tier, 'followers');
      return json({ status: 'in_progress', fetched: 0, total });
    }
    // Time budget exceeded inside a fetch — save progress gracefully
    if ((err as Error).message === 'TIME_BUDGET_EXCEEDED') {
      await saveProgress(did, tier, 'followers', { cursor, fetched, total });
      return json({ status: 'in_progress', fetched, total });
    }
    throw err;
  }

  // Time budget expired — save progress and return
  await saveProgress(did, tier, 'followers', { cursor, fetched, total });
  return json({ status: 'in_progress', fetched, total });
}

// ── Engagement chunking ──────────────────────────────────────────────────────

async function fetchEngagementChunk(
  did: string,
  tier: SpeedTier,
  maxPosts: number,
  startTime: number,
  deadline: number
): Promise<Response> {
  const progress = await getProgress(did, tier, 'engagement');

  let feedUris: string[];
  let postIndex: number;

  if (progress?.feedUris) {
    // Resume from saved state
    feedUris = JSON.parse(progress.feedUris);
    postIndex = progress.postIndex ?? 0;
  } else {
    // First chunk — fetch the feed to get post URIs
    feedUris = await fetchAuthorFeedUris(did, maxPosts, undefined, deadline);
    postIndex = 0;

    if (feedUris.length === 0) {
      // No posts — create an empty final set
      await addToPartialSet(did, tier, 'engagement', ['__empty__']);
      await finalizeSet(did, tier, 'engagement');
      return json({ status: 'complete', fetched: 0, total: 0 });
    }
  }

  const total = feedUris.length;

  try {
    while (postIndex < feedUris.length && Date.now() < deadline) {
      const result = await fetchPostEngagement(feedUris[postIndex], undefined, deadline);

      if (result.dids.length > 0) {
        await addToPartialSet(did, tier, 'engagement', result.dids);
      }

      postIndex++;

      // Delay between posts
      if (postIndex < feedUris.length && Date.now() < deadline - 500) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  } catch (err) {
    if ((err as Error).message?.includes('HTTP 400')) {
      await cleanupPartial(did, tier, 'engagement');
      return json({ status: 'in_progress', fetched: 0, total });
    }
    // Time budget exceeded inside a fetch — save progress gracefully
    if ((err as Error).message === 'TIME_BUDGET_EXCEEDED') {
      await saveProgress(did, tier, 'engagement', {
        fetched: postIndex,
        total,
        feedUris: JSON.stringify(feedUris),
        postIndex,
      });
      return json({ status: 'in_progress', fetched: postIndex, total });
    }
    throw err;
  }

  if (postIndex >= feedUris.length) {
    // All posts processed
    await finalizeSet(did, tier, 'engagement');
    const finalCount = await getFinalCount(did, tier, 'engagement');
    return json({ status: 'complete', fetched: finalCount, total });
  }

  // Time budget expired — save progress
  await saveProgress(did, tier, 'engagement', {
    fetched: postIndex,
    total,
    feedUris: JSON.stringify(feedUris),
    postIndex,
  });

  return json({ status: 'in_progress', fetched: postIndex, total });
}

// ── Helper ───────────────────────────────────────────────────────────────────

async function getFinalCount(
  did: string,
  tier: SpeedTier,
  dataType: 'followers' | 'engagement'
): Promise<number> {
  const { count } = await isFinalCached(did, tier, dataType);
  return count;
}
