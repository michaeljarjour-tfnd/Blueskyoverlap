import type { BskyProfile, EngagementStats } from '@/lib/types';

const BASE_URL = 'https://public.api.bsky.app/xrpc';
const MAX_RETRIES = 5;

// ── Core fetch with 429/Retry-After handling (no artificial delays) ────────────

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchWithRetry(url: string, signal?: AbortSignal): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');

    try {
      const res = await fetch(url, { signal });

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        // Respect server's Retry-After, fall back to exponential backoff
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * 2 ** attempt, 30_000);
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      lastError = err as Error;
      if (attempt < MAX_RETRIES) {
        await sleep(1500 * (attempt + 1));
      }
    }
  }

  throw lastError ?? new Error('Max retries exceeded');
}

// ── Profile ────────────────────────────────────────────────────────────────────

export async function getProfile(actor: string, signal?: AbortSignal): Promise<BskyProfile> {
  const url = `${BASE_URL}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
  const data = await fetchWithRetry(url, signal) as BskyProfile;
  return data;
}

// ── Batch profile lookup (25 DIDs per request) ─────────────────────────────────

export async function fetchProfilesForDids(
  dids: string[],
  signal?: AbortSignal
): Promise<BskyProfile[]> {
  const unique = Array.from(new Set(dids));
  const results: BskyProfile[] = [];
  const BATCH = 25;

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const query = batch.map((d) => `actors=${encodeURIComponent(d)}`).join('&');
    try {
      const data = (await fetchWithRetry(
        `${BASE_URL}/app.bsky.actor.getProfiles?${query}`,
        signal
      )) as { profiles: BskyProfile[] };
      results.push(...(data.profiles ?? []));
    } catch {
      // Return stubs for failed batches rather than crashing
      batch.forEach((did) => results.push({ did, handle: did }));
    }
  }

  // Preserve input order, fill stubs for any missing DIDs
  const byDid = new Map(results.map((p) => [p.did, p]));
  return unique.map((did) => byDid.get(did) ?? { did, handle: did });
}

// ── Followers ─────────────────────────────────────────────────────────────────

export async function fetchFollowers(
  actor: string,
  maxFollowers: number | null,
  onProgress?: (fetched: number, max: number) => void,
  signal?: AbortSignal
): Promise<Set<string>> {
  const followers = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');

    let url = `${BASE_URL}/app.bsky.graph.getFollowers?actor=${encodeURIComponent(actor)}&limit=100`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const data = (await fetchWithRetry(url, signal)) as {
      followers: Array<{ did: string }>;
      cursor?: string;
    };

    data.followers?.forEach((f) => followers.add(f.did));

    const cap = maxFollowers ?? followers.size;
    onProgress?.(followers.size, cap);

    if (maxFollowers && followers.size >= maxFollowers) break;

    cursor = data.cursor;
    if (!cursor) break;
    // No sleep — rate limits handled by fetchWithRetry's 429 logic
  }

  return followers;
}

// ── Engagement ────────────────────────────────────────────────────────────────

async function getAuthorFeed(
  actor: string,
  limit: number,
  signal?: AbortSignal
): Promise<Array<{ post: { uri: string } }>> {
  const data = (await fetchWithRetry(
    `${BASE_URL}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${Math.min(limit, 100)}`,
    signal
  )) as { feed: Array<{ post: { uri: string } }> };
  return data.feed ?? [];
}

async function getPostLikes(postUri: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const data = (await fetchWithRetry(
      `${BASE_URL}/app.bsky.feed.getLikes?uri=${encodeURIComponent(postUri)}&limit=100`,
      signal
    )) as { likes: Array<{ actor: { did: string } }> };
    return (data.likes ?? []).map((l) => l.actor.did);
  } catch {
    return [];
  }
}

async function getPostReposts(postUri: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const data = (await fetchWithRetry(
      `${BASE_URL}/app.bsky.feed.getRepostedBy?uri=${encodeURIComponent(postUri)}&limit=100`,
      signal
    )) as { repostedBy: Array<{ did: string }> };
    return (data.repostedBy ?? []).map((u) => u.did);
  } catch {
    return [];
  }
}

export async function getEngagedUsers(
  actor: string,
  maxPosts: number,
  onProgress?: (analyzed: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ engagers: Set<string>; stats: EngagementStats }> {
  const engagers = new Map<string, number>();
  let totalLikes = 0;
  let totalReposts = 0;

  const feed = await getAuthorFeed(actor, maxPosts, signal);

  for (let i = 0; i < feed.length; i++) {
    if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');

    const postUri = feed[i].post.uri;

    // Fetch likes and reposts in parallel per post
    const [likers, reposters] = await Promise.all([
      getPostLikes(postUri, signal),
      getPostReposts(postUri, signal),
    ]);

    totalLikes += likers.length;
    likers.forEach((did) => engagers.set(did, (engagers.get(did) ?? 0) + 1));

    totalReposts += reposters.length;
    reposters.forEach((did) => engagers.set(did, (engagers.get(did) ?? 0) + 2)); // 2x weight

    // Report after fetch (accurate), then small delay to avoid 429 rate limits.
    onProgress?.(i + 1, feed.length);
    if (i < feed.length - 1) await sleep(50);
  }

  return {
    engagers: new Set(engagers.keys()),
    stats: {
      totalLikes,
      totalReposts,
      postsAnalyzed: feed.length,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Accepts @handle, bsky.app/profile/handle, or bare handle */
export function extractHandle(input: string): string {
  const trimmed = input.trim().replace(/^@/, '');
  // bsky.app/profile/handle or bsky.app/profile/did:plc:...
  const profileMatch = trimmed.match(/bsky\.app\/profile\/([^/?#]+)/);
  if (profileMatch) return profileMatch[1];
  return trimmed;
}
