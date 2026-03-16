'use client';

import { useState } from 'react';
import type { AnalysisResult, BskyProfile, PairwiseOverlap, ThreeWayOverlap } from '@/lib/types';
import { getInterpretation, formatFollowers } from '@/lib/analysis/interpret';
import OverlapDetailModal from './OverlapDetailModal';
import { VennCard, PairVennHeader, CollaborationRead, threeWayToOverlapData, pairToOverlapData, ACCOUNT_COLORS } from './CollaborationVenn';
import type { OverlapData } from './CollaborationVenn';

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

// ── Overlap card (legacy, for non-Venn views) ─────────────────────────────────

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

// ── Venn mode toggle (Followers / Engagers) ───────────────────────────────────

function VennModeToggle({
  mode,
  onToggle,
}: {
  mode: 'followers' | 'engagement';
  onToggle: (m: 'followers' | 'engagement') => void;
}) {
  return (
    <div style={{
      display: 'inline-flex',
      gap: 2,
      marginBottom: 14,
      background: 'rgba(4,24,43,0.06)',
      borderRadius: 6,
      padding: 3,
    }}>
      {(['followers', 'engagement'] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            onClick={() => onToggle(m)}
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              background: active ? '#04182B' : 'transparent',
              color: active ? '#fff' : 'var(--color-text-muted)',
              transition: 'all 0.2s ease',
            }}
          >
            {m === 'followers' ? 'Followers' : 'Engagers'}
          </button>
        );
      })}
    </div>
  );
}

// ── Single Venn card for one pair (with mode toggle) ──────────────────────────

function PairOverlapCards({
  overlap,
  onDrillDown,
  useVenn = true,
  mode,
}: {
  overlap: PairwiseOverlap;
  onDrillDown: (overlapId: string, type: 'followers' | 'engagement') => void;
  useVenn?: boolean;
  mode: 'followers' | 'engagement';
}) {
  const profiles = [overlap.account1, overlap.account2];
  const isEstimatedFollowers = overlap.isEstimated;

  if (useVenn) {
    const data = pairToOverlapData(overlap, mode);
    const isFollowers = mode === 'followers';
    const label = isFollowers
      ? (isEstimatedFollowers ? 'Minimum Follower Overlap' : 'Follower Overlap')
      : 'Engagement Overlap';
    const sharedCount = isFollowers ? overlap.followerOverlap : overlap.engagementOverlap;
    const jaccard = isFollowers ? overlap.followerJaccard : overlap.engagementJaccard;
    const sharedLabel = isFollowers
      ? (isEstimatedFollowers ? 'min. shared followers (est.)' : 'shared followers')
      : 'shared engagers';

    return (
      <div key={mode} className="venn-animate-in">
        <VennCard
          data={data}
          label={label}
          sharedCount={sharedCount}
          jaccard={jaccard}
          sharedLabel={sharedLabel}
          onDrillDown={() => onDrillDown(overlap.id, mode)}
        />
      </div>
    );
  }

  // Fallback: non-Venn cards (for >3 accounts)
  const isFollowers = mode === 'followers';
  return (
    <div key={mode} className="venn-animate-in">
      {isFollowers ? (
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
      ) : (
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
      )}
    </div>
  );
}

// ── Pairwise card (compact, for multi-account grid) ───────────────────────────

function PairCard({
  overlap,
  rank,
  totalPairs,
  profiles,
  mode,
  onSelect,
}: {
  overlap: PairwiseOverlap;
  rank: number;
  totalPairs: number;
  profiles: BskyProfile[];
  mode: 'followers' | 'engagement';
  onSelect: () => void;
}) {
  const name1 = overlap.account1.displayName || overlap.account1.handle;
  const name2 = overlap.account2.displayName || overlap.account2.handle;
  const pct = mode === 'followers' ? overlap.followerJaccard : overlap.engagementJaccard;
  const showTags = totalPairs >= 3;
  const isWarmest = showTags && rank === 0;
  const isFreshest = showTags && rank === totalPairs - 1;

  // Gradient colors from account indices
  const idx1 = profiles.findIndex(p => p.did === overlap.account1.did);
  const idx2 = profiles.findIndex(p => p.did === overlap.account2.did);
  const color1 = ACCOUNT_COLORS[idx1] ?? ACCOUNT_COLORS[0];
  const color2 = ACCOUNT_COLORS[idx2] ?? ACCOUNT_COLORS[1];

  return (
    <div
      onClick={onSelect}
      style={{
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: '18px 20px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-blue)';
        e.currentTarget.style.boxShadow = '0 2px 12px rgba(4,24,43,0.08)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Pair names */}
      <div style={{
        fontFamily: 'var(--font-sans)',
        fontWeight: 600,
        fontSize: 14,
        color: 'var(--color-navy)',
        marginBottom: 12,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {name1}{' '}
        <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>×</span>{' '}
        {name2}
      </div>

      {/* Progress bar + percentage */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          flex: 1, height: 8, borderRadius: 4,
          background: 'rgba(4, 24, 43, 0.2)',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${Math.min(pct, 100)}%`,
            height: '100%',
            borderRadius: 4,
            background: `linear-gradient(to right, ${color1}, ${color2})`,
            transition: 'width 0.3s ease',
          }} />
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text-muted)',
          flexShrink: 0,
          minWidth: 45,
          textAlign: 'right',
        }}>
          {pct.toFixed(1)}%
        </span>
      </div>

      {/* Tags */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {isWarmest && (
          <span style={{
            fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
            color: '#b45309', background: '#FEF3C7', padding: '2px 6px', borderRadius: 3,
          }}>
            warmest audience
          </span>
        )}
        {isFreshest && (
          <span style={{
            fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
            color: '#047857', background: '#D1FAE5', padding: '2px 6px', borderRadius: 3,
          }}>
            most fresh reach
          </span>
        )}
      </div>
    </div>
  );
}

// ── Analysis → OverlapData adapter (for CollaborationRead) ────────────────────

function analysisToOverlapData(result: AnalysisResult): OverlapData {
  const accounts = result.profiles.map(p => ({
    handle: p.handle,
    displayName: p.displayName || p.handle,
    followerCount: p.followersCount ?? 0,
  }));

  const pairwiseOverlap = result.pairwiseOverlaps.map(po => ({
    handleA: po.account1.handle,
    handleB: po.account2.handle,
    sharedFollowers: po.followerOverlap,
    jaccardSimilarity: po.followerJaccard / 100,
  }));

  const totalFollowers = accounts.reduce((s, a) => s + a.followerCount, 0);
  const totalOverlap = result.pairwiseOverlaps.reduce((s, po) => s + po.followerOverlap, 0);
  const uniqueReach = totalFollowers - totalOverlap + (result.threeWayOverlap?.follower ?? 0);

  // Compute median new audience
  const uniqueCounts: number[] = [];
  for (const po of result.pairwiseOverlaps) {
    uniqueCounts.push(po.uniqueFollowers1, po.uniqueFollowers2);
  }
  uniqueCounts.sort((a, b) => a - b);
  const medianNewAudience = uniqueCounts.length > 0
    ? uniqueCounts.length % 2 === 1
      ? uniqueCounts[Math.floor(uniqueCounts.length / 2)]
      : Math.round((uniqueCounts[uniqueCounts.length / 2 - 1] + uniqueCounts[uniqueCounts.length / 2]) / 2)
    : 0;

  return {
    accounts,
    pairwiseOverlap,
    tripleOverlap: result.threeWayOverlap?.follower,
    uniqueReach,
    totalFollowers,
    homogeneityScore: totalFollowers > 0 ? 1 - (uniqueReach / totalFollowers) : 0,
    medianNewAudience,
  };
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

// ── Three-way overlap hero (single Venn with toggle) ──────────────────────────

function ThreeWayOverlapCards({
  threeWay,
  totalAccounts,
  pairwiseOverlaps,
  onDrillDown,
  mode,
}: {
  threeWay: ThreeWayOverlap;
  totalAccounts: number;
  pairwiseOverlaps: PairwiseOverlap[];
  onDrillDown: (id: string, type: 'followers' | 'engagement') => void;
  mode: 'followers' | 'engagement';
}) {
  const vennData = mode === 'followers'
    ? threeWayToOverlapData(threeWay, pairwiseOverlaps, 'followers')
    : threeWayToOverlapData(threeWay, pairwiseOverlaps, 'engagement');

  const isFollowers = mode === 'followers';
  const label = isFollowers ? 'Follower Overlap' : 'Engagement Overlap';
  const sharedCount = isFollowers ? threeWay.follower : threeWay.engagement;
  const jaccard = isFollowers ? threeWay.followerJaccard : threeWay.engagementJaccard;
  const sharedLabel = isFollowers ? 'shared followers' : 'shared engagers';

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
      <div key={mode} className="venn-animate-in">
        <VennCard
          data={vennData}
          label={label}
          sharedCount={sharedCount}
          jaccard={jaccard}
          sharedLabel={sharedLabel}
          onDrillDown={() => onDrillDown('three-way', mode)}
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

// ── Pair detail modal (shown when clicking a pair card) ───────────────────────

function PairDetailModal({
  overlap,
  onDrillDown,
  onClose,
  mode,
}: {
  overlap: PairwiseOverlap;
  onDrillDown: (overlapId: string, type: 'followers' | 'engagement') => void;
  onClose: () => void;
  mode: 'followers' | 'engagement';
}) {
  const name1 = overlap.account1.displayName || overlap.account1.handle;
  const name2 = overlap.account2.displayName || overlap.account2.handle;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-box"
        style={{ maxWidth: 560, padding: '28px 24px', overflow: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20,
        }}>
          <h3 style={{
            fontFamily: 'var(--font-sans)', fontSize: 18, fontWeight: 700,
            color: 'var(--color-navy)', margin: 0,
          }}>
            {name1}{' '}
            <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>×</span>{' '}
            {name2}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 18, color: 'var(--color-text-faint)', padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>
        <PairOverlapCards
          overlap={overlap}
          onDrillDown={onDrillDown}
          useVenn
          mode={mode}
        />
      </div>
    </div>
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

  // Lifted toggle state: controls hero Venn AND pair cards
  const [vennMode, setVennMode] = useState<'followers' | 'engagement'>('followers');

  // Selected pair for detail modal (multi-account grid)
  const [selectedPair, setSelectedPair] = useState<PairwiseOverlap | null>(null);

  const handleDrillDown = (overlapId: string, type: 'followers' | 'engagement') => {
    const detail = overlapDetails?.[overlapId];
    const dids =
      type === 'followers' ? (detail?.followerDids ?? []) : (detail?.engagementDids ?? []);
    setModalState({ overlapId, type, dids });
  };

  const isSinglePair = profiles.length === 2;
  const isMulti = profiles.length >= 3;
  const useVenn = profiles.length <= 3;

  // Sort pairs by follower Jaccard descending (done once, stable)
  const sortedPairs = [...pairwiseOverlaps].sort((a, b) => {
    const aVal = vennMode === 'followers' ? b.followerJaccard : b.engagementJaccard;
    const bVal = vennMode === 'followers' ? a.followerJaccard : a.engagementJaccard;
    return aVal - bVal;
  });

  return (
    <div>

      {/* ── Toggle (shown for all views) ──────────────────────────────────── */}
      <VennModeToggle mode={vennMode} onToggle={setVennMode} />

      {/* ── Two-account view: single Venn card ──────────────────────────── */}
      {isSinglePair && pairwiseOverlaps.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <PairHeading overlap={pairwiseOverlaps[0]} />
          <PairOverlapCards
            overlap={pairwiseOverlaps[0]}
            onDrillDown={handleDrillDown}
            useVenn={useVenn}
            mode={vennMode}
          />
        </div>
      )}

      {/* ── Multi-account hero: three-way (or N-way capped at 3) overlap ── */}
      {isMulti && threeWayOverlap && (
        <ThreeWayOverlapCards
          threeWay={threeWayOverlap}
          totalAccounts={profiles.length}
          pairwiseOverlaps={pairwiseOverlaps}
          onDrillDown={handleDrillDown}
          mode={vennMode}
        />
      )}

      {/* ── Multi-account: pair card grid ──────────────────────────────── */}
      {isMulti && sortedPairs.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-label" style={{ marginBottom: 12 }}>
            Pair Combinations
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 16,
          }}>
            {sortedPairs.map((o, i) => (
              <PairCard
                key={o.id}
                overlap={o}
                rank={i}
                totalPairs={sortedPairs.length}
                profiles={profiles}
                mode={vennMode}
                onSelect={() => setSelectedPair(o)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Collaboration read ──────────────────────────────────────────── */}
      <CollaborationRead data={analysisToOverlapData(result)} />

      {/* ── Share button ──────────────────────────────────────────────── */}
      {mode === 'live' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 24 }}>
          <ShareButton result={result} />
        </div>
      )}

      {/* ── Creator cards ─────────────────────────────────────────────── */}
      <div>
        <div className="section-label" style={{ marginBottom: 12 }}>Creators</div>
        <div className="account-grid">
          {profiles.map((p) => (
            <CreatorCard key={p.did} profile={p} />
          ))}
        </div>
      </div>

      {/* ── Pair detail modal (from card grid click) ──────────────────── */}
      {selectedPair && (
        <PairDetailModal
          overlap={selectedPair}
          onDrillDown={handleDrillDown}
          onClose={() => setSelectedPair(null)}
          mode={vennMode}
        />
      )}

      {/* ── Overlap detail modal ─────────────────────────────────────── */}
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
