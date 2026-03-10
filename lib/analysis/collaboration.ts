import type {
  BskyProfile,
  CollaborationValue,
  EngagementStats,
  AnalysisIntent,
  IntentWeights,
  PairwiseOverlap,
} from '@/lib/types';

interface AudienceData {
  profile: BskyProfile;
  audienceSize: number;
  engagementRate: number;
  followerCount: number;
}

/**
 * Ported verbatim from index.html calculateCollaborationValue().
 * Intent-aware weights determine the collaboration value split.
 */
export function calculateCollaborationValue(
  profiles: BskyProfile[],
  audienceSets: Array<Set<string>>,
  pairwiseOverlaps: PairwiseOverlap[],
  isEngagementAnalysis: boolean,
  engagementStats: EngagementStats[] | null,
  intent: AnalysisIntent
): CollaborationValue[] {
  const collaborationData: AudienceData[] = profiles.map((profile, idx) => {
    const audienceSize = audienceSets[idx].size;
    let engagementRate = 0;

    if (isEngagementAnalysis && engagementStats?.[idx]) {
      const stats = engagementStats[idx];
      const totalEngagements = stats.totalLikes + stats.totalReposts * 2;
      const avgEngagementsPerPost =
        stats.postsAnalyzed > 0 ? totalEngagements / stats.postsAnalyzed : 0;
      const followerCount = profile.followersCount ?? audienceSize;
      engagementRate =
        followerCount > 0
          ? Math.min((avgEngagementsPerPost / followerCount) * 100, 100)
          : 0;
    }

    return {
      profile,
      audienceSize,
      engagementRate,
      followerCount: profile.followersCount ?? audienceSize,
    };
  });

  // Intent-aware weights — ported verbatim from index.html
  const WEIGHTS: Record<AnalysisIntent, IntentWeights> = {
    newsletter_bundle: { reach: 40, unique: 30, engRate: 25, crossAppeal: 5 },
    trial_bundle: { reach: 20, unique: 30, engRate: 45, crossAppeal: 5 },
    general: { reach: 30, unique: 35, engRate: 30, crossAppeal: 5 },
  };
  const w = WEIGHTS[intent] ?? WEIGHTS.general;

  return pairwiseOverlaps.map((overlap) => {
    const idx1 = profiles.indexOf(overlap.account1);
    const idx2 = profiles.indexOf(overlap.account2);
    const data1 = collaborationData[idx1];
    const data2 = collaborationData[idx2];

    const uniqueContribution1 = overlap.unique1;
    const uniqueContribution2 = overlap.unique2;
    const crossAppeal1 = overlap.overlapPct1;
    const crossAppeal2 = overlap.overlapPct2;

    let score1 = 50;
    let score2 = 50;

    // 1. Follower reach (real API count, not sampled)
    const totalFollowers = data1.followerCount + data2.followerCount;
    if (totalFollowers > 0) {
      score1 += (data1.followerCount / totalFollowers - 0.5) * w.reach;
      score2 += (data2.followerCount / totalFollowers - 0.5) * w.reach;
    }

    // 2. Unique audience contribution
    const totalUnique = uniqueContribution1 + uniqueContribution2;
    if (totalUnique > 0) {
      score1 += (uniqueContribution1 / totalUnique - 0.5) * w.unique;
      score2 += (uniqueContribution2 / totalUnique - 0.5) * w.unique;
    }

    // 3. Engagement rate
    if (
      isEngagementAnalysis &&
      data1.engagementRate > 0 &&
      data2.engagementRate > 0
    ) {
      const totalEng = data1.engagementRate + data2.engagementRate;
      score1 += (data1.engagementRate / totalEng - 0.5) * w.engRate;
      score2 += (data2.engagementRate / totalEng - 0.5) * w.engRate;
    }

    // 4. Cross-appeal (low overlap = brings more new audience)
    const avgCrossAppeal = (crossAppeal1 + crossAppeal2) / 2;
    if (avgCrossAppeal < 50) {
      score1 += ((100 - crossAppeal1) / 100 - 0.5) * w.crossAppeal;
      score2 += ((100 - crossAppeal2) / 100 - 0.5) * w.crossAppeal;
    }

    // Normalize to 100%
    const totalScore = score1 + score2;
    score1 = (score1 / totalScore) * 100;
    score2 = (score2 / totalScore) * 100;

    return {
      account1: overlap.account1,
      account2: overlap.account2,
      data1,
      data2,
      uniqueContribution1,
      uniqueContribution2,
      crossAppeal1,
      crossAppeal2,
      contributionScore1: score1,
      contributionScore2: score2,
      recommendedSplit: `${Math.round(score1)}/${Math.round(score2)}`,
      weights: w,
      intent,
    };
  });
}
