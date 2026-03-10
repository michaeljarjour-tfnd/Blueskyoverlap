import { NextRequest } from 'next/server';
import { getProfile, extractHandle } from '@/lib/bsky/api';
import { getOrFetchFollowers, getOrFetchEngagement } from '@/lib/redis/followers';
import { calculateCollaborationValue } from '@/lib/analysis/collaboration';
import type {
  AnalyzeRequest,
  BskyProfile,
  PairwiseOverlap,
  SseEvent,
  SpeedTier,
  AnalysisResult,
} from '@/lib/types';

export const maxDuration = 60; // seconds — upgrade to 300 on Vercel Pro for complete tier

const MAX_OVERLAP_SAMPLE = 500;

const SPEED_CONFIG: Record<SpeedTier, { maxFollowers: number | null; maxPosts: number }> = {
  quick:    { maxFollowers: 2000,  maxPosts: 20 },
  balanced: { maxFollowers: 5000,  maxPosts: 35 },
  complete: { maxFollowers: null,  maxPosts: 60 },
};

// ── SSE helpers ────────────────────────────────────────────────────────────────

function encode(event: SseEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = (await req.json()) as AnalyzeRequest;
  const { handles: rawHandles, speedTier = 'quick', intent = 'general' } = body;

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

        const accountData = await Promise.all(
          profiles.map(async (profile: BskyProfile, idx: number) => {
            const [followerResult, engagementResult] = await Promise.all([
              getOrFetchFollowers(
                profile.did,
                speedTier,
                (fetched, max) => {
                  followerProgress[profile.did] = { fetched, max };
                  sendProgress(20);
                },
                abortController.signal
              ),
              // Stagger engagement fetches by 500ms per account so multiple large
              // accounts don't all hammer the Bluesky API at exactly the same time.
              (async () => {
                if (idx > 0) await new Promise((r) => setTimeout(r, idx * 500));
                return getOrFetchEngagement(
                  profile.did,
                  speedTier,
                  maxPosts,
                  (analyzed, total) => {
                    postProgress[profile.did] = { analyzed, total };
                    sendProgress(20);
                  },
                  abortController.signal
                );
              })(),
            ]);

            // Mark complete at 100% without changing the denominator.
            // Using Math.max(actual, maxPosts) was causing the bars to regress:
            // callbacks establish the true total (feed.length), and bumping it
            // back up to maxPosts drops the aggregate percentage visually.
            // Instead, just set fetched=max and analyzed=total (whatever they are).
            const curFolMax = followerProgress[profile.did]?.max ?? 1;
            followerProgress[profile.did] = { fetched: curFolMax, max: curFolMax };
            const curPostTotal = postProgress[profile.did]?.total ?? maxPosts;
            postProgress[profile.did] = { analyzed: curPostTotal, total: curPostTotal };
            sendProgress(20);

            cacheStatus[profile.did] = followerResult.fromCache ? 'hit' : 'miss';

            return {
              profile,
              followers: followerResult.set,
              engagers: engagementResult.set,
              stats: engagementResult.stats,
            };
          })
        );

        // ── 3. Compute pairwise overlaps ──────────────────────────────────────
        send({ type: 'progress', message: 'Calculating overlaps...', pct: 85 });

        const followerSets = accountData.map((d) => d.followers);
        const engagementSets = accountData.map((d) => d.engagers);
        const engagementStats = accountData.map((d) => d.stats);

        const overlapDetailStore: Record<
          string,
          { followerDids: string[]; engagementDids: string[] }
        > = {};

        const pairwiseOverlaps: PairwiseOverlap[] = [];

        for (let i = 0; i < profiles.length; i++) {
          for (let j = i + 1; j < profiles.length; j++) {
            const folOverlapSet = new Set(
              [...followerSets[i]].filter((x) => followerSets[j].has(x))
            );
            const folUnion = new Set([...followerSets[i], ...followerSets[j]]);
            const followerJaccard = folUnion.size > 0
              ? (folOverlapSet.size / folUnion.size) * 100
              : 0;

            const engOverlapSet = new Set(
              [...engagementSets[i]].filter((x) => engagementSets[j].has(x))
            );
            const engUnion = new Set([...engagementSets[i], ...engagementSets[j]]);
            const engagementJaccard = engUnion.size > 0
              ? (engOverlapSet.size / engUnion.size) * 100
              : 0;

            // Sample up to MAX_OVERLAP_SAMPLE DIDs for the drill-down modal
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

            pairwiseOverlaps.push({
              id: overlapId,
              account1: profiles[i],
              account2: profiles[j],
              followers1: followerSets[i].size,
              followers2: followerSets[j].size,
              followerOverlap: folOverlapSet.size,
              followerOverlapPct1:
                followerSets[i].size > 0
                  ? (folOverlapSet.size / followerSets[i].size) * 100
                  : 0,
              followerOverlapPct2:
                followerSets[j].size > 0
                  ? (folOverlapSet.size / followerSets[j].size) * 100
                  : 0,
              followerJaccard,
              uniqueFollowers1: followerSets[i].size - folOverlapSet.size,
              uniqueFollowers2: followerSets[j].size - folOverlapSet.size,
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

        // ── 4. Three-way overlap ──────────────────────────────────────────────
        let threeWayOverlap = null;
        if (profiles.length === 3) {
          const folThree = [...followerSets[0]].filter(
            (x) => followerSets[1].has(x) && followerSets[2].has(x)
          );
          const engThree = [...engagementSets[0]].filter(
            (x) => engagementSets[1].has(x) && engagementSets[2].has(x)
          );
          threeWayOverlap = { follower: folThree.length, engagement: engThree.length };
        }

        // ── 5. Collaboration values ───────────────────────────────────────────
        const collaborationValues = calculateCollaborationValue(
          profiles,
          engagementSets,
          pairwiseOverlaps,
          true,
          engagementStats,
          intent
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
        };

        send({ type: 'result', data: result });
      } catch (err) {
        const message =
          err instanceof DOMException && err.name === 'AbortError'
            ? 'Analysis cancelled'
            : (err as Error).message ?? 'An unexpected error occurred';
        send({ type: 'error', message });
      } finally {
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
