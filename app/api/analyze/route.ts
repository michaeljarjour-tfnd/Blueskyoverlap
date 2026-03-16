import { NextRequest } from 'next/server';
import { getProfile, extractHandle } from '@/lib/bsky/api';
import { getOrFetchFollowers, getOrFetchEngagement } from '@/lib/redis/followers';
import { getRedis } from '@/lib/redis/client';
import { calculateCollaborationValue } from '@/lib/analysis/collaboration';
import type {
  AnalyzeRequest,
  BskyProfile,
  PairwiseOverlap,
  SseEvent,
  SpeedTier,
  AnalysisResult,
  EngagementStats,
  AnalysisIntent,
} from '@/lib/types';

// Race a promise against a timeout. On timeout, returns the fallback value.
// Cancels the timer when the promise resolves first to avoid dangling timers.
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;
  const timer = new Promise<T>((resolve) => {
    timerId = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([
    promise.then(
      (v) => { clearTimeout(timerId); return v; },
      (e) => { clearTimeout(timerId); throw e; }
    ),
    timer,
  ]);
}

const EMPTY_ENGAGEMENT = {
  set: new Set<string>(),
  stats: { totalLikes: 0, totalReposts: 0, postsAnalyzed: 0 } as EngagementStats,
  fromCache: false,
};

export const maxDuration = 60; // seconds — upgrade to 300 on Vercel Pro for complete tier

const MAX_OVERLAP_SAMPLE = 500;

const SPEED_CONFIG: Record<SpeedTier, { maxFollowers: number | null; maxPosts: number }> = {
  quick:    { maxFollowers: 5000,  maxPosts: 20 },
  balanced: { maxFollowers: 10000, maxPosts: 35 },
  complete: { maxFollowers: 1_000_000,  maxPosts: 60 },
};

// ── SSE helpers ────────────────────────────────────────────────────────────────

function encode(event: SseEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = (await req.json()) as AnalyzeRequest;
  const { handles: rawHandles, speedTier = 'quick', intent = 'general' } = body;

  // ── Prefetched mode: compute overlaps from already-cached Redis sets ────
  if (body.prefetched && body.profiles && body.dids) {
    return handlePrefetched(body.profiles, body.dids, speedTier, intent);
  }

  const handles = rawHandles.map(extractHandle).filter(Boolean);
  if (handles.length < 2) {
    return new Response(
      JSON.stringify({ error: 'Please provide at least 2 handles' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (handles.length > 10) {
    return new Response(
      JSON.stringify({ error: 'Maximum 10 handles supported' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { maxFollowers, maxPosts } = SPEED_CONFIG[speedTier];
  const abortController = new AbortController();

  // Abort server-side fetch when client disconnects
  req.signal.addEventListener('abort', () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SseEvent) => {
        try {
          controller.enqueue(encode(event));
        } catch {
          // Client disconnected — stop processing
          abortController.abort();
        }
      };

      // Send periodic heartbeat comments to keep the connection warm and force
      // Vercel's edge CDN to flush buffered chunks to the client. This is
      // critical for fast (cached) analyses that complete in < 2s — without
      // the heartbeat, the edge may buffer the entire response and deliver it
      // only after the TCP connection closes (causing the 90s client timeout).
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': ping\n\n'));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 800);

      try {
        // ── 1. Resolve all profiles in parallel ───────────────────────────────
        send({ type: 'progress', message: 'Fetching profiles...', pct: 5 });

        const profiles = await Promise.all(
          handles.map((h) => getProfile(h, abortController.signal))
        );

        send({ type: 'progress', message: 'Profiles loaded. Fetching follower data...', pct: 15 });

        // ── 2. Fetch followers + engagement for all accounts in parallel ───────
        // Progress state shared across parallel fetches
        const followerProgress: Record<string, { fetched: number; max: number }> = {};
        const postProgress: Record<string, { analyzed: number; total: number }> = {};
        const cacheStatus: Record<string, 'hit' | 'miss'> = {};

        const sendProgress = (pct: number, message?: string) => {
          send({
            type: 'progress',
            message: message ?? 'Fetching data...',
            pct,
            followerProgress: { ...followerProgress },
            postProgress: { ...postProgress },
          });
        };

        // Initialise progress state for all profiles so bars appear immediately at 0%
        for (const profile of profiles) {
          const displayMax = maxFollowers ?? (profile.followersCount ?? null);
          followerProgress[profile.did] = { fetched: 0, max: displayMax ?? 1 };
          postProgress[profile.did] = { analyzed: 0, total: maxPosts };
        }
        sendProgress(15);

        // Process accounts sequentially to avoid hammering the Bluesky API.
        // Within each account, followers + engagement still run in parallel
        // (the global concurrency limiter in api.ts caps at 5 in-flight requests).

        const perAccountPct = 70 / profiles.length; // spread 15%–85% across accounts

        const followerSets: Set<string>[] = [];
        const engagementSets: Set<string>[] = [];
        const engagementStats: EngagementStats[] = [];

        const overlapDetailStore: Record<
          string,
          { followerDids: string[]; engagementDids: string[] }
        > = {};

        for (let idx = 0; idx < profiles.length; idx++) {
          const profile = profiles[idx];
          const basePct = 15 + Math.floor(idx * perAccountPct);

          const [followerResult, engagementResult] = await Promise.all([
            getOrFetchFollowers(
              profile.did,
              speedTier,
              (fetched, max) => {
                followerProgress[profile.did] = { fetched, max };
                sendProgress(basePct);
              },
              abortController.signal
            ),
            withTimeout(
              getOrFetchEngagement(
                profile.did,
                speedTier,
                maxPosts,
                (analyzed, total) => {
                  postProgress[profile.did] = { analyzed, total };
                  sendProgress(basePct);
                },
                abortController.signal
              ),
              35_000,
              EMPTY_ENGAGEMENT
            ),
          ]);

          followerSets.push(followerResult.set);
          engagementSets.push(engagementResult.set);
          engagementStats.push(engagementResult.stats);
          cacheStatus[profile.did] = followerResult.fromCache ? 'hit' : 'miss';

          // Mark this account complete at 100%
          const curFolMax = followerProgress[profile.did]?.max ?? 1;
          followerProgress[profile.did] = { fetched: curFolMax, max: curFolMax };
          const curPostTotal = postProgress[profile.did]?.total ?? maxPosts;
          postProgress[profile.did] = { analyzed: curPostTotal, total: curPostTotal };
          sendProgress(basePct + Math.floor(perAccountPct));
        }

        // ── 3. Compute pairwise overlaps ──────────────────────────────────────
        send({ type: 'progress', message: 'Calculating overlaps...', pct: 85 });

        const pairwiseOverlaps: PairwiseOverlap[] = [];

        for (let i = 0; i < profiles.length; i++) {
          for (let j = i + 1; j < profiles.length; j++) {
            // ── Follower overlap (exact on sample) ──
            const folOverlapSet = new Set(
              [...followerSets[i]].filter((x) => followerSets[j].has(x))
            );
            const folUnion = new Set([...followerSets[i], ...followerSets[j]]);
            const sampleFollowers1 = followerSets[i].size;
            const sampleFollowers2 = followerSets[j].size;
            const sampleOverlap = folOverlapSet.size;
            const sampleJaccard = folUnion.size > 0
              ? (folOverlapSet.size / folUnion.size) * 100
              : 0;

            // ── Engagement overlap (always exact) ──
            const engOverlapSet = new Set(
              [...engagementSets[i]].filter((x) => engagementSets[j].has(x))
            );
            const engUnion = new Set([...engagementSets[i], ...engagementSets[j]]);
            const engagementJaccard = engUnion.size > 0
              ? (engOverlapSet.size / engUnion.size) * 100
              : 0;

            // ── Blend for low-coverage samples (minimum overlap estimate) ──
            const realFollowers1 = profiles[i].followersCount ?? sampleFollowers1;
            const realFollowers2 = profiles[j].followersCount ?? sampleFollowers2;
            const coverageA = sampleFollowers1 / Math.max(realFollowers1, 1);
            const coverageB = sampleFollowers2 / Math.max(realFollowers2, 1);
            const coverage = (coverageA + coverageB) / 2;

            let followerOverlap: number;
            let followers1: number;
            let followers2: number;
            let followerJaccard: number;
            let isEstimated = false;

            if (coverage < 0.9) {
              // Coverage-weighted blend of sample Jaccard + engagement Jaccard.
              // Engagement Jaccard is systematically lower than follower Jaccard
              // (lurkers inflate follower overlap), so the blend underestimates —
              // making it a reliable minimum / lower bound.
              const sJ = sampleJaccard / 100;
              const eJ = engagementJaccard / 100;
              const blendedJ = coverage * sJ + (1 - coverage) * eJ;

              followers1 = realFollowers1;
              followers2 = realFollowers2;
              followerOverlap = Math.round(
                blendedJ * (followers1 + followers2) / (1 + blendedJ)
              );
              followerJaccard = blendedJ * 100;
              isEstimated = true;
            } else {
              // High coverage — sample ≈ full set, use exact intersection
              followers1 = sampleFollowers1;
              followers2 = sampleFollowers2;
              followerOverlap = sampleOverlap;
              followerJaccard = sampleJaccard;
            }

            // Follower DID samples
            const followerSample: string[] = [];
            for (const did of folOverlapSet) {
              followerSample.push(did);
              if (followerSample.length >= MAX_OVERLAP_SAMPLE) break;
            }
            const engagementSample: string[] = [];
            for (const did of engOverlapSet) {
              engagementSample.push(did);
              if (engagementSample.length >= MAX_OVERLAP_SAMPLE) break;
            }

            const overlapId = `${profiles[i].did}-${profiles[j].did}`;
            overlapDetailStore[overlapId] = {
              followerDids: followerSample,
              engagementDids: engagementSample,
            };

            const folOverlapPct1 = followers1 > 0 ? (followerOverlap / followers1) * 100 : 0;
            const folOverlapPct2 = followers2 > 0 ? (followerOverlap / followers2) * 100 : 0;

            pairwiseOverlaps.push({
              id: overlapId,
              account1: profiles[i],
              account2: profiles[j],
              followers1,
              followers2,
              followerOverlap,
              followerOverlapPct1: folOverlapPct1,
              followerOverlapPct2: folOverlapPct2,
              followerJaccard,
              uniqueFollowers1: followers1 - followerOverlap,
              uniqueFollowers2: followers2 - followerOverlap,
              engaged1: engagementSets[i].size,
              engaged2: engagementSets[j].size,
              engagementOverlap: engOverlapSet.size,
              engagementOverlapPct1:
                engagementSets[i].size > 0
                  ? (engOverlapSet.size / engagementSets[i].size) * 100
                  : 0,
              engagementOverlapPct2:
                engagementSets[j].size > 0
                  ? (engOverlapSet.size / engagementSets[j].size) * 100
                  : 0,
              engagementJaccard,
              uniqueEngaged1: engagementSets[i].size - engOverlapSet.size,
              uniqueEngaged2: engagementSets[j].size - engOverlapSet.size,
              isEstimated,
              estimationMethod: isEstimated ? 'blend' : 'exact',
              // Legacy aliases
              overlap: engOverlapSet.size,
              overlapPct1:
                engagementSets[i].size > 0
                  ? (engOverlapSet.size / engagementSets[i].size) * 100
                  : 0,
              overlapPct2:
                engagementSets[j].size > 0
                  ? (engOverlapSet.size / engagementSets[j].size) * 100
                  : 0,
              jaccard: engagementJaccard,
              unique1: engagementSets[i].size - engOverlapSet.size,
              unique2: engagementSets[j].size - engOverlapSet.size,
            });
          }
        }

        // ── 4. N-way overlap (all profiles, up to 5) ──
        let threeWayOverlap = null;
        if (profiles.length >= 3) {
            const nProfiles = Math.min(profiles.length, 5);

            // N-way follower intersection: filter through all sets
            let folNArr = [...followerSets[0]];
            for (let k = 1; k < nProfiles; k++) {
              folNArr = folNArr.filter((x) => followerSets[k].has(x));
            }
            const sampleFolNCount = folNArr.length;
            const folUnion = new Set<string>();
            for (let k = 0; k < nProfiles; k++) {
              for (const x of followerSets[k]) folUnion.add(x);
            }
            const folUnionSize = folUnion.size;
            const sampleFolJaccard = folUnionSize > 0 ? (sampleFolNCount / folUnionSize) * 100 : 0;

            // N-way engagement intersection
            let engNArr = [...engagementSets[0]];
            for (let k = 1; k < nProfiles; k++) {
              engNArr = engNArr.filter((x) => engagementSets[k].has(x));
            }
            const engNCount = engNArr.length;
            const engUnion = new Set<string>();
            for (let k = 0; k < nProfiles; k++) {
              for (const x of engagementSets[k]) engUnion.add(x);
            }
            const engUnionSize = engUnion.size;
            const engNJaccard = engUnionSize > 0 ? (engNCount / engUnionSize) * 100 : 0;

            overlapDetailStore['three-way'] = {
              followerDids: folNArr.slice(0, MAX_OVERLAP_SAMPLE),
              engagementDids: engNArr.slice(0, MAX_OVERLAP_SAMPLE),
            };

            // Apply blend for low-coverage N-way
            const realFollowers = profiles.slice(0, nProfiles).map(
              (p, k) => p.followersCount ?? followerSets[k].size
            );
            const coverages = profiles.slice(0, nProfiles).map(
              (_, k) => followerSets[k].size / Math.max(realFollowers[k], 1)
            );
            const avgCoverage = coverages.reduce((s, c) => s + c, 0) / coverages.length;

            let folNCount: number;
            let followerJaccardN: number;
            let followerPcts: number[];

            if (avgCoverage < 0.9) {
              const sJ = sampleFolJaccard / 100;
              const eJ = engNJaccard / 100;
              const blendedJ = avgCoverage * sJ + (1 - avgCoverage) * eJ;
              const totalFollowers = realFollowers.reduce((s, f) => s + f, 0);
              folNCount = blendedJ > 0
                ? Math.round(blendedJ * totalFollowers / (1 + (nProfiles - 1) * blendedJ))
                : 0;
              followerJaccardN = blendedJ * 100;
              followerPcts = realFollowers.map(rf =>
                rf > 0 ? (folNCount / rf) * 100 : 0
              );
            } else {
              folNCount = sampleFolNCount;
              followerJaccardN = sampleFolJaccard;
              followerPcts = profiles.slice(0, nProfiles).map((_, k) =>
                followerSets[k].size > 0 ? (folNCount / followerSets[k].size) * 100 : 0
              );
            }

            const engagementPcts = profiles.slice(0, nProfiles).map((_, k) =>
              engagementSets[k].size > 0 ? (engNCount / engagementSets[k].size) * 100 : 0
            );

            threeWayOverlap = {
              follower: folNCount,
              engagement: engNCount,
              followerJaccard: followerJaccardN,
              engagementJaccard: engNJaccard,
              profiles: profiles.slice(0, nProfiles),
              followerPcts,
              engagementPcts,
            };
        }

        // ── 5. Collaboration values ───────────────────────────────────────────
        const collaborationValues = calculateCollaborationValue(
          profiles,
          engagementSets,
          pairwiseOverlaps,
          true,
          engagementStats,
          intent,
        );

        // ── 6. Send final result ──────────────────────────────────────────────
        send({ type: 'progress', message: 'Done!', pct: 100 });

        const result: AnalysisResult = {
          profiles,
          pairwiseOverlaps,
          threeWayOverlap,
          collaborationValues,
          cacheStatus,
          speedTier,
          intent,
          overlapDetails: overlapDetailStore,
        };

        send({ type: 'result', data: result });
      } catch (err) {
        const message =
          err instanceof DOMException && err.name === 'AbortError'
            ? 'Analysis cancelled'
            : (err as Error).message ?? 'An unexpected error occurred';
        send({ type: 'error', message });
      } finally {
        clearInterval(heartbeatInterval);
        // Give the edge CDN ~200ms to flush the result/error event to the
        // client before we close the stream. Without this delay, closing the
        // stream immediately after enqueuing the result can race with the
        // edge's buffer flush, causing the client to never receive the event.
        await new Promise((r) => setTimeout(r, 200));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ── Prefetched compute-only mode ──────────────────────────────────────────────
// All follower/engagement sets are already in Redis (cached by /api/fetch-chunk).
// This function reads them and computes overlaps — no Bluesky API calls needed.

async function handlePrefetched(
  profiles: BskyProfile[],
  dids: string[],
  speedTier: SpeedTier,
  intent: string
): Promise<Response> {
  const redis = getRedis();
  if (!redis) {
    return new Response(
      JSON.stringify({ error: 'Redis is required for prefetched mode' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const n = profiles.length;
    const uid = Math.random().toString(36).slice(2, 8);

    // ── 1. Get all set sizes in one pipeline (no large data transfer) ────
    const sizePipe = redis.pipeline();
    for (const did of dids) {
      sizePipe.scard(`followers:${did}:${speedTier}`);
      sizePipe.scard(`engagement:${did}:${speedTier}`);
      sizePipe.sismember(`engagement:${did}:${speedTier}`, '__empty__');
    }
    const sizeResults = await sizePipe.exec();

    const folSizes: number[] = [];
    const engSizes: number[] = [];
    for (let i = 0; i < n; i++) {
      folSizes.push((sizeResults[i * 3] as number) ?? 0);
      const rawEngSize = (sizeResults[i * 3 + 1] as number) ?? 0;
      const hasEmpty = (sizeResults[i * 3 + 2] as number) ?? 0;
      engSizes.push(hasEmpty ? Math.max(0, rawEngSize - 1) : rawEngSize);
    }

    const cacheStatus: Record<string, 'hit' | 'miss'> = {};
    for (const did of dids) cacheStatus[did] = 'hit';

    // ── 2. Compute pairwise overlaps using Redis set operations ──────────
    // All intersection computation happens server-side in Redis.
    // Only counts and small samples come back over the wire.
    const overlapDetailStore: Record<string, { followerDids: string[]; engagementDids: string[] }> = {};
    const pairwiseOverlaps: PairwiseOverlap[] = [];
    const pairFolInter: Record<string, number> = {};
    const pairEngInter: Record<string, number> = {};

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const folKey1 = `followers:${dids[i]}:${speedTier}`;
        const folKey2 = `followers:${dids[j]}:${speedTier}`;
        const engKey1 = `engagement:${dids[i]}:${speedTier}`;
        const engKey2 = `engagement:${dids[j]}:${speedTier}`;
        const tmpFol = `tmp:${uid}:fol:${i}:${j}`;
        const tmpEng = `tmp:${uid}:eng:${i}:${j}`;

        // Compute intersections server-side in Redis
        const interPipe = redis.pipeline();
        interPipe.sinterstore(tmpFol, folKey1, folKey2);
        interPipe.sinterstore(tmpEng, engKey1, engKey2);
        await interPipe.exec();

        // Read counts + samples
        const readPipe = redis.pipeline();
        readPipe.scard(tmpFol);
        readPipe.scard(tmpEng);
        readPipe.srandmember(tmpFol, MAX_OVERLAP_SAMPLE);
        readPipe.srandmember(tmpEng, MAX_OVERLAP_SAMPLE);
        const readResults = await readPipe.exec();

        // Clean up temp keys
        await redis.del(tmpFol, tmpEng);

        const folOverlap = (readResults[0] as number) ?? 0;
        const engOverlapRaw = (readResults[1] as number) ?? 0;
        const folSample = (readResults[2] as string[]) ?? [];
        const engSampleRaw = (readResults[3] as string[]) ?? [];
        const hasEmptyInIntersection = engSampleRaw.includes('__empty__');
        const engSample = engSampleRaw.filter(d => d !== '__empty__');
        const engOverlap = hasEmptyInIntersection ? Math.max(0, engOverlapRaw - 1) : engOverlapRaw;

        pairFolInter[`${i}:${j}`] = folOverlap;
        pairEngInter[`${i}:${j}`] = engOverlap;

        const folUnion = folSizes[i] + folSizes[j] - folOverlap;
        const followerJaccard = folUnion > 0 ? (folOverlap / folUnion) * 100 : 0;
        const engUnion = engSizes[i] + engSizes[j] - engOverlap;
        const engagementJaccard = engUnion > 0 ? (engOverlap / engUnion) * 100 : 0;

        const overlapId = `${profiles[i].did}-${profiles[j].did}`;
        overlapDetailStore[overlapId] = { followerDids: folSample, engagementDids: engSample };

        pairwiseOverlaps.push({
          id: overlapId,
          account1: profiles[i],
          account2: profiles[j],
          followers1: folSizes[i],
          followers2: folSizes[j],
          followerOverlap: folOverlap,
          followerOverlapPct1: folSizes[i] > 0 ? (folOverlap / folSizes[i]) * 100 : 0,
          followerOverlapPct2: folSizes[j] > 0 ? (folOverlap / folSizes[j]) * 100 : 0,
          followerJaccard,
          uniqueFollowers1: folSizes[i] - folOverlap,
          uniqueFollowers2: folSizes[j] - folOverlap,
          engaged1: engSizes[i],
          engaged2: engSizes[j],
          engagementOverlap: engOverlap,
          engagementOverlapPct1: engSizes[i] > 0 ? (engOverlap / engSizes[i]) * 100 : 0,
          engagementOverlapPct2: engSizes[j] > 0 ? (engOverlap / engSizes[j]) * 100 : 0,
          engagementJaccard,
          uniqueEngaged1: engSizes[i] - engOverlap,
          uniqueEngaged2: engSizes[j] - engOverlap,
          overlap: engOverlap,
          overlapPct1: engSizes[i] > 0 ? (engOverlap / engSizes[i]) * 100 : 0,
          overlapPct2: engSizes[j] > 0 ? (engOverlap / engSizes[j]) * 100 : 0,
          jaccard: engagementJaccard,
          unique1: engSizes[i] - engOverlap,
          unique2: engSizes[j] - engOverlap,
        });
      }
    }

    // ── 3. N-way overlap (all profiles, up to 5) ────────────────────────
    let threeWayOverlap = null;
    const nProfiles = Math.min(n, 5);
    if (nProfiles >= 3) {
      const folKeys = dids.slice(0, nProfiles).map(d => `followers:${d}:${speedTier}`);
      const engKeys = dids.slice(0, nProfiles).map(d => `engagement:${d}:${speedTier}`);
      const tmpFolN = `tmp:${uid}:folN`;
      const tmpEngN = `tmp:${uid}:engN`;

      const nPipe = redis.pipeline();
      nPipe.sinterstore(tmpFolN, ...folKeys as [string, ...string[]]);
      nPipe.sinterstore(tmpEngN, ...engKeys as [string, ...string[]]);
      await nPipe.exec();

      const readNPipe = redis.pipeline();
      readNPipe.scard(tmpFolN);
      readNPipe.scard(tmpEngN);
      readNPipe.srandmember(tmpFolN, MAX_OVERLAP_SAMPLE);
      readNPipe.srandmember(tmpEngN, MAX_OVERLAP_SAMPLE);
      const readNResults = await readNPipe.exec();

      await redis.del(tmpFolN, tmpEngN);

      const folNCount = (readNResults[0] as number) ?? 0;
      const engNCountRaw = (readNResults[1] as number) ?? 0;
      const folNSample = (readNResults[2] as string[]) ?? [];
      const engNSampleRaw = (readNResults[3] as string[]) ?? [];
      const engNSample = engNSampleRaw.filter(d => d !== '__empty__');
      const engNCount = engNSampleRaw.includes('__empty__')
        ? Math.max(0, engNCountRaw - 1)
        : engNCountRaw;

      overlapDetailStore['three-way'] = {
        followerDids: folNSample,
        engagementDids: engNSample,
      };

      // Union sizes via inclusion-exclusion (approximate for N>3: sum singles - sum pairs + N-way)
      let folUnionSize = 0;
      let engUnionSize = 0;
      for (let k = 0; k < nProfiles; k++) {
        folUnionSize += folSizes[k];
        engUnionSize += engSizes[k];
      }
      for (let i = 0; i < nProfiles; i++) {
        for (let j = i + 1; j < nProfiles; j++) {
          folUnionSize -= (pairFolInter[`${i}:${j}`] ?? 0);
          engUnionSize -= (pairEngInter[`${i}:${j}`] ?? 0);
        }
      }
      // For N>3 this is an approximation (missing higher-order corrections),
      // but the N-way intersection from SINTERSTORE is exact
      folUnionSize = Math.max(folUnionSize, folNCount);
      engUnionSize = Math.max(engUnionSize, engNCount);

      threeWayOverlap = {
        follower: folNCount,
        engagement: engNCount,
        followerJaccard: folUnionSize > 0 ? (folNCount / folUnionSize) * 100 : 0,
        engagementJaccard: engUnionSize > 0 ? (engNCount / engUnionSize) * 100 : 0,
        profiles: profiles.slice(0, nProfiles),
        followerPcts: profiles.slice(0, nProfiles).map((_, k) =>
          folSizes[k] > 0 ? (folNCount / folSizes[k]) * 100 : 0
        ),
        engagementPcts: profiles.slice(0, nProfiles).map((_, k) =>
          engSizes[k] > 0 ? (engNCount / engSizes[k]) * 100 : 0
        ),
      };
    }

    // ── 4. Collaboration values ──────────────────────────────────────────
    const engagementStats: EngagementStats[] = dids.map(() => ({
      totalLikes: 0, totalReposts: 0, postsAnalyzed: 0,
    }));
    const collaborationValues = calculateCollaborationValue(
      profiles, null, pairwiseOverlaps, true, engagementStats, intent as AnalysisIntent,
      engSizes
    );

    const result: AnalysisResult = {
      profiles,
      pairwiseOverlaps,
      threeWayOverlap,
      collaborationValues,
      cacheStatus,
      speedTier,
      intent: intent as AnalysisResult['intent'],
      overlapDetails: overlapDetailStore,
    };

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'Compute failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
