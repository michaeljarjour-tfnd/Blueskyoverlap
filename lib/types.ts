// ── Bluesky types ─────────────────────────────────────────────────────────────

export interface BskyProfile {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
}

export interface EngagementStats {
  totalLikes: number;
  totalReposts: number;
  postsAnalyzed: number;
}

// ── Analysis types ─────────────────────────────────────────────────────────────

export type SpeedTier = 'quick' | 'balanced' | 'complete';
export type AnalysisIntent = 'general' | 'newsletter_bundle' | 'trial_bundle';

export interface PairwiseOverlap {
  id: string; // `${did1}-${did2}`
  account1: BskyProfile;
  account2: BskyProfile;
  followers1: number;
  followers2: number;
  followerOverlap: number;
  followerOverlapPct1: number;
  followerOverlapPct2: number;
  followerJaccard: number;
  uniqueFollowers1: number;
  uniqueFollowers2: number;
  engaged1: number;
  engaged2: number;
  engagementOverlap: number;
  engagementOverlapPct1: number;
  engagementOverlapPct2: number;
  engagementJaccard: number;
  uniqueEngaged1: number;
  uniqueEngaged2: number;
  // Legacy aliases (engagement fields) — kept for UI compat
  overlap: number;
  overlapPct1: number;
  overlapPct2: number;
  jaccard: number;
  unique1: number;
  unique2: number;
}

export interface ThreeWayOverlap {
  /** Raw overlap counts */
  follower: number;
  engagement: number;
  /** Jaccard index (0–100) for the three-way intersection */
  followerJaccard: number;
  engagementJaccard: number;
  /** The (up to 3) profiles included in this N-way overlap */
  profiles: BskyProfile[];
  /** Per-profile share: what % of each profile's audience is in the N-way overlap */
  followerPcts: number[];
  engagementPcts: number[];
}

export interface CollaborationData {
  profile: BskyProfile;
  audienceSize: number;
  engagementRate: number;
  followerCount: number;
}

export interface CollaborationValue {
  account1: BskyProfile;
  account2: BskyProfile;
  data1: CollaborationData;
  data2: CollaborationData;
  uniqueContribution1: number;
  uniqueContribution2: number;
  crossAppeal1: number;
  crossAppeal2: number;
  contributionScore1: number;
  contributionScore2: number;
  recommendedSplit: string;
  weights: IntentWeights;
  intent: AnalysisIntent;
}

export interface IntentWeights {
  reach: number;
  unique: number;
  engRate: number;
  crossAppeal: number;
}

export interface OverlapDetailEntry {
  followerDids: string[];
  engagementDids: string[];
}

export interface AnalysisResult {
  profiles: BskyProfile[];
  pairwiseOverlaps: PairwiseOverlap[];
  threeWayOverlap: ThreeWayOverlap | null;
  collaborationValues: CollaborationValue[];
  cacheStatus: Record<string, 'hit' | 'miss'>;
  speedTier: SpeedTier;
  intent: AnalysisIntent;
  /** DID samples for the drill-down modal, keyed by overlapId */
  overlapDetails: Record<string, OverlapDetailEntry>;
}

// ── API request/response ───────────────────────────────────────────────────────

export interface AnalyzeRequest {
  handles: string[];
  speedTier: SpeedTier;
  intent: AnalysisIntent;
}

export type SseEvent =
  | { type: 'progress'; message: string; pct: number; followerProgress?: Record<string, { fetched: number; max: number }>; postProgress?: Record<string, { analyzed: number; total: number }> }
  | { type: 'result'; data: AnalysisResult }
  | { type: 'error'; message: string };

export interface Interpretation {
  label: string;
  color: string;
  emoji: string;
}

// ── Overlap detail store ───────────────────────────────────────────────────────

export interface OverlapDetail {
  followerDids: string[];
  engagementDids: string[];
  account1: BskyProfile;
  account2: BskyProfile;
}
