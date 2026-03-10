'use client';

import { useState } from 'react';
import type { AnalysisResult, BskyProfile, PairwiseOverlap } from '@/lib/types';
import { getInterpretation, formatFollowers } from '@/lib/analysis/interpret';
import HeatmapMatrix from './HeatmapMatrix';
import OverlapDetailModal from './OverlapDetailModal';

interface Props {
  result: AnalysisResult;
}

// ── Account card ───────────────────────────────────────────────────────────────

function AccountCard({ profile }: { profile: BskyProfile }) {
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

// ── Comparison card ─────────────────────────────────────────────────────────────

function ComparisonCard({
  overlap,
  onDrillDown,
}: {
  overlap: PairwiseOverlap;
  onDrillDown: (overlapId: string, type: 'followers' | 'engagement') => void;
}) {
  const folInterp = getInterpretation(overlap.followerJaccard);
  const engInterp = getInterpretation(overlap.engagementJaccard);
  const name1 = overlap.account1.displayName || overlap.account1.handle;
  const name2 = overlap.account2.displayName || overlap.account2.handle;

  return (
    <div className="comparison">
      <h3>
        {name1}{' '}
        <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>↔</span>{' '}
        {name2}
      </h3>

      {/* ── Follower overlap ── */}
      <div className="section-label">Follower Overlap</div>
      <div className="metrics-grid">
        <div>
          <div className="metric-label">Shared Followers</div>
          <div className="metric-value">{overlap.followerOverlap.toLocaleString()}</div>
        </div>
        <div>
          <div className="metric-label">Audience Similarity</div>
          <div className="metric-value" style={{ color: folInterp.color }}>
            {overlap.followerJaccard.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="metric-label">Interpretation</div>
          <div className="metric-value" style={{ fontSize: 18, color: folInterp.color }}>
            {folInterp.label}
          </div>
        </div>
      </div>

      <div className="breakdown-grid">
        <div className="breakdown-card">
          <div className="breakdown-title">{name1}</div>
          <div className="breakdown-stat">
            Unique: {overlap.uniqueFollowers1.toLocaleString()} ({((overlap.uniqueFollowers1 / (overlap.followers1 || 1)) * 100).toFixed(1)}%)
          </div>
          <div className="breakdown-stat">
            Shared: {overlap.followerOverlap.toLocaleString()} ({overlap.followerOverlapPct1.toFixed(1)}%)
          </div>
        </div>
        <div className="breakdown-card">
          <div className="breakdown-title">{name2}</div>
          <div className="breakdown-stat">
            Unique: {overlap.uniqueFollowers2.toLocaleString()} ({((overlap.uniqueFollowers2 / (overlap.followers2 || 1)) * 100).toFixed(1)}%)
          </div>
          <div className="breakdown-stat">
            Shared: {overlap.followerOverlap.toLocaleString()} ({overlap.followerOverlapPct2.toFixed(1)}%)
          </div>
        </div>
      </div>

      <hr className="divider" />

      {/* ── Engagement overlap ── */}
      <div className="section-label">Engagement Overlap</div>
      <div className="metrics-grid">
        <div>
          <div className="metric-label">Shared Engagers</div>
          <div className="metric-value">{overlap.engagementOverlap.toLocaleString()}</div>
        </div>
        <div>
          <div className="metric-label">Engagement Similarity</div>
          <div className="metric-value" style={{ color: engInterp.color }}>
            {overlap.engagementJaccard.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="metric-label">Interpretation</div>
          <div className="metric-value" style={{ fontSize: 18, color: engInterp.color }}>
            {engInterp.label}
          </div>
        </div>
      </div>

      {/* ── Drill-down links ── */}
      <div style={{ display: 'flex', gap: 24, marginTop: 4 }}>
        <button
          onClick={() => onDrillDown(overlap.id, 'followers')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-blue)',
            fontSize: 13,
            fontWeight: 500,
            padding: 0,
            fontFamily: 'var(--font-sans)',
          }}
        >
          See shared followers →
        </button>
        <button
          onClick={() => onDrillDown(overlap.id, 'engagement')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-blue)',
            fontSize: 13,
            fontWeight: 500,
            padding: 0,
            fontFamily: 'var(--font-sans)',
          }}
        >
          See shared engagers →
        </button>
      </div>
    </div>
  );
}

// ── Three-way card ─────────────────────────────────────────────────────────────

function ThreeWayCard({
  count,
  label,
  profiles,
}: {
  count: number;
  label: string;
  profiles: BskyProfile[];
}) {
  const names = profiles.map((p) => p.displayName || p.handle).join(', ');
  return (
    <div className="comparison" style={{ textAlign: 'center' }}>
      <div className="section-label" style={{ marginBottom: 12 }}>
        Three-Way {label} Overlap
      </div>
      <div
        style={{
          fontSize: 48,
          fontWeight: 400,
          color: 'var(--color-blue)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '-0.02em',
          lineHeight: 1,
          marginBottom: 8,
        }}
      >
        {count.toLocaleString()}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        {names} — shared {label.toLowerCase()} audience
      </div>
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

// ── Main results section ───────────────────────────────────────────────────────

export default function ResultsSection({ result }: Props) {
  const { profiles, pairwiseOverlaps, threeWayOverlap } = result;

  const [modalState, setModalState] = useState<{
    overlapId: string;
    type: 'followers' | 'engagement';
  } | null>(null);

  return (
    <div>
      {/* Account grid */}
      <div className="account-grid">
        {profiles.map((p) => (
          <AccountCard key={p.did} profile={p} />
        ))}
      </div>

      {/* Heatmap for >3 accounts, comparison cards for ≤3 */}
      {profiles.length > 3 ? (
        <div>
          <div className="section-label">Audience Overlap Matrix</div>
          <div className="card" style={{ padding: 24 }}>
            <HeatmapMatrix profiles={profiles} pairwiseOverlaps={pairwiseOverlaps} />
          </div>
          <div className="section-label" style={{ marginTop: 8 }}>Top Pairs</div>
          {[...pairwiseOverlaps]
            .sort((a, b) => b.followerJaccard - a.followerJaccard)
            .slice(0, 5)
            .map((o) => (
              <ComparisonCard
                key={o.id}
                overlap={o}
                onDrillDown={(id, type) => setModalState({ overlapId: id, type })}
              />
            ))}
        </div>
      ) : (
        pairwiseOverlaps.map((o) => (
          <ComparisonCard
            key={o.id}
            overlap={o}
            onDrillDown={(id, type) => setModalState({ overlapId: id, type })}
          />
        ))
      )}

      {/* Three-way overlap */}
      {threeWayOverlap && profiles.length === 3 && (
        <>
          {threeWayOverlap.follower > 0 && (
            <ThreeWayCard count={threeWayOverlap.follower} label="Follower" profiles={profiles} />
          )}
          {threeWayOverlap.engagement > 0 && (
            <ThreeWayCard count={threeWayOverlap.engagement} label="Engagement" profiles={profiles} />
          )}
        </>
      )}

      {/* Insights */}
      <InsightsPanel overlaps={pairwiseOverlaps} />

      {/* Overlap detail modal */}
      {modalState && (
        <OverlapDetailModal
          overlapId={modalState.overlapId}
          type={modalState.type}
          pairwiseOverlaps={pairwiseOverlaps}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}
