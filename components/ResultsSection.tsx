'use client';

import { useState } from 'react';
import type { AnalysisResult, BskyProfile, PairwiseOverlap, ThreeWayOverlap } from '@/lib/types';
import { getInterpretation, formatFollowers } from '@/lib/analysis/interpret';
import OverlapDetailModal from './OverlapDetailModal';

interface Props {
  result: AnalysisResult;
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
}: {
  type: 'followers' | 'engagement';
  sharedCount: number;
  jaccard: number;
  profiles: BskyProfile[];
  sharedPcts: number[];
  uniquePcts: number[];
  onDrillDown: () => void;
}) {
  const interp = getInterpretation(jaccard);
  const sectionLabel = type === 'followers' ? 'Follower Overlap' : 'Engagement Overlap';
  const sharedLabel = type === 'followers' ? 'shared followers' : 'shared engagers';

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
          <PairOverlapCards overlap={overlap} onDrillDown={onDrillDown} />
        </div>
      )}
    </div>
  );
}

// ── Insights ───────────────────────────────────────────────────────────────────

function InsightsPanel({ overlaps }: { overlaps: PairwiseOverlap[] }) {
  const insights: string[] = [];

  for (const o of overlaps) {
    const j = o.followerJaccard;
    const a1 = o.account1.displayName || o.account1.handle;
    const a2 = o.account2.displayName || o.account2.handle;

    if (j > 40) {
      insights.push(
        `${a1} and ${a2} share a very high audience overlap — they're essentially speaking to the same crowd. A collaboration would deepen existing relationships rather than expand reach.`
      );
    } else if (j > 20) {
      insights.push(
        `${a1} and ${a2} have significant audience crossover. Collaboration would reinforce credibility with a familiar audience while adding value to the overlap.`
      );
    } else if (j > 10) {
      insights.push(
        `${a1} and ${a2} share a moderate audience. A collaboration offers meaningful new reach for both sides.`
      );
    } else if (j > 3) {
      insights.push(
        `${a1} and ${a2} have low audience overlap — a collaboration here is a strong reach expansion play.`
      );
    } else {
      insights.push(
        `${a1} and ${a2} have almost no audience overlap. If the content is complementary, this is a powerful new-audience opportunity.`
      );
    }
  }

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

// ── Three-way overlap hero cards ───────────────────────────────────────────────

function ThreeWayOverlapCards({
  threeWay,
  totalAccounts,
  onDrillDown,
}: {
  threeWay: ThreeWayOverlap;
  totalAccounts: number;
  onDrillDown: (id: string, type: 'followers' | 'engagement') => void;
}) {
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
        <OverlapCard
          type="followers"
          sharedCount={threeWay.follower}
          jaccard={threeWay.followerJaccard}
          profiles={threeWay.profiles}
          sharedPcts={threeWay.followerPcts}
          uniquePcts={threeWay.followerPcts.map((p) => 100 - p)}
          onDrillDown={() => onDrillDown('three-way', 'followers')}
        />
        <OverlapCard
          type="engagement"
          sharedCount={threeWay.engagement}
          jaccard={threeWay.engagementJaccard}
          profiles={threeWay.profiles}
          sharedPcts={threeWay.engagementPcts}
          uniquePcts={threeWay.engagementPcts.map((p) => 100 - p)}
          onDrillDown={() => onDrillDown('three-way', 'engagement')}
        />
      </div>
    </div>
  );
}

// ── Main results section ───────────────────────────────────────────────────────

export default function ResultsSection({ result }: Props) {
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
