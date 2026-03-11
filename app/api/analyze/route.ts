import { NextRequest } from 'next/server';
import { getProfile, extractHandle } from '@/lib/bsky/api';
import { getOrFetchFollowers, getOrFetchEngagement, getOrFetchMinHash } from '@/lib/redis/followers';
import type { MinHashResult } from '@/lib/redis/followers';
import { getRedis } from '@/lib/redis/client';
import { calculateCollaborationValue } from '@/lib/analysis/collaboration';
import { MinHashSignature, projectOverlap } from '@/lib/analysis/minhash';
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

        const useMinHash = speedTier === 'quick' || speedTier === 'balanced';

        // Process accounts sequentially to avoid hammering the Bluesky API.
        // Within each account, followers + engagement still run in parallel
        // (the global concurrency limiter in api.ts caps at 5 in-flight requests).

        const perAccountPct = 70 / profiles.length; // spread 15%–85% across accounts

        // MinHash path: signatures instead of full sets
        const minhashResults: MinHashResult[] = [];
        // Exact path: full sets
        const followerSets: Set<string>[] = [];

        // Engagement is always exact (small sets)
        const engagementSets: Set<string>[] = [];
        const engagementStats: EngagementStats[] = [];

        const overlapDetailStore: Record<
          string,
          { followerDids: string[]; engagementDids: string[] }
        > = {};

        for (let idx = 0; idx < profiles.length; idx++) {
          const profile = profiles[idx];
          const basePct = 15 + Math.floor(idx * perAccountPct);

          if (useMinHash) {
            // MinHash path — stream followers through signature
            const [mhResult, engagementResult] = await Promise.all([
              getOrFetchMinHash(
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

            minhashResults.push(mhResult);
            engagementSets.push(engagementResult.set);
            engagementStats.push(engagementResult.stats);
            cacheStatus[profile.did] = mhResult.fromCache ? 'hit' : 'miss';
          } else {
            // Exact path — full follower sets (Complete tier uses chunked fetch, not this)
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
          }

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
            // ── Follower overlap ──
            let followerOverlap: number;
            let followers1: number;
            let followers2: number;
            let followerJaccard: number;
            let isEstimated = false;

            if (useMinHash) {
              // MinHash: estimate Jaccard, project overlap using real follower counts
              const sigA = MinHashSignature.fromArray(minhashResults[i].signature);
              const sigB = MinHashSignature.fromArray(minhashResults[j].signature);
              const jaccardRaw = sigA.jaccard(sigB); // 0–1

              // Use real follower counts from profile API
              followers1 = profiles[i].followersCount ?? minhashResults[i].count;
              followers2 = profiles[j].followersCount ?? minhashResults[j].count;
              followerOverlap = projectOverlap(jaccardRaw, followers1, followers2);
              followerJaccard = jaccardRaw * 100; // convert to 0–100
              isEstimated = true;
            } else {
              // Exact: set intersection
              const folOverlapSet = new Set(
                [...followerSets[i]].filter((x) => followerSets[j].has(x))
              );
              const folUnion = new Set([...followerSets[i], ...followerSets[j]]);
              followers1 = followerSets[i].size;
              followers2 = followerSets[j].size;
              followerOverlap = folOverlapSet.size;
              followerJaccard = folUnion.size > 0
                ? (folOverlapSet.size / folUnion.size) * 100
                : 0;
            }

            // ── Engagement overlap (always exact) ──
            const engOverlapSet = new Set(
              [...engagementSets[i]].filter((x) => engagementSets[j].has(x))
            );
            const engUnion = new Set([...engagementSets[i], ...engagementSets[j]]);
            const engagementJaccard = engUnion.size > 0
              ? (engOverlapSet.size / engUnion.size) * 100
              : 0;

            // Follower DID samples — only available for exact path
            const followerSample: string[] = [];
            if (!useMinHash) {
              const folOverlapSet = new Set(
                [...followerSets[i]].filter((x) => followerSets[j].has(x))
              );
              for (const did of folOverlapSet) {
                followerSample.push(did);
                if (followerSample.length >= MAX_OVERLAP_SAMPLE) break;
              }
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
              estimationMethod: isEstimated ? 'minhash' : 'exact',
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

        // ── 4. Three-way overlap (first 3 profiles; cap at 3 for hero display) ──
        let threeWayOverlap = null;
        if (profiles.length >= 3) {
          if (useMinHash) {
            // MinHash three-way: estimate from pairwise Jaccards
            // For three-way, we can't directly compute from MinHash signatures,
            // so we use the minimum pairwise Jaccard as a conservative estimate.
            const sig0 = MinHashSignature.fromArray(minhashResults[0].signature);
            const sig1 = MinHashSignature.fromArray(minhashResults[1].signature);
            const sig2 = MinHashSignature.fromArray(minhashResults[2].signature);

            const j01 = sig0.jaccard(sig1);
            const j02 = sig0.jaccard(sig2);
            const j12 = sig1.jaccard(sig2);
            // Conservative: three-way Jaccard <= min of pairwise Jaccards
            const threeWayJaccard = Math.min(j01, j02, j12);

            const f0 = profiles[0].followersCount ?? minhashResults[0].count;
            const f1 = profiles[1].followersCount ?? minhashResults[1].count;
            const f2 = profiles[2].followersCount ?? minhashResults[2].count;
            const totalFollowers = f0 + f1 + f2;
            // Rough projection: threeWayOverlap ≈ threeWayJaccard * totalFollowers / (1 + 2*threeWayJaccard)
            const folThreeCount = threeWayJaccard > 0
              ? Math.round(threeWayJaccard * totalFollowers / (1 + 2 * threeWayJaccard))
              : 0;

            // Engagement three-way is exact
            const es0 = engagementSets[0], es1 = engagementSets[1], es2 = engagementSets[2];
            const engThreeArr = [...es0].filter((x) => es1.has(x) && es2.has(x));

            overlapDetailStore['three-way'] = {
              followerDids: [], // No samples for MinHash
              engagementDids: engThreeArr.slice(0, MAX_OVERLAP_SAMPLE),
            };

            const engUnionSize = new Set([...es0, ...es1, ...es2]).size;

            threeWayOverlap = {
              follower: folThreeCount,
              engagement: engThreeArr.length,
              followerJaccard: threeWayJaccard * 100,
              engagementJaccard: engUnionSize > 0 ? (engThreeArr.length / engUnionSize) * 100 : 0,
              profiles: [profiles[0], profiles[1], profiles[2]],
              followerPcts: [
                f0 > 0 ? (folThreeCount / f0) * 100 : 0,
                f1 > 0 ? (folThreeCount / f1) * 100 : 0,
                f2 > 0 ? (folThreeCount / f2) * 100 : 0,
              ],
              engagementPcts: [
                es0.size > 0 ? (engThreeArr.length / es0.size) * 100 : 0,
                es1.size > 0 ? (engThreeArr.length / es1.size) * 100 : 0,
                es2.size > 0 ? (engThreeArr.length / es2.size) * 100 : 0,
              ],
            };
          } else {
            const fs0 = followerSets[0], fs1 = followerSets[1], fs2 = followerSets[2];
            const es0 = engagementSets[0], es1 = engagementSets[1], es2 = engagementSets[2];

            const folThreeArr = [...fs0].filter((x) => fs1.has(x) && fs2.has(x));
            const folThreeCount = folThreeArr.length;
            const folUnionSize = new Set([...fs0, ...fs1, ...fs2]).size;
            const followerJaccard = folUnionSize > 0 ? (folThreeCount / folUnionSize) * 100 : 0;

            const engThreeArr = [...es0].filter((x) => es1.has(x) && es2.has(x));
            const engThreeCount = engThreeArr.length;
            const engUnionSize = new Set([...es0, ...es1, ...es2]).size;
            const engagementJaccard = engUnionSize > 0 ? (engThreeCount / engUnionSize) * 100 : 0;

            overlapDetailStore['three-way'] = {
              followerDids: folThreeArr.slice(0, MAX_OVERLAP_SAMPLE),
              engagementDids: engThreeArr.slice(0, MAX_OVERLAP_SAMPLE),
            };

            const followerPcts = [
              fs0.size > 0 ? (folThreeCount / fs0.size) * 100 : 0,
              fs1.size > 0 ? (folThreeCount / fs1.size) * 100 : 0,
              fs2.size > 0 ? (folThreeCount / fs2.size) * 100 : 0,
            ];
            const engagementPcts = [
              es0.size > 0 ? (engThreeCount / es0.size) * 100 : 0,
              es1.size > 0 ? (engThreeCount / es1.size) * 100 : 0,
              es2.size > 0 ? (engThreeCount / es2.size) * 100 : 0,
            ];

            threeWayOverlap = {
              follower: folThreeCount,
              engagement: engThreeCount,
              followerJaccard,
              engagementJaccard,
              profiles: [profiles[0], profiles[1], profiles[2]],
              followerPcts,
              engagementPcts,
            };
          }
        }

        // ── 5. Collaboration values ───────────────────────────────────────────
        const collaborationValues = calculateCollaborationValue(
          profiles,
          useMinHash ? null : engagementSets,
          pairwiseOverlaps,
          true,
          engagementStats,
          intent,
          useMinHash ? engagementSets.map((s) => s.size) : undefined
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

    // ── 3. Three-way overlap ─────────────────────────────────────────────
    let threeWayOverlap = null;
    if (n >= 3) {
      const folKeys = dids.slice(0, 3).map(d => `followers:${d}:${speedTier}`);
      const engKeys = dids.slice(0, 3).map(d => `engagement:${d}:${speedTier}`);
      const tmpFol3 = `tmp:${uid}:fol3`;
      const tmpEng3 = `tmp:${uid}:eng3`;

      const threePipe = redis.pipeline();
      threePipe.sinterstore(tmpFol3, ...folKeys as [string, ...string[]]);
      threePipe.sinterstore(tmpEng3, ...engKeys as [string, ...string[]]);
      await threePipe.exec();

      const read3Pipe = redis.pipeline();
      read3Pipe.scard(tmpFol3);
      read3Pipe.scard(tmpEng3);
      read3Pipe.srandmember(tmpFol3, MAX_OVERLAP_SAMPLE);
      read3Pipe.srandmember(tmpEng3, MAX_OVERLAP_SAMPLE);
      const read3Results = await read3Pipe.exec();

      await redis.del(tmpFol3, tmpEng3);

      const folThreeCount = (read3Results[0] as number) ?? 0;
      const engThreeCountRaw = (read3Results[1] as number) ?? 0;
      const folThreeSample = (read3Results[2] as string[]) ?? [];
      const engThreeSampleRaw = (read3Results[3] as string[]) ?? [];
      const engThreeSample = engThreeSampleRaw.filter(d => d !== '__empty__');
      const engThreeCount = engThreeSampleRaw.includes('__empty__')
        ? Math.max(0, engThreeCountRaw - 1)
        : engThreeCountRaw;

      overlapDetailStore['three-way'] = {
        followerDids: folThreeSample,
        engagementDids: engThreeSample,
      };

      // Union sizes via inclusion-exclusion:
      // |A ∪ B ∪ C| = |A| + |B| + |C| - |A∩B| - |A∩C| - |B∩C| + |A∩B∩C|
      const folUnionSize = folSizes[0] + folSizes[1] + folSizes[2]
        - (pairFolInter['0:1'] ?? 0)
        - (pairFolInter['0:2'] ?? 0)
        - (pairFolInter['1:2'] ?? 0)
        + folThreeCount;
      const engUnionSize = engSizes[0] + engSizes[1] + engSizes[2]
        - (pairEngInter['0:1'] ?? 0)
        - (pairEngInter['0:2'] ?? 0)
        - (pairEngInter['1:2'] ?? 0)
        + engThreeCount;

      threeWayOverlap = {
        follower: folThreeCount,
        engagement: engThreeCount,
        followerJaccard: folUnionSize > 0 ? (folThreeCount / folUnionSize) * 100 : 0,
        engagementJaccard: engUnionSize > 0 ? (engThreeCount / engUnionSize) * 100 : 0,
        profiles: [profiles[0], profiles[1], profiles[2]],
        followerPcts: [
          folSizes[0] > 0 ? (folThreeCount / folSizes[0]) * 100 : 0,
          folSizes[1] > 0 ? (folThreeCount / folSizes[1]) * 100 : 0,
          folSizes[2] > 0 ? (folThreeCount / folSizes[2]) * 100 : 0,
        ],
        engagementPcts: [
          engSizes[0] > 0 ? (engThreeCount / engSizes[0]) * 100 : 0,
          engSizes[1] > 0 ? (engThreeCount / engSizes[1]) * 100 : 0,
          engSizes[2] > 0 ? (engThreeCount / engSizes[2]) * 100 : 0,
        ],
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
