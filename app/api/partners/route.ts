import { NextRequest } from 'next/server';
import { getProfile, extractHandle, fetchProfilesForDids } from '@/lib/bsky/api';
import { getRedis } from '@/lib/redis/client';
import { getDirectoryEntries } from '@/lib/redis/directory';
import type { SpeedTier, JournalistEntry } from '@/lib/types';

export const maxDuration = 60;

// Lua script: count intersection size server-side (avoids transferring full sets)
const SINTERCOUNT_SCRIPT = `return #redis.call('sinter', KEYS[1], KEYS[2])`;
const SINTERCOUNT3_SCRIPT = `return #redis.call('sinter', KEYS[1], KEYS[2], KEYS[3])`;

const TIER_PRIORITY: SpeedTier[] = ['complete', 'balanced', 'quick'];

// ── Scoring helpers ─────────────────────────────────────────────────────────

function getOverlapLevel(jaccard: number): 'high' | 'medium' | 'low' {
  if (jaccard >= 0.10) return 'high';
  if (jaccard >= 0.03) return 'medium';
  return 'low';
}

function sizeSimilarity(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  const ratio = Math.min(a, b) / Math.max(a, b);
  return ratio >= 0.8 ? 1.0 : ratio;
}

// Topic cluster map — user selects clusters, journalists have specific topics
const TOPIC_CLUSTERS: Record<string, string[]> = {
  'Politics & Government': ['Politics', 'Government Accountability', 'Policy', 'National Security', 'Foreign Policy', 'Immigration', 'Labor', 'Criminal Justice', 'Inequality'],
  'Tech & Science': ['Tech', 'Science', 'Internet Culture', 'Games/Gaming'],
  'Data Visualization': ['Data Visualization', 'Data', 'Charts', 'Infographics', 'Data Journalism'],
  'OSINT': ['OSINT', 'Open Source Intelligence', 'Verification', 'Fact-Checking', 'Disinformation', 'Geolocation'],
  'Business & Finance': ['Finance/Economics', 'Business', 'Personal Finance', 'Real Estate', 'Careers', 'Energy', 'Construction'],
  'Culture & Arts': ['Culture', 'Entertainment/Hollywood', 'Music', 'Film/Movies', 'Art', 'Books/Writing', 'Photography', 'Design', 'Fashion', 'Comedy', 'Gossip'],
  'Health & Lifestyle': ['Health/Wellness', 'Mental Health', 'Lifestyle', 'Fitness', 'Self Help', 'Parenting', 'Family', 'Dating/Romance', 'Running'],
  'Food & Travel': ['Food', 'Restaurants', 'Recipes', 'Bars', 'Travel', 'Things to do', 'Things to Do', 'Outdoors'],
  'Environment': ['Climate/Environment', 'Agriculture', 'Animals', 'Weather'],
  'Social Justice': ['Identity/Belonging', 'Gender', 'LGBTQIA', 'Activism', 'Human Rights', 'Faith/Religion'],
  'Investigative': ['Investigative', 'Law/Legal Issues', 'Crime'],
  'World & News': ['World', 'General News', 'Explanatory', 'History', 'Media/Power', 'Solutions Journalism', 'Positive News', 'Positive news'],
  'Local News': ['Local', 'Local News', 'Local news', 'Urban planning', 'Transit/Transportation'],
  'Sports': ['Sports'],
  'Education': ['Education'],
};

/** Expand cluster names to their constituent topics. */
function expandTopics(userTopics: string[]): string[] {
  const expanded: string[] = [];
  for (const ut of userTopics) {
    const members = TOPIC_CLUSTERS[ut];
    if (members) {
      expanded.push(...members);
    } else {
      expanded.push(ut);
    }
  }
  return expanded;
}

function topicSimilarity(userTopics: string[], journalistTopics: string[]): number {
  if (userTopics.length === 0 || journalistTopics.length === 0) return 0;

  // Expand cluster names to individual topics
  const expanded = expandTopics(userTopics);
  const jLower = journalistTopics.map(t => t.toLowerCase());
  const eLower = expanded.map(t => t.toLowerCase());

  // Check if any of the journalist's topics match any expanded user topics
  let matched = false;
  for (const jt of jLower) {
    if (eLower.some(e => e === jt || e.includes(jt) || jt.includes(e))) {
      matched = true;
      break;
    }
  }

  return matched ? 1.0 : 0;
}

// ── Geography consolidation ─────────────────────────────────────────────────

const US_STATE_REGIONS: Record<string, string> = {
  // Northeast
  'ny': 'USA — Northeast', 'nj': 'USA — Northeast', 'ct': 'USA — Northeast',
  'ma': 'USA — Northeast', 'pa': 'USA — Northeast', 'ri': 'USA — Northeast',
  'vt': 'USA — Northeast', 'nh': 'USA — Northeast', 'me': 'USA — Northeast',
  // Southeast
  'fl': 'USA — Southeast', 'ga': 'USA — Southeast', 'nc': 'USA — Southeast',
  'sc': 'USA — Southeast', 'va': 'USA — Southeast', 'al': 'USA — Southeast',
  'ms': 'USA — Southeast', 'tn': 'USA — Southeast', 'la': 'USA — Southeast',
  'ar': 'USA — Southeast', 'ky': 'USA — Southeast', 'wv': 'USA — Southeast',
  // Midwest
  'il': 'USA — Midwest', 'oh': 'USA — Midwest', 'mi': 'USA — Midwest',
  'in': 'USA — Midwest', 'wi': 'USA — Midwest', 'mn': 'USA — Midwest',
  'ia': 'USA — Midwest', 'mo': 'USA — Midwest', 'ks': 'USA — Midwest',
  'ne': 'USA — Midwest', 'nd': 'USA — Midwest', 'sd': 'USA — Midwest',
  // Southwest
  'tx': 'USA — Southwest', 'ok': 'USA — Southwest', 'nm': 'USA — Southwest',
  'az': 'USA — Southwest',
  // West
  'ca': 'USA — West', 'or': 'USA — West', 'wa': 'USA — West',
  'co': 'USA — West', 'nv': 'USA — West', 'ut': 'USA — West',
  'id': 'USA — West', 'mt': 'USA — West', 'wy': 'USA — West',
  'hi': 'USA — West', 'ak': 'USA — West',
  // DC
  'dc': 'USA — DC/National', 'd.c.': 'USA — DC/National',
};

/** Normalize raw geography to a consolidated region. */
function consolidateGeo(raw: string | undefined): string {
  if (!raw) return '';
  const lower = raw.toLowerCase().trim();

  // National US
  if (lower.includes('national') && lower.includes('us')) return 'USA — National';

  // "Washington, D.C."
  if (lower.includes('d.c.') || lower.includes('washington, dc')) return 'USA — DC/National';

  // "City, ST" format (e.g., "New York, NY")
  const cityState = lower.match(/,\s*([a-z]{2})$/);
  if (cityState) {
    const region = US_STATE_REGIONS[cityState[1]];
    if (region) return region;
  }

  // "StateName - US" format (e.g., "California - US")
  const stateUS = lower.match(/^(.+?)\s*-\s*us$/);
  if (stateUS) {
    // Try to match state name to abbreviation
    const stateName = stateUS[1].trim();
    const stateAbbrs: Record<string, string> = {
      'california': 'ca', 'new york': 'ny', 'texas': 'tx', 'florida': 'fl',
      'illinois': 'il', 'pennsylvania': 'pa', 'ohio': 'oh', 'georgia': 'ga',
      'north carolina': 'nc', 'michigan': 'mi', 'new jersey': 'nj',
      'virginia': 'va', 'washington': 'wa', 'massachusetts': 'ma',
      'arizona': 'az', 'indiana': 'in', 'tennessee': 'tn', 'missouri': 'mo',
      'maryland': 'md', 'wisconsin': 'wi', 'colorado': 'co', 'minnesota': 'mn',
      'alabama': 'al', 'louisiana': 'la', 'kentucky': 'ky', 'oregon': 'or',
      'oklahoma': 'ok', 'connecticut': 'ct', 'iowa': 'ia', 'arkansas': 'ar',
      'nevada': 'nv', 'mississippi': 'ms', 'kansas': 'ks', 'new mexico': 'nm',
      'utah': 'ut', 'nebraska': 'ne', 'idaho': 'id', 'hawaii': 'hi',
      'maine': 'me', 'montana': 'mt', 'rhode island': 'ri', 'delaware': 'de',
      'south dakota': 'sd', 'north dakota': 'nd', 'alaska': 'ak',
      'vermont': 'vt', 'wyoming': 'wy', 'west virginia': 'wv',
      'south carolina': 'sc', 'new hampshire': 'nh',
    };
    const abbr = stateAbbrs[stateName];
    if (abbr && US_STATE_REGIONS[abbr]) return US_STATE_REGIONS[abbr];
    return 'USA';
  }

  // International
  if (lower === 'international') return 'International';
  if (lower.includes('united kingdom') || lower.includes('uk')) return 'United Kingdom';
  if (lower.includes('canada')) return 'Canada';
  if (lower.includes('australia')) return 'Australia';
  if (lower.includes('france')) return 'France';
  if (lower.includes('germany')) return 'Germany';

  // Fallback: return as-is
  return raw;
}

function geoSimilarity(userGeo: string | undefined, journalistGeo: string | undefined): number {
  if (!userGeo || !journalistGeo) return 0;

  const uRegion = consolidateGeo(userGeo);
  const jRegion = consolidateGeo(journalistGeo);

  if (!uRegion || !jRegion) return 0;

  // Exact region match
  if (uRegion === jRegion) return 1.0;

  // Both in USA (any region)
  if (uRegion.startsWith('USA') && jRegion.startsWith('USA')) return 0.4;

  return 0;
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ScoredJournalist {
  entry: JournalistEntry;
  setKey: string;
  setSize: number;
  overlapWithUser: number;
  jaccardWithUser: number;
  compositeScore: number;
  sizeMatch: boolean;
  topicMatch: boolean;
  geoMatch: boolean;
}

interface TrioRecommendation {
  matchA: {
    did: string;
    handle: string;
    displayName: string;
    avatar?: string;
    geography?: string;
    followerCount: number;
  };
  matchB: {
    did: string;
    handle: string;
    displayName: string;
    avatar?: string;
    geography?: string;
    followerCount: number;
  };
  overlaps: {
    userA: number;
    userB: number;
    ab: number;
    threeWay: number;
  };
  sizes: {
    user: number;
    a: number;
    b: number;
  };
  totalReach: number;
  newAudienceForUser: number;
  newAudienceForA: number;
  newAudienceForB: number;
  trioScore: number;
  overlapLevel: 'high' | 'medium' | 'low';
  signals: {
    sizeMatch: boolean;
    topicMatch: boolean;
    geoMatch: boolean;
  };
}

interface PairRecommendation {
  match: {
    did: string;
    handle: string;
    displayName: string;
    avatar?: string;
    geography?: string;
    followerCount: number;
  };
  overlap: number;
  sizes: { user: number; match: number };
  totalReach: number;
  newAudienceForUser: number;
  newAudienceForMatch: number;
  pairScore: number;
  overlapLevel: 'high' | 'medium' | 'low';
  signals: {
    sizeMatch: boolean;
    topicMatch: boolean;
    geoMatch: boolean;
  };
}

// ── Redis helpers ───────────────────────────────────────────────────────────

async function findBestFollowerSet(
  redis: NonNullable<ReturnType<typeof getRedis>>,
  did: string
): Promise<{ key: string; size: number; tier: SpeedTier } | null> {
  const pipe = redis.pipeline();
  for (const tier of TIER_PRIORITY) {
    pipe.scard(`followers:${did}:${tier}`);
  }
  const results = await pipe.exec();
  for (let i = 0; i < TIER_PRIORITY.length; i++) {
    const size = (results[i] as number) ?? 0;
    if (size > 0) {
      return { key: `followers:${did}:${TIER_PRIORITY[i]}`, size, tier: TIER_PRIORITY[i] };
    }
  }
  return null;
}

/**
 * GET /api/partners?handle=...&topics=...&geography=...&limit=3
 *
 * Returns trio recommendations: groups of 3 (user + 2 journalists)
 * ranked by composite score + mutual overlap.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const rawHandle = searchParams.get('handle');
  const limitParam = parseInt(searchParams.get('limit') ?? '3', 10);
  const topicsRaw = searchParams.get('topics') || searchParams.get('topic') || '';
  const userTopics = topicsRaw ? topicsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const userGeo = searchParams.get('geography') || undefined;
  const mode = searchParams.get('mode') === 'pair' ? 'pair' : 'trio';

  if (!rawHandle) {
    return Response.json({ error: 'Missing required "handle" query parameter' }, { status: 400 });
  }

  const resultCount = Math.min(Math.max(1, limitParam), 10);

  const redis = getRedis();
  if (!redis) {
    return Response.json({ error: 'Redis is not configured.' }, { status: 503 });
  }

  try {
    // ── 1. Resolve user ──────────────────────────────────────────────────────
    const handle = extractHandle(rawHandle);
    const profile = await getProfile(handle);

    // ── 2. User's cached follower set ────────────────────────────────────────
    const userSet = await findBestFollowerSet(redis, profile.did);
    if (!userSet) {
      return Response.json({
        error: 'no_cache',
        user: { did: profile.did, handle: profile.handle, followerCount: profile.followersCount ?? 0 },
      }, { status: 404 });
    }

    let userFollowerCount = userSet.size;
    try {
      const meta = await redis.hgetall(`cache:meta:${profile.did}:${userSet.tier}`) as Record<string, unknown> | null;
      if (meta?.followerCount) userFollowerCount = Number(meta.followerCount);
    } catch { /* fall back to set size */ }
    if (profile.followersCount && profile.followersCount > userFollowerCount) {
      userFollowerCount = profile.followersCount;
    }

    // ── 3. Load directory ────────────────────────────────────────────────────
    const directoryPage = await getDirectoryEntries({ limit: 1000, offset: 0 });
    const journalists = directoryPage.entries;
    if (journalists.length === 0) {
      return Response.json({
        user: { did: profile.did, handle: profile.handle, followerCount: userFollowerCount, avatar: profile.avatar },
        trios: [], totalJournalists: 0, comparedCount: 0,
      });
    }

    // ── 4. Find cached journalist sets ───────────────────────────────────────
    const journalistSetInfo: Map<string, { key: string; size: number }> = new Map();
    for (const tier of TIER_PRIORITY) {
      const pipe = redis.pipeline();
      for (const j of journalists) pipe.scard(`followers:${j.did}:${tier}`);
      const results = await pipe.exec();
      for (let i = 0; i < journalists.length; i++) {
        const did = journalists[i].did;
        if (!journalistSetInfo.has(did)) {
          const size = (results[i] as number) ?? 0;
          if (size > 0) journalistSetInfo.set(did, { key: `followers:${did}:${tier}`, size });
        }
      }
    }

    const comparableJournalists = journalists.filter(j => journalistSetInfo.has(j.did) && j.did !== profile.did);
    if (comparableJournalists.length === 0) {
      return Response.json({
        user: { did: profile.did, handle: profile.handle, followerCount: userFollowerCount, avatar: profile.avatar },
        trios: [], totalJournalists: directoryPage.total, comparedCount: 0,
      });
    }

    // ── 5. Compute user-journalist overlaps ──────────────────────────────────
    // Cap comparisons to avoid timeouts — top 100 by set size similarity
    const MAX_COMPARE = 100;
    const rankedByRelevance = [...comparableJournalists].sort((a, b) => {
      const aSize = journalistSetInfo.get(a.did)!.size;
      const bSize = journalistSetInfo.get(b.did)!.size;
      return sizeSimilarity(userFollowerCount, bSize) - sizeSimilarity(userFollowerCount, aSize);
    }).slice(0, MAX_COMPARE);

    const PIPELINE_BATCH = 25;
    const overlapCounts: Map<string, number> = new Map();

    for (let batch = 0; batch < rankedByRelevance.length; batch += PIPELINE_BATCH) {
      const chunk = rankedByRelevance.slice(batch, batch + PIPELINE_BATCH);
      const pipe = redis.pipeline();
      for (const j of chunk) {
        const jInfo = journalistSetInfo.get(j.did)!;
        // Use Lua eval to count intersection server-side (avoids transferring full sets)
        pipe.eval(SINTERCOUNT_SCRIPT, [userSet.key, jInfo.key], []);
      }
      const results = await pipe.exec();
      for (let i = 0; i < chunk.length; i++) {
        overlapCounts.set(chunk[i].did, Number(results[i]) || 0);
      }
    }

    // ── 6. Score individuals ─────────────────────────────────────────────────
    const W_JACCARD = 0.40, W_SIZE = 0.30, W_TOPIC = 0.20, W_GEO = 0.10;

    const scored: ScoredJournalist[] = rankedByRelevance.map(j => {
      const overlapCount = overlapCounts.get(j.did) ?? 0;
      const jSetSize = journalistSetInfo.get(j.did)!.size;
      const union = userSet.size + jSetSize - overlapCount;
      const jaccard = union > 0 ? overlapCount / union : 0;
      const jaccardNorm = Math.min(jaccard / 0.20, 1.0);
      const sizeScore = sizeSimilarity(userFollowerCount, jSetSize);
      const topicScore = topicSimilarity(userTopics, j.topics);
      const geoScore = geoSimilarity(userGeo, j.geography);
      const compositeScore = W_JACCARD * jaccardNorm + W_SIZE * sizeScore + W_TOPIC * topicScore + W_GEO * geoScore;

      return {
        entry: j,
        setKey: journalistSetInfo.get(j.did)!.key,
        setSize: jSetSize,
        overlapWithUser: overlapCount,
        jaccardWithUser: jaccard,
        compositeScore,
        sizeMatch: sizeScore >= 0.8,
        topicMatch: topicScore > 0,
        geoMatch: geoScore > 0,
      };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // ── PAIR MODE: return individual matches ─────────────────────────────────
    if (mode === 'pair') {
      const topPairs = scored.slice(0, resultCount);
      const pairDids = topPairs.map(s => s.entry.did);
      const avatarMap: Map<string, string | undefined> = new Map();
      if (pairDids.length > 0) {
        try {
          const profiles = await fetchProfilesForDids(pairDids);
          for (const p of profiles) avatarMap.set(p.did, p.avatar);
        } catch { /* Non-critical */ }
      }

      const pairs: PairRecommendation[] = topPairs.map(s => {
        // Use real follower count from directory if available, fall back to set size
        const matchRealCount = s.entry.followerCount || s.setSize;
        const totalReach = userFollowerCount + matchRealCount - s.overlapWithUser;
        // New audience: followers they bring that the other doesn't have
        const newAudienceForUser = matchRealCount - s.overlapWithUser;
        const newAudienceForMatch = userFollowerCount - s.overlapWithUser;
        return {
          match: {
            did: s.entry.did,
            handle: s.entry.handle,
            displayName: s.entry.displayName,
            avatar: avatarMap.get(s.entry.did),
            geography: s.entry.geography,
            followerCount: matchRealCount,
          },
          overlap: s.overlapWithUser,
          sizes: { user: userFollowerCount, match: matchRealCount },
          totalReach,
          newAudienceForUser: Math.max(0, newAudienceForUser),
          newAudienceForMatch: Math.max(0, newAudienceForMatch),
          pairScore: Math.round(s.compositeScore * 1000) / 1000,
          overlapLevel: getOverlapLevel(s.jaccardWithUser),
          signals: {
            sizeMatch: s.sizeMatch,
            topicMatch: s.topicMatch,
            geoMatch: s.geoMatch,
          },
        };
      });

      return Response.json({
        mode: 'pair',
        user: {
          did: profile.did,
          handle: profile.handle,
          followerCount: userFollowerCount,
          avatar: profile.avatar,
          sampleSize: userSet.size,
        },
        pairs,
        totalJournalists: directoryPage.total,
        comparedCount: comparableJournalists.length,
      });
    }

    // ── 7. Form trios from top candidates ────────────────────────────────────
    // Take top 20 individual matches, compute pairwise journalist-journalist overlaps
    const TOP_N = Math.min(10, scored.length);
    const candidates = scored.slice(0, TOP_N);

    // Compute all pairwise journalist-journalist overlaps
    type Pair = { iA: number; iB: number };
    const pairs: Pair[] = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        pairs.push({ iA: i, iB: j });
      }
    }

    const pairOverlaps: Map<string, number> = new Map();
    for (let batch = 0; batch < pairs.length; batch += PIPELINE_BATCH) {
      const chunk = pairs.slice(batch, batch + PIPELINE_BATCH);
      const pipe = redis.pipeline();
      for (const { iA, iB } of chunk) {
        pipe.eval(SINTERCOUNT_SCRIPT, [candidates[iA].setKey, candidates[iB].setKey], []);
      }
      const results = await pipe.exec();
      for (let i = 0; i < chunk.length; i++) {
        const { iA, iB } = chunk[i];
        pairOverlaps.set(`${iA}:${iB}`, Number(results[i]) || 0);
      }
    }

    // Score all candidate trios
    interface CandidateTrio {
      iA: number;
      iB: number;
      abOverlap: number;
      abJaccard: number;
      trioScore: number;
    }

    const candidateTrios: CandidateTrio[] = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const abOverlap = pairOverlaps.get(`${i}:${j}`) ?? 0;
        const abUnion = candidates[i].setSize + candidates[j].setSize - abOverlap;
        const abJaccard = abUnion > 0 ? abOverlap / abUnion : 0;

        // Trio score: average individual quality + mutual connection bonus
        const avgComposite = (candidates[i].compositeScore + candidates[j].compositeScore) / 2;
        const mutualBonus = Math.min(abJaccard / 0.10, 1.0) * 0.3; // bonus for A-B connection
        const trioScore = avgComposite + mutualBonus;

        candidateTrios.push({ iA: i, iB: j, abOverlap, abJaccard, trioScore });
      }
    }

    candidateTrios.sort((a, b) => b.trioScore - a.trioScore);

    // Pick top trios with no journalist overlap (each journalist appears once)
    const usedIndices = new Set<number>();
    const selectedTrios: CandidateTrio[] = [];
    for (const trio of candidateTrios) {
      if (usedIndices.has(trio.iA) || usedIndices.has(trio.iB)) continue;
      selectedTrios.push(trio);
      usedIndices.add(trio.iA);
      usedIndices.add(trio.iB);
      if (selectedTrios.length >= resultCount) break;
    }

    // ── 8. Compute three-way intersections for selected trios ────────────────
    if (selectedTrios.length > 0) {
      const pipe = redis.pipeline();
      for (const trio of selectedTrios) {
        pipe.eval(SINTERCOUNT3_SCRIPT, [userSet.key, candidates[trio.iA].setKey, candidates[trio.iB].setKey], []);
      }
      const results = await pipe.exec();
      for (let i = 0; i < selectedTrios.length; i++) {
        (selectedTrios[i] as CandidateTrio & { threeWayOverlap?: number }).threeWayOverlap =
          Number(results[i]) || 0;
      }
    }

    // ── 9. Fetch avatars for the selected journalists ────────────────────────
    const selectedDids = selectedTrios.flatMap(t => [
      candidates[t.iA].entry.did,
      candidates[t.iB].entry.did,
    ]);
    const avatarMap: Map<string, string | undefined> = new Map();
    if (selectedDids.length > 0) {
      try {
        const profiles = await fetchProfilesForDids(selectedDids);
        for (const p of profiles) {
          avatarMap.set(p.did, p.avatar);
        }
      } catch {
        // Non-critical — proceed without avatars
      }
    }

    // ── 10. Build response ───────────────────────────────────────────────────
    const trios: TrioRecommendation[] = selectedTrios.map(trio => {
      const a = candidates[trio.iA];
      const b = candidates[trio.iB];
      const threeWay = (trio as CandidateTrio & { threeWayOverlap?: number }).threeWayOverlap ?? 0;

      // Use real follower counts from directory if available
      const aRealCount = a.entry.followerCount || a.setSize;
      const bRealCount = b.entry.followerCount || b.setSize;

      // Inclusion-exclusion: |A ∪ B ∪ C| = |A| + |B| + |C| - |A∩B| - |A∩C| - |B∩C| + |A∩B∩C|
      const totalReach = userFollowerCount + aRealCount + bRealCount
        - a.overlapWithUser - b.overlapWithUser - trio.abOverlap + threeWay;

      // New audience each collaborator brings to YOU
      // (their followers minus the ones you already have)
      const newAudienceForUser = (aRealCount - a.overlapWithUser) + (bRealCount - b.overlapWithUser) - trio.abOverlap + threeWay;
      const newAudienceForA = (userFollowerCount - a.overlapWithUser) + (bRealCount - trio.abOverlap);
      const newAudienceForB = (userFollowerCount - b.overlapWithUser) + (aRealCount - trio.abOverlap);

      // Average Jaccard for the trio's overlap level
      const avgJaccard = (a.jaccardWithUser + b.jaccardWithUser + trio.abJaccard) / 3;

      return {
        matchA: {
          did: a.entry.did,
          handle: a.entry.handle,
          displayName: a.entry.displayName,
          avatar: avatarMap.get(a.entry.did),
          geography: a.entry.geography,
          followerCount: aRealCount,
        },
        matchB: {
          did: b.entry.did,
          handle: b.entry.handle,
          displayName: b.entry.displayName,
          avatar: avatarMap.get(b.entry.did),
          geography: b.entry.geography,
          followerCount: bRealCount,
        },
        overlaps: {
          userA: a.overlapWithUser,
          userB: b.overlapWithUser,
          ab: trio.abOverlap,
          threeWay,
        },
        sizes: {
          user: userFollowerCount,
          a: aRealCount,
          b: bRealCount,
        },
        totalReach,
        newAudienceForUser: Math.max(0, newAudienceForUser),
        newAudienceForA: Math.max(0, newAudienceForA),
        newAudienceForB: Math.max(0, newAudienceForB),
        trioScore: Math.round(trio.trioScore * 1000) / 1000,
        overlapLevel: getOverlapLevel(avgJaccard),
        signals: {
          sizeMatch: a.sizeMatch && b.sizeMatch,
          topicMatch: a.topicMatch || b.topicMatch,
          geoMatch: a.geoMatch || b.geoMatch,
        },
      };
    });

    return Response.json({
      user: {
        did: profile.did,
        handle: profile.handle,
        followerCount: userFollowerCount,
        avatar: profile.avatar,
        sampleSize: userSet.size,
      },
      mode: 'trio',
      trios,
      totalJournalists: directoryPage.total,
      comparedCount: comparableJournalists.length,
    });
  } catch (err) {
    const message = (err as Error).message ?? 'An unexpected error occurred';
    if (message.includes('not found') || message.includes('Could not find')) {
      return Response.json({ error: `Could not find Bluesky account: ${rawHandle}` }, { status: 404 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
