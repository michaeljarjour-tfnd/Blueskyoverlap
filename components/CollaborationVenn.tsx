'use client';

import React, { useMemo, useState } from 'react';

// ── Data shape ──────────────────────────────────────────────────────────────────

export type OverlapData = {
  accounts: {
    handle: string;
    displayName: string;
    followerCount: number;
  }[];
  pairwiseOverlap: {
    handleA: string;
    handleB: string;
    sharedFollowers: number;
    jaccardSimilarity: number; // 0–1
  }[];
  tripleOverlap?: number;
  uniqueReach: number;
  totalFollowers: number;
  homogeneityScore: number; // 0–1
  medianNewAudience?: number;
  /** Optional per-account color indices into ACCOUNT_COLORS (for pair Venns in multi-account views) */
  colorIndices?: number[];
};

// ── Constants ───────────────────────────────────────────────────────────────────

export const ACCOUNT_COLORS = ['#FF007B', '#00DDFF', '#009DFF', '#FF0004', '#00FF9D'];
const SVG_W = 680;
const VENN_W = 440; // narrower to leave room for legend
const SVG_PAD = 40;
const MIN_RADIUS = 38;
const MAX_RADIUS = 130;

// ── Helpers ─────────────────────────────────────────────────────────────────────

export function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

function homogeneityLabel(score: number): string {
  if (score >= 0.7) return 'high overlap';
  if (score >= 0.4) return 'moderate overlap';
  if (score >= 0.15) return 'low overlap';
  return 'minimal overlap';
}

/** Intersection area of two circles given radii and center distance */
function circleIntersectionArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d + Math.min(r1, r2) <= Math.max(r1, r2)) {
    return Math.PI * Math.min(r1, r2) ** 2;
  }
  const a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const h = Math.sqrt(r1 * r1 - a * a);
  return r1 * r1 * Math.acos(a / r1) + r2 * r2 * Math.acos((d - a) / r2) - d * h;
}

/** Binary search: find center distance for two circles to produce a target intersection area */
function distanceForOverlap(r1: number, r2: number, targetArea: number): number {
  if (targetArea <= 0) return r1 + r2 + 4;
  const maxArea = Math.PI * Math.min(r1, r2) ** 2;
  if (targetArea >= maxArea) return Math.abs(r1 - r2);

  let lo = Math.abs(r1 - r2);
  let hi = r1 + r2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const area = circleIntersectionArea(r1, r2, mid);
    if (area > targetArea) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── Venn layout solver ──────────────────────────────────────────────────────────

type Circle = { x: number; y: number; r: number; handle: string; color: string };

function solveLayout(data: OverlapData): { circles: Circle[]; svgH: number } {
  const n = data.accounts.length;
  const followerCounts = data.accounts.map(a => a.followerCount);
  const maxFollowers = Math.max(...followerCounts);

  const radii = followerCounts.map(fc => {
    const ratio = maxFollowers > 0 ? fc / maxFollowers : 1;
    const normalized = Math.sqrt(ratio);
    return MIN_RADIUS + normalized * (MAX_RADIUS - MIN_RADIUS);
  });

  const maxR = Math.max(...radii);
  const floorR = maxR * 0.4;
  const clampedRadii = radii.map(r => Math.max(r, floorR));

  const getPairOverlap = (hA: string, hB: string) =>
    data.pairwiseOverlap.find(
      p => (p.handleA === hA && p.handleB === hB) || (p.handleA === hB && p.handleB === hA)
    );

  if (n === 2) {
    const pair = getPairOverlap(data.accounts[0].handle, data.accounts[1].handle);
    const r1 = clampedRadii[0], r2 = clampedRadii[1];
    const shared = pair?.sharedFollowers ?? 0;
    const smallerCount = Math.min(followerCounts[0], followerCounts[1]);
    const overlapFraction = smallerCount > 0 ? Math.min(shared / smallerCount, 1) : 0;
    const smallerArea = Math.PI * Math.min(r1, r2) ** 2;
    const targetArea = overlapFraction * smallerArea;
    const d = distanceForOverlap(r1, r2, targetArea);

    // Scale down if circles extend past available width
    const totalSpan = d + r1 + r2;
    const availW = VENN_W - 2 * SVG_PAD;
    const scale2 = totalSpan > availW ? availW / totalSpan : 1;
    const sr1 = r1 * scale2, sr2 = r2 * scale2, sd = d * scale2;

    const cx = VENN_W / 2;
    const cy = Math.max(sr1, sr2) + SVG_PAD;
    const svgH = cy + Math.max(sr1, sr2) + SVG_PAD;

    return {
      circles: [
        { x: cx - sd / 2, y: cy, r: sr1, handle: data.accounts[0].handle, color: ACCOUNT_COLORS[data.colorIndices?.[0] ?? 0] },
        { x: cx + sd / 2, y: cy, r: sr2, handle: data.accounts[1].handle, color: ACCOUNT_COLORS[data.colorIndices?.[1] ?? 1] },
      ],
      svgH,
    };
  }

  // 3+ accounts: force-directed approach with N-gon initial positions
  const cx = VENN_W / 2;
  const cy0 = SVG_PAD + MAX_RADIUS + 60;
  const startR = Math.min(100, MAX_RADIUS * 0.8);
  const positions: [number, number][] = Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + startR * Math.cos(angle), cy0 + startR * Math.sin(angle)] as [number, number];
  });

  const pairs: { i: number; j: number; targetD: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pair = getPairOverlap(data.accounts[i].handle, data.accounts[j].handle);
      const shared = pair?.sharedFollowers ?? 0;
      const smallerCount = Math.min(followerCounts[i], followerCounts[j]);
      const overlapFraction = smallerCount > 0 ? Math.min(shared / smallerCount, 1) : 0;
      const smallerArea = Math.PI * Math.min(clampedRadii[i], clampedRadii[j]) ** 2;
      const targetArea = overlapFraction * smallerArea;
      const targetD = distanceForOverlap(clampedRadii[i], clampedRadii[j], targetArea);
      pairs.push({ i, j, targetD });
    }
  }

  for (let iter = 0; iter < 200; iter++) {
    const forces: [number, number][] = positions.map(() => [0, 0]);
    const k = 0.05 * Math.max(0.01, 1 - iter / 200);

    for (const { i, j, targetD } of pairs) {
      const dx = positions[j][0] - positions[i][0];
      const dy = positions[j][1] - positions[i][1];
      const currentD = Math.sqrt(dx * dx + dy * dy) || 1;
      const err = currentD - targetD;
      const fx = (dx / currentD) * err * k;
      const fy = (dy / currentD) * err * k;
      forces[i][0] += fx;
      forces[i][1] += fy;
      forces[j][0] -= fx;
      forces[j][1] -= fy;
    }

    for (let i = 0; i < n; i++) {
      positions[i][0] += forces[i][0];
      positions[i][1] += forces[i][1];
    }
  }

  // Center and fit within VENN_W area
  const allX = positions.map((p, i) => [p[0] - clampedRadii[i], p[0] + clampedRadii[i]]).flat();
  const allY = positions.map((p, i) => [p[1] - clampedRadii[i], p[1] + clampedRadii[i]]).flat();
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const availW = VENN_W - 2 * SVG_PAD;
  const availH = 2 * MAX_RADIUS + 2 * SVG_PAD;
  const scale = Math.min(availW / spanX, availH / spanY, 1);
  const offsetX = SVG_PAD + (availW - spanX * scale) / 2 - minX * scale;
  const offsetY = SVG_PAD - minY * scale;

  const circles: Circle[] = data.accounts.map((a, i) => ({
    x: positions[i][0] * scale + offsetX,
    y: positions[i][1] * scale + offsetY,
    r: clampedRadii[i] * scale,
    handle: a.handle,
    color: ACCOUNT_COLORS[data.colorIndices?.[i] ?? i],
  }));

  const maxCy = Math.max(...circles.map(c => c.y + c.r));
  return { circles, svgH: maxCy + SVG_PAD };
}

// ── Venn SVG with legend ────────────────────────────────────────────────────────

export function VennDiagram({ data, countLabel = 'followers' }: { data: OverlapData; countLabel?: string }) {
  const { circles, svgH } = useMemo(() => solveLayout(data), [data]);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [lockedSet, setLockedSet] = useState<Set<number>>(new Set());

  // Active set: locked circles, or just hovered if nothing locked
  const activeSet = useMemo(() => {
    if (lockedSet.size > 0) return lockedSet;
    if (hoveredIdx !== null) return new Set([hoveredIdx]);
    return new Set<number>();
  }, [lockedSet, hoveredIdx]);

  const handleCircleClick = (i: number, e: React.MouseEvent) => {
    if (e.shiftKey) {
      // Shift+click: toggle in/out of selection
      setLockedSet(prev => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        return next;
      });
    } else {
      // Regular click: solo select / deselect
      setLockedSet(prev => prev.size === 1 && prev.has(i) ? new Set() : new Set([i]));
    }
  };

  // Render order: reverse so pink (index 0) paints last = front
  const renderOrder = useMemo(() => {
    const indices = circles.map((_, i) => i);
    return indices.reverse();
  }, [circles]);

  // Legend starts at x = VENN_W, vertically centered
  const legendX = VENN_W + 16;
  const legendItemH = 48;
  const legendTotalH = data.accounts.length * legendItemH;
  const legendStartY = Math.max(SVG_PAD, (svgH - legendTotalH) / 2);

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${svgH}`}
      width="100%"
      style={{ maxWidth: SVG_W, display: 'block', margin: '0 auto' }}
    >
      <defs>
        {/* Outer white glow drop-shadow (no inner shadow) */}
        {circles.map((_, i) => (
          <filter key={`glow-${i}`} id={`venn-glow-${i}`} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
            <feOffset />
            <feGaussianBlur stdDeviation="3.5" />
            <feComposite in2="hardAlpha" operator="out" />
            <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.1 0" />
            <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
            <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
          </filter>
        ))}

        {/* Dimmed filter — same outer glow, used when a circle is selected */}
        {circles.map((_, i) => (
          <filter key={`dim-${i}`} id={`venn-dim-${i}`} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
            <feOffset />
            <feGaussianBlur stdDeviation="3.5" />
            <feComposite in2="hardAlpha" operator="out" />
            <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.1 0" />
            <feBlend mode="normal" in2="BackgroundImageFix" result="shadow" />
            <feBlend mode="normal" in="SourceGraphic" in2="shadow" result="shape" />
          </filter>
        ))}

        {/* Mask for selected circle(s) */}
        {activeSet.size > 0 && (
          <mask id="venn-sel-mask">
            {Array.from(activeSet).map(idx => (
              <circle
                key={`mask-${idx}`}
                cx={circles[idx].x}
                cy={circles[idx].y}
                r={circles[idx].r}
                fill="white"
                stroke="white"
              />
            ))}
          </mask>
        )}
      </defs>

      {activeSet.size === 0 ? (
        /* ── No selection — all circles normal ── */
        renderOrder.map(i => {
          const c = circles[i];
          return (
            <circle
              key={`fill-${i}`}
              cx={c.x} cy={c.y} r={c.r}
              fill={c.color} fillOpacity={0.6}
              stroke={c.color} strokeOpacity={0.6} strokeWidth={1}
              filter={`url(#venn-glow-${i})`}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={(e) => handleCircleClick(i, e)}
            />
          );
        })
      ) : (
        <>
          {/* ── Dimmed layer — all circles faded ── */}
          <g opacity={0.3}>
            {renderOrder.map(i => {
              const c = circles[i];
              return (
                <circle
                  key={`dim-${i}`}
                  cx={c.x} cy={c.y} r={c.r}
                  fill={c.color} fillOpacity={0.6}
                  stroke={c.color} strokeOpacity={0.6} strokeWidth={1}
                  filter={`url(#venn-dim-${i})`}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  onClick={(e) => handleCircleClick(i, e)}
                />
              );
            })}
          </g>

          {/* ── Bright layer — masked to selected circle(s) ── */}
          <g mask="url(#venn-sel-mask)" pointerEvents="none">
            {renderOrder.map(i => {
              const c = circles[i];
              const isSelected = activeSet.has(i);
              return (
                <g key={`bright-${i}`} opacity={isSelected ? 1 : 0.3}>
                  <circle
                    cx={c.x} cy={c.y} r={c.r}
                    fill={c.color} fillOpacity={0.6}
                    stroke={c.color} strokeOpacity={0.6} strokeWidth={1}
                    filter={isSelected ? `url(#venn-glow-${i})` : `url(#venn-dim-${i})`}
                  />
                </g>
              );
            })}
          </g>

          {/* ── Badges — follower count near each selected circle ── */}
          {Array.from(activeSet).map(idx => {
            const c = circles[idx];
            const text = fmt(data.accounts[idx].followerCount);
            const badgeW = Math.max(48, text.length * 9 + 18);
            const badgeX = c.x - badgeW / 2;
            const badgeY = c.y - c.r - 30;
            return (
              <g key={`badge-${idx}`} pointerEvents="none">
                <rect x={badgeX} y={badgeY} width={badgeW} height={25} rx={4} fill="#04182B" />
                <text
                  x={c.x} y={badgeY + 17}
                  textAnchor="middle" fill="white"
                  fontFamily="var(--font-mono)" fontWeight={600} fontSize={13}
                >
                  {text}
                </text>
              </g>
            );
          })}
        </>
      )}

      {/* Legend — right side, reduced opacity, highlights on hover/tap */}
      {data.accounts.map((acct, i) => {
        const y = legendStartY + i * legendItemH;
        const color = circles[i]?.color ?? ACCOUNT_COLORS[data.colorIndices?.[i] ?? i];
        const isActive = activeSet.has(i);
        const legendOpacity = activeSet.size === 0 ? 0.5 : isActive ? 1 : 0.3;
        return (
          <g
            key={`legend-${i}`}
            style={{ cursor: 'pointer', transition: 'opacity 0.2s ease' }}
            opacity={legendOpacity}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            onClick={(e) => handleCircleClick(i, e)}
          >
            <circle cx={legendX + 7} cy={y + 10} r={7} fill={color} fillOpacity={0.8} />
            <text
              x={legendX + 22}
              y={y + 8}
              fill="var(--color-navy)"
              fontFamily="var(--font-sans)"
              fontWeight={isActive ? 700 : 500}
              fontSize={13}
            >
              {acct.displayName || acct.handle}
            </text>
            <text
              x={legendX + 22}
              y={y + 24}
              fill="var(--color-text-muted)"
              fontFamily="var(--font-mono)"
              fontSize={12}
            >
              {fmt(acct.followerCount)} {countLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Summary Stats ───────────────────────────────────────────────────────────────

function SummaryStats({ data }: { data: OverlapData }) {
  const homoLabel = homogeneityLabel(data.homogeneityScore);
  const homoPct = (data.homogeneityScore * 100).toFixed(0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
      {/* Unique reach */}
      <div style={{
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: '20px 24px',
      }}>
        <div className="metric-label">Combined Unique Reach</div>
        <div className="metric-value">{fmt(data.uniqueReach)}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
          from {fmt(data.totalFollowers)} total
        </div>
      </div>

      {/* Shared by all */}
      <div style={{
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: '20px 24px',
      }}>
        <div className="metric-label">
          {data.accounts.length >= 3 ? `Shared by All ${data.accounts.length}` : 'Shared Followers'}
        </div>
        <div className="metric-value">
          {data.accounts.length >= 3 && data.tripleOverlap != null
            ? fmt(data.tripleOverlap)
            : fmt(data.pairwiseOverlap[0]?.sharedFollowers ?? 0)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
          followers in common
        </div>
      </div>

      {/* Median new audience */}
      <div style={{
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: '20px 24px',
      }}>
        <div className="metric-label">Median New Audience</div>
        <div className="metric-value">
          {data.medianNewAudience != null ? fmt(data.medianNewAudience) : `${homoPct}%`}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
          {data.medianNewAudience != null ? 'per collaborator' : homoLabel}
        </div>
      </div>
    </div>
  );
}

// ── Collaboration Read ──────────────────────────────────────────────────────────

export function CollaborationRead({ data }: { data: OverlapData }) {
  const n = data.accounts.length;
  const sorted = [...data.pairwiseOverlap].sort(
    (a, b) => b.jaccardSimilarity - a.jaccardSimilarity,
  );
  const closest = sorted[0];
  const furthest = sorted[sorted.length - 1];

  // ── Helpers ──
  const getIdx = (handle: string) => data.accounts.findIndex(a => a.handle === handle);
  const getFirst = (handle: string) => {
    const acct = data.accounts.find(a => a.handle === handle);
    return ((acct?.displayName || handle).split(' ')[0]);
  };
  const colorName = (handle: string) => {
    const idx = getIdx(handle);
    const colorIdx = data.colorIndices?.[idx] ?? idx;
    return (
      <span style={{ color: ACCOUNT_COLORS[colorIdx] ?? 'var(--color-navy)', fontWeight: 600 }}>
        {getFirst(handle)}
      </span>
    );
  };

  // ── Metrics ──
  const freshReach = data.uniqueReach;
  const biggestAlone = Math.max(...data.accounts.map(a => a.followerCount));
  const smallestAlone = Math.min(...data.accounts.map(a => a.followerCount));
  const netNew = freshReach - biggestAlone;
  const netNewPct = biggestAlone > 0 ? ((netNew / biggestAlone) * 100).toFixed(0) : '0';

  // Average Jaccard across all pairs (group-level characterization)
  const avgJaccard = sorted.length > 0
    ? (sorted.reduce((s, p) => s + p.jaccardSimilarity, 0) / sorted.length) * 100
    : 0;

  // ── S1: Reach statement (personalized for 2 accounts) ──
  const reachCopy = n === 2
    ? <>{colorName(data.accounts[0].handle)} and {colorName(data.accounts[1].handle)} together can reach <strong>{fmt(freshReach)} unique people</strong>{netNew > 0 && <> — {netNewPct}% more than {colorName(data.accounts[biggestAlone === data.accounts[0].followerCount ? 0 : 1].handle)} alone</>}</>
    : <>Together, these {n} accounts can reach <strong>{fmt(freshReach)} unique people</strong>{netNew > 0 && <> — {netNewPct}% more than the largest account alone</>}</>;

  // ── S2: Group dynamic (tiered by average Jaccard) ──
  const groupCopy = n === 2
    // For pairs, characterize the single relationship directly
    ? (() => {
        const pct = (closest.jaccardSimilarity * 100).toFixed(0);
        const j = closest.jaccardSimilarity * 100;
        return j > 40
          ? <>They share {pct}% of their audience — a deeply overlapping community where a collaboration is more about deepening loyalty than expanding reach</>
          : j > 20
          ? <>They share a significant audience ({pct}% overlap), which means strong social proof for joint projects, though fresh reach is limited</>
          : j > 10
          ? <>They have a meaningful crossover ({pct}% overlap) — enough shared trust to reduce friction, with plenty of new audience on both sides</>
          : j > 3
          ? <>They have a small but real overlap ({pct}% overlap) — mostly separate audiences, which means strong potential for cross-promotion</>
          : <>They have almost entirely separate audiences ({pct}% overlap) — a collaboration would introduce each to a genuinely fresh community</>;
      })()
    // For 3+ accounts, characterize the group dynamic
    : avgJaccard > 40
    ? <>This is a tight-knit group — most pairs share significant overlap, so reach gains are modest but trust is built-in</>
    : avgJaccard > 20
    ? <>These accounts share meaningful audiences — good social proof with some room for fresh reach</>
    : avgJaccard > 10
    ? <>A balanced mix of shared and separate audiences — the sweet spot for cross-promotion</>
    : avgJaccard > 3
    ? <>Mostly distinct communities — each account brings a genuinely different audience to the table</>
    : <>Almost entirely separate audiences — maximum fresh reach with minimal existing crossover</>;

  // ── S3: Standout closest pair (3+ accounts, only if notably above group average) ──
  const closestJaccard = closest.jaccardSimilarity * 100;
  const showClosest = n >= 3 && sorted.length > 1 && closestJaccard > avgJaccard * 2 && closestJaccard > 5;
  const closestPct = closestJaccard.toFixed(0);

  // ── S4: Outlier account (4+ accounts — who has the most distinct audience?) ──
  let outlierCopy: React.ReactNode = null;
  if (n >= 4) {
    // Compute average Jaccard per account across all their pairs
    const avgByAccount = data.accounts.map(acct => {
      const pairs = sorted.filter(p => p.handleA === acct.handle || p.handleB === acct.handle);
      const avg = pairs.length > 0
        ? pairs.reduce((s, p) => s + p.jaccardSimilarity, 0) / pairs.length
        : 0;
      return { handle: acct.handle, avg };
    });
    avgByAccount.sort((a, b) => a.avg - b.avg);
    const mostDistinct = avgByAccount[0];
    const groupAvgWithout = avgByAccount.slice(1).reduce((s, a) => s + a.avg, 0) / Math.max(avgByAccount.length - 1, 1);
    // Only show if this account is notably more distinct than the rest
    if (mostDistinct.avg < groupAvgWithout * 0.6) {
      const distinctPct = (mostDistinct.avg * 100).toFixed(0);
      outlierCopy = <> {colorName(mostDistinct.handle)} has the most distinct audience in the group — their average overlap with the others is just {distinctPct}%, making them the strongest reach multiplier.</>;
    }
  }

  // ── S5: Furthest pair (3 accounts only — for 4+ the outlier sentence covers this) ──
  const gapPp = Math.abs(closest.jaccardSimilarity - furthest.jaccardSimilarity) * 100;
  const showFurthest = n === 3 && sorted.length > 1 && furthest !== closest && gapPp >= 2;
  const furthestPct = (furthest.jaccardSimilarity * 100).toFixed(0);

  // ── S6: Size disparity (when biggest is 5x+ the smallest) ──
  const showDisparity = smallestAlone > 0 && biggestAlone / smallestAlone >= 5;
  const smallestAcct = data.accounts.reduce((a, b) => a.followerCount < b.followerCount ? a : b);
  const biggestAcct = data.accounts.reduce((a, b) => a.followerCount > b.followerCount ? a : b);

  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--color-border)',
      borderRadius: 6,
      padding: '24px 28px',
      marginBottom: 24,
    }}>
      <div className="section-label">Collaboration Read</div>
      <p style={{
        fontSize: 14, lineHeight: 1.7, color: 'var(--color-navy)', margin: 0,
      }}>
        {/* S1: Reach */}
        {reachCopy}. {groupCopy}.
        {/* S3: Standout closest pair */}
        {showClosest && (
          <> The closest pair is {colorName(closest.handleA)} and {colorName(closest.handleB)} ({closestPct}% overlap) — notably tighter than the rest of the group.</>
        )}
        {/* S4: Outlier account */}
        {outlierCopy}
        {/* S5: Furthest pair (3-account only) */}
        {showFurthest && (
          <> The widest gap is between {colorName(furthest.handleA)} and {colorName(furthest.handleB)} ({furthestPct}% overlap) — the biggest opportunity for new reach.</>
        )}
        {/* S6: Size disparity */}
        {showDisparity && (
          <> Note: {colorName(smallestAcct.handle)} is significantly smaller ({fmt(smallestAcct.followerCount)} vs {fmt(biggestAcct.followerCount)} followers), so the reach gain is asymmetric.</>
        )}
      </p>
    </div>
  );
}

// ── High overlap warning ────────────────────────────────────────────────────────

function HighOverlapWarning({ score }: { score: number }) {
  if (score < 0.7) return null;
  return (
    <div style={{
      background: '#FFF8ED',
      border: '1px solid #F5DEB3',
      borderRadius: 6,
      padding: '14px 20px',
      marginBottom: 24,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
    }}>
      <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>
        &#9888;
      </span>
      <span style={{ fontSize: 13, color: '#7a5a00', lineHeight: 1.5 }}>
        <strong>High overlap detected.</strong> This audience already knows each other
        — consider whether a bundle adds enough fresh reach to justify the collaboration.
      </span>
    </div>
  );
}

// ── Compact layout solver (no legend space, parameterizable size) ────────────

function solveCompactLayout(
  data: OverlapData,
  width: number,
  maxR: number,
  minR: number,
  pad: number,
): { circles: Circle[]; svgW: number; svgH: number } {
  const n = data.accounts.length;
  const followerCounts = data.accounts.map(a => a.followerCount);
  const maxFollowers = Math.max(...followerCounts);

  const radii = followerCounts.map(fc => {
    const ratio = maxFollowers > 0 ? fc / maxFollowers : 1;
    return minR + Math.sqrt(ratio) * (maxR - minR);
  });
  const bigR = Math.max(...radii);
  const floorR = bigR * 0.4;
  const clampedRadii = radii.map(r => Math.max(r, floorR));

  const getPairOverlap = (hA: string, hB: string) =>
    data.pairwiseOverlap.find(
      p => (p.handleA === hA && p.handleB === hB) || (p.handleA === hB && p.handleB === hA)
    );

  if (n === 2) {
    const pair = getPairOverlap(data.accounts[0].handle, data.accounts[1].handle);
    const r1 = clampedRadii[0], r2 = clampedRadii[1];
    const shared = pair?.sharedFollowers ?? 0;
    const smallerCount = Math.min(followerCounts[0], followerCounts[1]);
    const overlapFraction = smallerCount > 0 ? Math.min(shared / smallerCount, 1) : 0;
    const smallerArea = Math.PI * Math.min(r1, r2) ** 2;
    const targetArea = overlapFraction * smallerArea;
    const d = distanceForOverlap(r1, r2, targetArea);

    // Scale down if circles extend past available width
    const totalSpan = d + r1 + r2;
    const availW = width - 2 * pad;
    const scale2 = totalSpan > availW ? availW / totalSpan : 1;
    const sr1 = r1 * scale2, sr2 = r2 * scale2, sd = d * scale2;

    const cx = width / 2;
    const cy = Math.max(sr1, sr2) + pad;
    const svgH = cy + Math.max(sr1, sr2) + pad;
    return {
      circles: [
        { x: cx - sd / 2, y: cy, r: sr1, handle: data.accounts[0].handle, color: ACCOUNT_COLORS[data.colorIndices?.[0] ?? 0] },
        { x: cx + sd / 2, y: cy, r: sr2, handle: data.accounts[1].handle, color: ACCOUNT_COLORS[data.colorIndices?.[1] ?? 1] },
      ],
      svgW: width,
      svgH,
    };
  }

  // 3+ accounts: N-gon initial positions
  const cx = width / 2;
  const cy0 = pad + maxR + maxR * 0.5;
  const startR2 = maxR * 0.7;
  const positions: [number, number][] = Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + startR2 * Math.cos(angle), cy0 + startR2 * Math.sin(angle)] as [number, number];
  });

  const pairs: { i: number; j: number; targetD: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pair = getPairOverlap(data.accounts[i].handle, data.accounts[j].handle);
      const shared = pair?.sharedFollowers ?? 0;
      const smallerCount = Math.min(followerCounts[i], followerCounts[j]);
      const overlapFraction = smallerCount > 0 ? Math.min(shared / smallerCount, 1) : 0;
      const smallerArea = Math.PI * Math.min(clampedRadii[i], clampedRadii[j]) ** 2;
      const targetArea = overlapFraction * smallerArea;
      const targetD = distanceForOverlap(clampedRadii[i], clampedRadii[j], targetArea);
      pairs.push({ i, j, targetD });
    }
  }

  for (let iter = 0; iter < 200; iter++) {
    const forces: [number, number][] = positions.map(() => [0, 0]);
    const k = 0.05 * Math.max(0.01, 1 - iter / 200);
    for (const { i, j, targetD } of pairs) {
      const dx = positions[j][0] - positions[i][0];
      const dy = positions[j][1] - positions[i][1];
      const currentD = Math.sqrt(dx * dx + dy * dy) || 1;
      const err = currentD - targetD;
      const fx = (dx / currentD) * err * k;
      const fy = (dy / currentD) * err * k;
      forces[i][0] += fx; forces[i][1] += fy;
      forces[j][0] -= fx; forces[j][1] -= fy;
    }
    for (let i = 0; i < n; i++) {
      positions[i][0] += forces[i][0];
      positions[i][1] += forces[i][1];
    }
  }

  const allX = positions.map((p, i) => [p[0] - clampedRadii[i], p[0] + clampedRadii[i]]).flat();
  const allY = positions.map((p, i) => [p[1] - clampedRadii[i], p[1] + clampedRadii[i]]).flat();
  const bMinX = Math.min(...allX), bMaxX = Math.max(...allX);
  const bMinY = Math.min(...allY), bMaxY = Math.max(...allY);
  const spanX = bMaxX - bMinX || 1;
  const spanY = bMaxY - bMinY || 1;
  const availW = width - 2 * pad;
  const availH = 2 * maxR + 2 * pad;
  const scale = Math.min(availW / spanX, availH / spanY, 1);
  const offsetX = pad + (availW - spanX * scale) / 2 - bMinX * scale;
  const offsetY = pad - bMinY * scale;

  const circles: Circle[] = data.accounts.map((a, i) => ({
    x: positions[i][0] * scale + offsetX,
    y: positions[i][1] * scale + offsetY,
    r: clampedRadii[i] * scale,
    handle: a.handle,
    color: ACCOUNT_COLORS[data.colorIndices?.[i] ?? i],
  }));

  const maxCy = Math.max(...circles.map(c => c.y + c.r));
  return { circles, svgW: width, svgH: maxCy + pad };
}

// ── Mini Venn SVG (compact, no legend, no labels) ───────────────────────────────

export function MiniVennSvg({ data, width = 240, id = '' }: { data: OverlapData; width?: number; id?: string }) {
  const maxR = width * 0.35;
  const minR = width * 0.12;
  const pad = width * 0.08;

  const { circles, svgW, svgH } = useMemo(
    () => solveCompactLayout(data, width, maxR, minR, pad),
    [data, width, maxR, minR, pad]
  );

  const renderOrder = useMemo(() => {
    const indices = circles.map((_, i) => i);
    return indices.reverse();
  }, [circles]);

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      width="100%"
      style={{ maxWidth: width, display: 'block', margin: '0 auto' }}
    >
      <defs>
        {circles.map((_, i) => (
          <filter key={`ms-${id}-${i}`} id={`mini-shadow-${id}-${i}`} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
            <feOffset />
            <feGaussianBlur stdDeviation="3.5" />
            <feComposite in2="hardAlpha" operator="out" />
            <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.1 0" />
            <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
            <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
          </filter>
        ))}
      </defs>
      {renderOrder.map(i => {
        const c = circles[i];
        return (
          <circle
            key={`mf-${i}`}
            cx={c.x} cy={c.y} r={c.r}
            fill={c.color} fillOpacity={0.6}
            stroke={c.color} strokeOpacity={0.6} strokeWidth={1}
            filter={`url(#mini-shadow-${id}-${i})`}
          />
        );
      })}
    </svg>
  );
}

// ── Venn Card with expand-on-tap ────────────────────────────────────────────────

export function VennCard({
  data,
  label,
  sharedCount,
  jaccard,
  sharedLabel,
  onDrillDown,
}: {
  data: OverlapData;
  label: string;
  sharedCount: number;
  jaccard: number;
  sharedLabel: string;
  onDrillDown?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div
        onClick={() => setExpanded(true)}
        style={{
          background: '#fff',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: '20px 22px',
          cursor: 'pointer',
          transition: 'box-shadow 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(4,24,43,0.08)')}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
      >
        <div className="section-label" style={{ marginBottom: 12 }}>{label}</div>
        <MiniVennSvg data={data} width={220} id={label.replace(/\s+/g, '-')} />
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <button
            onClick={e => { e.stopPropagation(); onDrillDown?.(); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
            }}
          >
            <span style={{
              fontSize: 36, fontWeight: 400, fontFamily: 'var(--font-mono)',
              color: 'var(--color-blue)', letterSpacing: '-0.03em', lineHeight: 1,
            }}>
              {sharedCount.toLocaleString()}
            </span>
            <div style={{
              fontSize: 11, color: 'var(--color-blue)', fontWeight: 500,
              marginTop: 3, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 3,
            }}>
              {sharedLabel} <span style={{ fontSize: 10 }}>↗</span>
            </div>
          </button>
          <div>
            <span style={{
              fontSize: 18, fontWeight: 400, fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-muted)',
            }}>
              {jaccard.toFixed(1)}%
            </span>
            <div style={{
              fontSize: 10, color: 'var(--color-text-faint)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2,
            }}>
              Similarity
            </div>
          </div>
        </div>
      </div>

      {/* Expanded modal */}
      {expanded && (
        <div
          className="modal-backdrop"
          onClick={() => setExpanded(false)}
        >
          <div
            className="modal-box"
            style={{ maxWidth: 740, padding: '32px 28px', overflow: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div className="section-label" style={{ margin: 0 }}>{label}</div>
              <button
                onClick={() => setExpanded(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 18, color: 'var(--color-text-faint)', padding: '4px 8px',
                }}
              >
                ✕
              </button>
            </div>
            <VennDiagram data={data} />
            {onDrillDown && (
              <button
                onClick={() => { onDrillDown(); setExpanded(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  margin: '20px auto 0', padding: '10px 20px',
                  background: 'none', border: '1px solid var(--color-blue)',
                  borderRadius: 4, cursor: 'pointer', color: 'var(--color-blue)',
                  fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-sans)',
                }}
              >
                {sharedCount.toLocaleString()} {sharedLabel}
                <span style={{ fontSize: 12 }}>↗</span>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Pair Venn Header (compact 2-circle for pairwise accordion) ──────────────────

export function PairVennHeader({ data }: { data: OverlapData }) {
  return (
    <div style={{ padding: '8px 0 4px' }}>
      <MiniVennSvg data={data} width={180} id={data.accounts.map(a => a.handle).join('-')} />
    </div>
  );
}

// ── Data converters (AnalysisResult types → OverlapData) ────────────────────────

import type { ThreeWayOverlap, PairwiseOverlap as PairwiseOverlapType, BskyProfile } from '@/lib/types';

/** Convert three-way follower data to OverlapData */
export function threeWayToOverlapData(
  threeWay: ThreeWayOverlap,
  pairwiseOverlaps: PairwiseOverlapType[],
  mode: 'followers' | 'engagement',
): OverlapData {
  const accounts = threeWay.profiles.map(p => ({
    handle: p.handle,
    displayName: p.displayName || p.handle,
    followerCount: mode === 'followers' ? (p.followersCount ?? 0) : 0,
  }));

  // For engagement mode, use engaged counts from pairwise data
  if (mode === 'engagement') {
    const engagedMap = new Map<string, number>();
    for (const po of pairwiseOverlaps) {
      engagedMap.set(po.account1.handle, Math.max(engagedMap.get(po.account1.handle) ?? 0, po.engaged1));
      engagedMap.set(po.account2.handle, Math.max(engagedMap.get(po.account2.handle) ?? 0, po.engaged2));
    }
    accounts.forEach(a => { a.followerCount = engagedMap.get(a.handle) ?? 0; });
  }

  const pairwiseOverlap = pairwiseOverlaps
    .filter(po => threeWay.profiles.some(p => p.handle === po.account1.handle) &&
                  threeWay.profiles.some(p => p.handle === po.account2.handle))
    .map(po => ({
      handleA: po.account1.handle,
      handleB: po.account2.handle,
      sharedFollowers: mode === 'followers' ? po.followerOverlap : po.engagementOverlap,
      jaccardSimilarity: (mode === 'followers' ? po.followerJaccard : po.engagementJaccard) / 100,
    }));

  const tripleOverlap = mode === 'followers' ? threeWay.follower : threeWay.engagement;
  const totalFollowers = accounts.reduce((s, a) => s + a.followerCount, 0);
  const sharedSum = pairwiseOverlap.reduce((s, p) => s + p.sharedFollowers, 0);
  const uniqueReach = totalFollowers - sharedSum + tripleOverlap; // approximate
  const jaccards = pairwiseOverlap.map(p => p.jaccardSimilarity);
  const homogeneityScore = jaccards.length > 0 ? jaccards.reduce((s, j) => s + j, 0) / jaccards.length : 0;

  return { accounts, pairwiseOverlap, tripleOverlap, uniqueReach, totalFollowers, homogeneityScore };
}

/** Convert a single pairwise overlap to OverlapData */
export function pairToOverlapData(
  po: PairwiseOverlapType,
  mode: 'followers' | 'engagement',
  colorIndices?: [number, number],
): OverlapData {
  const isFollowers = mode === 'followers';
  const accounts = [
    {
      handle: po.account1.handle,
      displayName: po.account1.displayName || po.account1.handle,
      followerCount: isFollowers ? po.followers1 : po.engaged1,
    },
    {
      handle: po.account2.handle,
      displayName: po.account2.displayName || po.account2.handle,
      followerCount: isFollowers ? po.followers2 : po.engaged2,
    },
  ];

  const shared = isFollowers ? po.followerOverlap : po.engagementOverlap;
  const jaccard = (isFollowers ? po.followerJaccard : po.engagementJaccard) / 100;

  return {
    accounts,
    pairwiseOverlap: [{
      handleA: po.account1.handle,
      handleB: po.account2.handle,
      sharedFollowers: shared,
      jaccardSimilarity: jaccard,
    }],
    uniqueReach: accounts[0].followerCount + accounts[1].followerCount - shared,
    totalFollowers: accounts[0].followerCount + accounts[1].followerCount,
    homogeneityScore: jaccard,
    colorIndices,
  };
}

// ── Main component ──────────────────────────────────────────────────────────────

export default function CollaborationVenn({ data }: { data: OverlapData }) {
  return (
    <div>
      <HighOverlapWarning score={data.homogeneityScore} />

      {/* Summary stats — above the graph */}
      <SummaryStats data={data} />

      {/* Venn diagram with legend */}
      <div style={{
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: '28px 24px 20px',
        marginBottom: 24,
      }}>
        <VennDiagram data={data} />
      </div>

      {/* Collaboration read */}
      <CollaborationRead data={data} />
    </div>
  );
}

// ── Mock data for development ───────────────────────────────────────────────────

export const MOCK_DATA_3: OverlapData = {
  accounts: [
    { handle: '@investigates.bsky.social', displayName: 'Investigates', followerCount: 48200 },
    { handle: '@techwatch.bsky.social', displayName: 'TechWatch', followerCount: 31500 },
    { handle: '@datasci.bsky.social', displayName: 'DataSci Daily', followerCount: 12800 },
  ],
  pairwiseOverlap: [
    { handleA: '@investigates.bsky.social', handleB: '@techwatch.bsky.social', sharedFollowers: 8400, jaccardSimilarity: 0.118 },
    { handleA: '@investigates.bsky.social', handleB: '@datasci.bsky.social', sharedFollowers: 3200, jaccardSimilarity: 0.055 },
    { handleA: '@techwatch.bsky.social', handleB: '@datasci.bsky.social', sharedFollowers: 5100, jaccardSimilarity: 0.130 },
  ],
  tripleOverlap: 1850,
  uniqueReach: 75950,
  totalFollowers: 92500,
  homogeneityScore: 0.10,
};

export const MOCK_DATA_2: OverlapData = {
  accounts: [
    { handle: '@newsroom.bsky.social', displayName: 'The Newsroom', followerCount: 82000 },
    { handle: '@policy.bsky.social', displayName: 'Policy Insider', followerCount: 24000 },
  ],
  pairwiseOverlap: [
    { handleA: '@newsroom.bsky.social', handleB: '@policy.bsky.social', sharedFollowers: 11200, jaccardSimilarity: 0.118 },
  ],
  uniqueReach: 94800,
  totalFollowers: 106000,
  homogeneityScore: 0.12,
};

export const MOCK_DATA_HIGH_OVERLAP: OverlapData = {
  accounts: [
    { handle: '@tech1.bsky.social', displayName: 'Tech Alpha', followerCount: 40000 },
    { handle: '@tech2.bsky.social', displayName: 'Tech Beta', followerCount: 38000 },
  ],
  pairwiseOverlap: [
    { handleA: '@tech1.bsky.social', handleB: '@tech2.bsky.social', sharedFollowers: 28000, jaccardSimilarity: 0.56 },
  ],
  uniqueReach: 50000,
  totalFollowers: 78000,
  homogeneityScore: 0.75,
};

export const MOCK_DATA_ZERO_OVERLAP: OverlapData = {
  accounts: [
    { handle: '@sports.bsky.social', displayName: 'SportsCentral', followerCount: 55000 },
    { handle: '@cooking.bsky.social', displayName: 'Chef Corner', followerCount: 22000 },
  ],
  pairwiseOverlap: [
    { handleA: '@sports.bsky.social', handleB: '@cooking.bsky.social', sharedFollowers: 0, jaccardSimilarity: 0 },
  ],
  uniqueReach: 77000,
  totalFollowers: 77000,
  homogeneityScore: 0,
};

export const MOCK_DATA_SIZE_MISMATCH: OverlapData = {
  accounts: [
    { handle: '@mega.bsky.social', displayName: 'MegaInfluencer', followerCount: 500000 },
    { handle: '@micro.bsky.social', displayName: 'MicroNiche', followerCount: 3200 },
    { handle: '@mid.bsky.social', displayName: 'MidTier', followerCount: 45000 },
  ],
  pairwiseOverlap: [
    { handleA: '@mega.bsky.social', handleB: '@micro.bsky.social', sharedFollowers: 1800, jaccardSimilarity: 0.004 },
    { handleA: '@mega.bsky.social', handleB: '@mid.bsky.social', sharedFollowers: 12000, jaccardSimilarity: 0.023 },
    { handleA: '@micro.bsky.social', handleB: '@mid.bsky.social', sharedFollowers: 900, jaccardSimilarity: 0.019 },
  ],
  tripleOverlap: 320,
  uniqueReach: 533480,
  totalFollowers: 548200,
  homogeneityScore: 0.015,
};
