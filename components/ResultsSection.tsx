'use client';

import { useState } from 'react';
import type { AnalysisResult, BskyProfile, PairwiseOverlap, ThreeWayOverlap } from '@/lib/types';
import { getInterpretation, formatFollowers } from '@/lib/analysis/interpret';
import OverlapDetailModal from './OverlapDetailModal';
import { VennCard, PairVennHeader, threeWayToOverlapData, pairToOverlapData } from './CollaborationVenn';

interface Props {
  result: AnalysisResult;
  /** 'live' = analysis just ran (show share button), 'saved' = viewing a saved report */
  mode?: 'live' | 'saved';
}

// ── Overlap badge ──────────────────────────────────────────────────────────────

function OverlapBadge({ label }: { label: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    'Very High': { bg: '#04182B', color: '#F8FFFF' },
    'High':      { bg: '#034EAD', color: '#F8FFFF' },
    'Moderate':  { bg: '#EBF2FD', color: '#034EAD' },
    'Low':       { bg: '#f0f4f8', color: '#5a6a7a' },
    'Minimal':   { bg: '#f0f4f8', color: '#8a9ab0' },
  };
  const s = styles[label] ?? styles['Minimal'];

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 9px',
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        background: s.bg,
        color: s.color,
      }}
    >
      {label}
    </span>
  );
}

// ── Creator share columns (inside each OverlapCard) ────────────────────────────

function CreatorShares({
  profiles,
  sharedPcts,
  uniquePcts,
}: {
  profiles: BskyProfile[];
  sharedPcts: number[];
  uniquePcts: number[];
}) {
  // Up to 3 columns; if >3 profiles, stack vertically
  const stackCols = profiles.length > 3;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: stackCols ? '1fr' : `repeat(${Math.min(profiles.length, 3)}, 1fr)`,
        gap: 8,
        marginTop: 16,
        paddingTop: 16,
        borderTop: '1px solid var(--color-border)',
      }}
    >
      {profiles.map((p, i) => {
        const name = p.displayName || p.handle;
        const shared = sharedPcts[i] ?? 0;
        const unique = uniquePcts[i] ?? 0;

        return (
          <div
            key={p.did}
            style={{
              background: 'var(--color-bg-light)',
              borderRadius: 4,
              padding: '10px 12px',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--color-navy)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginBottom: 5,
              }}
            >
              {name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
              <span style={{ color: 'var(--color-navy)', fontWeight: 600 }}>
                {shared.toFixed(1)}%
              </span>{' '}
              shared
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
              <span style={{ fontWeight: 500 }}>{unique.toFixed(1)}%</span> unique
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Overlap card ───────────────────────────────────────────────────────────────

function OverlapCard({
  type,
  sharedCount,
  jaccard,
  profiles,
  sharedPcts,
  uniquePcts,
  onDrillDown,
  isEstimated,
}: {
  type: 'followers' | 'engagement';
  sharedCount: number;
  jaccard: number;
  profiles: BskyProfile[];
  sharedPcts: number[];
  uniquePcts: number[];
  onDrillDown: () => void;
  isEstimated?: boolean;
}) {
  const interp = getInterpretation(jaccard);
  const isEstimatedFollowers = type === 'followers' && isEstimated;
  const sectionLabel = isEstimatedFollowers ? 'Minimum Follower Overlap' : (type === 'followers' ? 'Follower Overlap' : 'Engagement Overlap');
  const sharedLabel = isEstimatedFollowers ? 'min. shared followers (est.)' : (type === 'followers' ? 'shared followers' : 'shared engagers');

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: '24px 22px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Section label */}
      <div className="section-label" style={{ marginBottom: 14 }}>
        {sectionLabel}
      </div>

      {/* Big clickable number */}
      <button
        onClick={onDrillDown}
        title={`View list of ${sharedLabel}`}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          textAlign: 'left',
          display: 'block',
          marginBottom: 2,
        }}
      >
        <div
          style={{
            fontSize: 52,
            fontWeight: 400,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-blue)',
            letterSpacing: '-0.03em',
            lineHeight: 1,
          }}
        >
          {sharedCount.toLocaleString()}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-blue)',
            fontWeight: 500,
            marginTop: 5,
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            opacity: 0.85,
          }}
        >
          {sharedLabel}
          <span style={{ fontSize: 10 }}>↗</span>
        </div>
      </button>

      {/* Similarity % */}
      <div
        style={{
          fontSize: 22,
          fontWeight: 400,
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-muted)',
          letterSpacing: '-0.01em',
          lineHeight: 1,
        }}
      >
        {jaccard.toFixed(1)}%
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-faint)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginTop: 3,
          marginBottom: 14,
        }}
      >
        Similarity
      </div>

      {/* Badge */}
      <OverlapBadge label={interp.label} />

      {/* Per-creator share breakdown */}
      <CreatorShares profiles={profiles} sharedPcts={sharedPcts} uniquePcts={uniquePcts} />
    </div>
  );
}

// ── Two overlap cards for one pair ────────────────────────────────────────────

function PairOverlapCards({
  overlap,
  onDrillDown,
}: {
  overlap: PairwiseOverlap;
  onDrillDown: (overlapId: string, type: 'followers' | 'engagement') => void;
}) {
  const profiles = [overlap.account1, overlap.account2];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
      }}
    >
      <OverlapCard
        type="followers"
        sharedCount={overlap.followerOverlap}
        jaccard={overlap.followerJaccard}
        profiles={profiles}
        sharedPcts={[overlap.followerOverlapPct1, overlap.followerOverlapPct2]}
        uniquePcts={[
          overlap.followers1 > 0 ? (overlap.uniqueFollowers1 / overlap.followers1) * 100 : 0,
          overlap.followers2 > 0 ? (overlap.uniqueFollowers2 / overlap.followers2) * 100 : 0,
        ]}
        onDrillDown={() => onDrillDown(overlap.id, 'followers')}
        isEstimated={overlap.isEstimated}
      />
      <OverlapCard
        type="engagement"
        sharedCount={overlap.engagementOverlap}
        jaccard={overlap.engagementJaccard}
        profiles={profiles}
        sharedPcts={[overlap.engagementOverlapPct1, overlap.engagementOverlapPct2]}
        uniquePcts={[
          overlap.engaged1 > 0 ? (overlap.uniqueEngaged1 / overlap.engaged1) * 100 : 0,
          overlap.engaged2 > 0 ? (overlap.uniqueEngaged2 / overlap.engaged2) * 100 : 0,
        ]}
        onDrillDown={() => onDrillDown(overlap.id, 'engagement')}
      />
    </div>
  );
}

// ── Collapsible pair accordion (multi-account view) ───────────────────────────

function CollapsiblePair({
  overlap,
  defaultOpen,
  onDrillDown,
}: {
  overlap: PairwiseOverlap;
  defaultOpen?: boolean;
  onDrillDown: (overlapId: string, type: 'followers' | 'engagement') => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const name1 = overlap.account1.displayName || overlap.account1.handle;
  const name2 = overlap.account2.displayName || overlap.account2.handle;
  const folInterp = getInterpretation(overlap.followerJaccard);

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        marginBottom: 10,
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '15px 20px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 14,
              color: 'var(--color-navy)',
            }}
          >
            {name1}{' '}
            <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>×</span>{' '}
            {name2}
          </span>
          <OverlapBadge label={folInterp.label} />
        </div>
        <span
          style={{
            color: 'var(--color-text-faint)',
            fontSize: 11,
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 0.15s',
            display: 'inline-block',
          }}
        >
          ▼
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px' }}>
          <PairVennHeader data={pairToOverlapData(overlap, 'followers')} />
          <PairOverlapCards overlap={overlap} onDrillDown={onDrillDown} />
        </div>
      )}
    </div>
  );
}

// ── Insights ───────────────────────────────────────────────────────────────────

function generateInsights(overlaps: PairwiseOverlap[]): string[] {
  const insights: string[] = [];

  // ── Identify unique creator roles across all pairs ──
  // Collect stats to assign each creator a distinctive strength
  const creatorStats = new Map<string, {
    name: string;
    followers: number;
    engagementRate: number;
    uniqueReach: number;
  }>();

  for (const o of overlaps) {
    for (const [acct, followers, engaged, unique] of [
      [o.account1, o.followers1, o.engaged1, o.uniqueFollowers1] as const,
      [o.account2, o.followers2, o.engaged2, o.uniqueFollowers2] as const,
    ]) {
      const name = acct.displayName || acct.handle;
      const existing = creatorStats.get(acct.did);
      const engRate = followers > 0 ? (engaged / followers) * 100 : 0;
      if (!existing || followers > existing.followers) {
        creatorStats.set(acct.did, { name, followers, engagementRate: engRate, uniqueReach: unique });
      }
    }
  }

  // Assign roles based on standout strengths
  const creators = Array.from(creatorStats.values());
  if (creators.length >= 2) {
    const byFollowers = [...creators].sort((a, b) => b.followers - a.followers);
    const byEngagement = [...creators].sort((a, b) => b.engagementRate - a.engagementRate);
    const byUnique = [...creators].sort((a, b) => b.uniqueReach - a.uniqueReach);

    const roleLines: string[] = [];
    const assigned = new Set<string>();

    // Biggest audience
    if (!assigned.has(byFollowers[0].name)) {
      roleLines.push(`${byFollowers[0].name} brings the largest reach — their audience is the foundation any collaboration builds on.`);
      assigned.add(byFollowers[0].name);
    }
    // Highest engagement rate
    if (!assigned.has(byEngagement[0].name)) {
      roleLines.push(`${byEngagement[0].name} has the strongest engagement — their audience doesn't just follow, they show up and interact.`);
      assigned.add(byEngagement[0].name);
    }
    // Most unique followers
    if (!assigned.has(byUnique[0].name)) {
      roleLines.push(`${byUnique[0].name} opens doors to the most untapped audience — followers the others can't reach on their own.`);
      assigned.add(byUnique[0].name);
    }
    // Anyone left gets a role too
    for (const c of creators) {
      if (!assigned.has(c.name)) {
        roleLines.push(`${c.name} adds depth and diversity to the mix — a voice that rounds out the group.`);
        assigned.add(c.name);
      }
    }

    if (roleLines.length > 0) {
      insights.push(roleLines.join(' '));
    }
  }

  for (const o of overlaps) {
    const a1 = o.account1.displayName || o.account1.handle;
    const a2 = o.account2.displayName || o.account2.handle;
    const fj = o.followerJaccard;
    const ej = o.engagementJaccard;

    // ── Partnership potential based on overlap level ──
    if (fj > 40) {
      insights.push(
        `${a1} and ${a2} are practically family — their audiences already trust both names. A collab here is less about discovery and more about doubling down: joint endorsements, shared projects, and going deeper together. The crowd is already cheering for both of you.`
      );
    } else if (fj > 20) {
      insights.push(
        `${a1} and ${a2} have a great thing going — strong crossover means your shared fans will amplify anything you create together. That built-in audience is your launchpad. Plus, there's still plenty of fresh audience on each side to grow into.`
      );
    } else if (fj > 10) {
      insights.push(
        `This is a really exciting match. ${a1} and ${a2} overlap just enough to have natural credibility together, but most of each other's audience is brand new territory. The shared followers give you social proof, the unique ones give you growth. Best of both worlds.`
      );
    } else if (fj > 3) {
      insights.push(
        `${a1} and ${a2} are mostly reaching different people — and that's actually a great thing for growth. The small bridge of shared followers can spark the connection, while the vast unique audiences on both sides mean real discovery potential.`
      );
    } else {
      insights.push(
        `${a1} and ${a2} have almost zero audience overlap — every follower one introduces to the other is genuinely new. This is a bold discovery play. If the content fits, the growth ceiling here is huge.`
      );
    }

    // ── Engagement vs follower divergence ──
    if (ej > fj + 8 && ej > 5) {
      insights.push(
        `Here's something exciting: the engagement overlap between ${a1} and ${a2} is even higher than the follower overlap. That means people who actively engage with both creators share real taste and interest — a collab here is likely to land well with the audiences that matter most.`
      );
    } else if (fj > ej + 10 && fj > 10) {
      insights.push(
        `Interesting dynamic: ${a1} and ${a2} share plenty of followers, but their engaged audiences are more distinct. These followers appreciate both creators but in different ways. The sweet spot is letting each person lead with their own style — the audience will love the contrast.`
      );
    }

    // ── Asymmetric reach ──
    const pctDiff = Math.abs(o.followerOverlapPct1 - o.followerOverlapPct2);
    if (pctDiff > 15 && fj > 2) {
      const bigger = o.followerOverlapPct1 < o.followerOverlapPct2 ? a1 : a2;
      const smaller = o.followerOverlapPct1 < o.followerOverlapPct2 ? a2 : a1;
      insights.push(
        `${bigger} brings a bigger stage, and ${smaller} brings a focused, engaged community. That's not a mismatch — it's a recipe. ${smaller} gets meaningful exposure, and ${bigger} gets the credibility boost that comes from partnering with someone whose audience truly trusts them.`
      );
    }
  }

  return insights;
}

function InsightsPanel({ overlaps }: { overlaps: PairwiseOverlap[] }) {
  const insights = generateInsights(overlaps);

  if (insights.length === 0) return null;

  return (
    <div className="insights-card">
      <h3>Insights</h3>
      <ul>
        {insights.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Creator card ───────────────────────────────────────────────────────────────

function CreatorCard({ profile }: { profile: BskyProfile }) {
  return (
    <div className="account-card">
      <div className="account-name">{profile.displayName || profile.handle}</div>
      <div className="account-handle">@{profile.handle}</div>
      {profile.followersCount != null && (
        <>
          <div className="account-followers">{formatFollowers(profile.followersCount)}</div>
          <div className="account-label">Followers</div>
        </>
      )}
    </div>
  );
}

// ── Pair header label ──────────────────────────────────────────────────────────

function PairHeading({ overlap }: { overlap: PairwiseOverlap }) {
  const name1 = overlap.account1.displayName || overlap.account1.handle;
  const name2 = overlap.account2.displayName || overlap.account2.handle;
  return (
    <h2
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 20,
        fontWeight: 700,
        color: 'var(--color-navy)',
        letterSpacing: '-0.01em',
        margin: '0 0 16px',
      }}
    >
      {name1}{' '}
      <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>×</span>{' '}
      {name2}
    </h2>
  );
}

// ── Multi-account heading (3-way hero) ─────────────────────────────────────────

function MultiHeading({
  profiles,
  totalAccounts,
}: {
  profiles: BskyProfile[];
  totalAccounts: number;
}) {
  const names = profiles.map((p) => p.displayName || p.handle);
  return (
    <h2
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 20,
        fontWeight: 700,
        color: 'var(--color-navy)',
        letterSpacing: '-0.01em',
        margin: '0 0 4px',
      }}
    >
      {names.map((name, i) => (
        <span key={i}>
          {i > 0 && (
            <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}> × </span>
          )}
          {name}
        </span>
      ))}
    </h2>
  );
}

// ── Three-way overlap hero cards (Venn visualization) ─────────────────────────

function ThreeWayOverlapCards({
  threeWay,
  totalAccounts,
  pairwiseOverlaps,
  onDrillDown,
}: {
  threeWay: ThreeWayOverlap;
  totalAccounts: number;
  pairwiseOverlaps: PairwiseOverlap[];
  onDrillDown: (id: string, type: 'followers' | 'engagement') => void;
}) {
  const followerVennData = threeWayToOverlapData(threeWay, pairwiseOverlaps, 'followers');
  const engagementVennData = threeWayToOverlapData(threeWay, pairwiseOverlaps, 'engagement');

  return (
    <div style={{ marginBottom: 24 }}>
      <MultiHeading profiles={threeWay.profiles} totalAccounts={totalAccounts} />
      {totalAccounts > 3 && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-faint)',
            marginBottom: 14,
            fontStyle: 'italic',
          }}
        >
          Showing 3-way overlap for the first 3 accounts
        </div>
      )}
      {totalAccounts === 3 && <div style={{ marginBottom: 14 }} />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <VennCard
          data={followerVennData}
          label="Follower Overlap"
          sharedCount={threeWay.follower}
          jaccard={threeWay.followerJaccard}
          sharedLabel="shared followers"
          onDrillDown={() => onDrillDown('three-way', 'followers')}
        />
        <VennCard
          data={engagementVennData}
          label="Engagement Overlap"
          sharedCount={threeWay.engagement}
          jaccard={threeWay.engagementJaccard}
          sharedLabel="shared engagers"
          onDrillDown={() => onDrillDown('three-way', 'engagement')}
        />
      </div>
    </div>
  );
}

// ── Share button ───────────────────────────────────────────────────────────────

function ShareButton({ result }: { result: AnalysisResult }) {
  const [state, setState] = useState<'idle' | 'saving' | 'copied' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const handleShare = async () => {
    if (state === 'saving') return;

    // If we already have a URL, just copy it again
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
      return;
    }

    setState('saving');
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });

      if (!res.ok) {
        throw new Error('Failed to save report');
      }

      const { url } = (await res.json()) as { id: string; url: string };
      setShareUrl(url);
      await navigator.clipboard.writeText(url);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const label =
    state === 'saving' ? 'Saving...' :
    state === 'copied' ? 'Link copied!' :
    state === 'error' ? 'Failed — try again' :
    shareUrl ? 'Copy link' : 'Share report';

  return (
    <button
      onClick={handleShare}
      disabled={state === 'saving'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 14px',
        border: '1px solid var(--color-border)',
        borderRadius: 5,
        background: state === 'copied' ? '#e8f5e9' : '#fff',
        color: state === 'copied' ? '#2e7d32' : state === 'error' ? '#c62828' : 'var(--color-navy)',
        fontSize: 13,
        fontWeight: 500,
        cursor: state === 'saving' ? 'wait' : 'pointer',
        transition: 'background 0.15s, color 0.15s',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <span style={{ fontSize: 14 }}>
        {state === 'copied' ? '✓' : state === 'error' ? '✕' : '↗'}
      </span>
      {label}
    </button>
  );
}

// ── Main results section ───────────────────────────────────────────────────────

export default function ResultsSection({ result, mode = 'live' }: Props) {
  const { profiles, pairwiseOverlaps, threeWayOverlap, overlapDetails } = result;

  const [modalState, setModalState] = useState<{
    overlapId: string;
    type: 'followers' | 'engagement';
    dids: string[];
  } | null>(null);

  const handleDrillDown = (overlapId: string, type: 'followers' | 'engagement') => {
    const detail = overlapDetails?.[overlapId];
    const dids =
      type === 'followers' ? (detail?.followerDids ?? []) : (detail?.engagementDids ?? []);
    setModalState({ overlapId, type, dids });
  };

  const isSinglePair = profiles.length === 2;
  const isMulti = profiles.length >= 3;

  // Sort pairs by follower Jaccard descending (done once, stable)
  const sortedPairs = [...pairwiseOverlaps].sort((a, b) => b.followerJaccard - a.followerJaccard);

  return (
    <div>

      {/* ── Two-account view: direct overlap cards ─────────────────────────── */}
      {isSinglePair && pairwiseOverlaps.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <PairHeading overlap={pairwiseOverlaps[0]} />
          <PairOverlapCards
            overlap={pairwiseOverlaps[0]}
            onDrillDown={handleDrillDown}
          />
        </div>
      )}

      {/* ── Multi-account hero: three-way (or N-way capped at 3) overlap ─────── */}
      {isMulti && threeWayOverlap && (
        <ThreeWayOverlapCards
          threeWay={threeWayOverlap}
          totalAccounts={profiles.length}
          pairwiseOverlaps={pairwiseOverlaps}
          onDrillDown={handleDrillDown}
        />
      )}

      {/* ── Multi-account: collapsible pair combinations ─────────────────────── */}
      {isMulti && sortedPairs.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-label" style={{ marginBottom: 12 }}>
            Pair Combinations
          </div>
          {sortedPairs.map((o, i) => (
            <CollapsiblePair
              key={o.id}
              overlap={o}
              defaultOpen={i === 0}
              onDrillDown={handleDrillDown}
            />
          ))}
        </div>
      )}

      {/* ── Insights ────────────────────────────────────────────────────────── */}
      <InsightsPanel overlaps={pairwiseOverlaps} />

      {/* ── Share button ──────────────────────────────────────────────────── */}
      {mode === 'live' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
          <ShareButton result={result} />
        </div>
      )}

      {/* ── Creator cards ─────────────────────────────────────────────────── */}
      <div>
        <div className="section-label" style={{ marginBottom: 12 }}>Creators</div>
        <div className="account-grid">
          {profiles.map((p) => (
            <CreatorCard key={p.did} profile={p} />
          ))}
        </div>
      </div>

      {/* ── Overlap detail modal ─────────────────────────────────────────────── */}
      {modalState && (
        <OverlapDetailModal
          overlapId={modalState.overlapId}
          type={modalState.type}
          dids={modalState.dids}
          pairwiseOverlaps={pairwiseOverlaps}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}
