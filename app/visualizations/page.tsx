'use client';

import { useState } from 'react';

// ── Sample data (from the screenshot) ────────────────────────────────────────

const TRIO_DATA = {
  user: { handle: '@jonnelledge.bsky.social', displayName: 'Jon Elledge', size: 57700, avatar: null },
  matchA: { handle: '@jim.londoncentric.media', displayName: 'Jim Waterson', size: 52800, avatar: null },
  matchB: { handle: '@taliajane.bsky.social', displayName: 'talia jane 🔥', size: 51600, avatar: null },
  overlaps: { userA: 31400, userB: 2500, ab: 2200, threeWay: 1200 },
  totalReach: 127200,
  newForUser: 74400,
  newForA: 70500,
  newForB: 105800,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
}

const COLORS = {
  user: '#1a365d',
  userLight: 'rgba(26, 54, 93, 0.15)',
  a: '#2563eb',
  aLight: 'rgba(37, 99, 235, 0.15)',
  b: '#059669',
  bLight: 'rgba(5, 150, 105, 0.15)',
  overlap: '#7c3aed',
  overlapLight: 'rgba(124, 58, 237, 0.2)',
  center: '#dc2626',
};

// ── Visualization 1: Particle / Dot ──────────────────────────────────────────

function ParticleDots() {
  const total = TRIO_DATA.totalReach;
  const dotCount = 600; // total dots to render
  const scale = (n: number) => Math.round((n / total) * dotCount);

  // Calculate unique counts for each account
  const uniqueUser = TRIO_DATA.user.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.threeWay;
  const uniqueA = TRIO_DATA.matchA.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;
  const uniqueB = TRIO_DATA.matchB.size - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;

  // Build dot array with categories
  type DotType = 'user' | 'a' | 'b' | 'userA' | 'userB' | 'ab' | 'center';
  const dots: { type: DotType; x: number; y: number; delay: number }[] = [];

  // Cluster centers (equilateral triangle)
  const centers = {
    user: { x: 200, y: 80 },
    a: { x: 120, y: 220 },
    b: { x: 280, y: 220 },
    userA: { x: 150, y: 150 },
    userB: { x: 250, y: 150 },
    ab: { x: 200, y: 230 },
    center: { x: 200, y: 170 },
  };

  const addDots = (type: DotType, count: number, cx: number, cy: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.5);
      const r = Math.random() * spread;
      dots.push({
        type,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        delay: Math.random() * 2,
      });
    }
  };

  addDots('user', scale(uniqueUser), centers.user.x, centers.user.y, 55);
  addDots('a', scale(uniqueA), centers.a.x, centers.a.y, 50);
  addDots('b', scale(uniqueB), centers.b.x, centers.b.y, 50);
  addDots('userA', scale(TRIO_DATA.overlaps.userA), centers.userA.x, centers.userA.y, 30);
  addDots('userB', scale(TRIO_DATA.overlaps.userB), centers.userB.x, centers.userB.y, 25);
  addDots('ab', scale(TRIO_DATA.overlaps.ab), centers.ab.x, centers.ab.y, 22);
  addDots('center', scale(TRIO_DATA.overlaps.threeWay), centers.center.x, centers.center.y, 15);

  const dotColor = (type: DotType) => {
    switch (type) {
      case 'user': return COLORS.user;
      case 'a': return COLORS.a;
      case 'b': return COLORS.b;
      case 'userA': return '#6b21a8';
      case 'userB': return '#0d9488';
      case 'ab': return '#0891b2';
      case 'center': return COLORS.center;
    }
  };

  return (
    <div>
      <style>{`
        @keyframes particleFadeIn {
          from { opacity: 0; transform: scale(0); }
          to { opacity: 0.8; transform: scale(1); }
        }
      `}</style>
      <svg viewBox="0 0 400 300" style={{ width: '100%', maxWidth: 500 }}>
        {dots.map((dot, i) => (
          <circle
            key={i}
            cx={dot.x}
            cy={dot.y}
            r={2.2}
            fill={dotColor(dot.type)}
            style={{
              animation: `particleFadeIn 0.6s ease-out ${dot.delay}s both`,
            }}
          />
        ))}
        {/* Labels */}
        <text x={200} y={55} textAnchor="middle" fontSize={11} fontWeight={700} fill={COLORS.user} fontFamily="var(--font-mono)">
          {TRIO_DATA.user.displayName} · {fmt(TRIO_DATA.user.size)}
        </text>
        <text x={80} y={275} textAnchor="middle" fontSize={11} fontWeight={700} fill={COLORS.a} fontFamily="var(--font-mono)">
          {TRIO_DATA.matchA.displayName} · {fmt(TRIO_DATA.matchA.size)}
        </text>
        <text x={320} y={275} textAnchor="middle" fontSize={11} fontWeight={700} fill={COLORS.b} fontFamily="var(--font-mono)">
          {TRIO_DATA.matchB.displayName.replace(' 🔥', '')} · {fmt(TRIO_DATA.matchB.size)}
        </text>
        {/* Center overlap label */}
        <circle cx={200} cy={170} r={14} fill="#fff" stroke={COLORS.center} strokeWidth={1.5} />
        <text x={200} y={174} textAnchor="middle" fontSize={9} fontWeight={700} fill={COLORS.center} fontFamily="var(--font-mono)">
          {fmt(TRIO_DATA.overlaps.threeWay)}
        </text>
      </svg>
    </div>
  );
}

// ── Visualization 2: Concentric Rings / Radar ────────────────────────────────

function ConcentricRings() {
  const cx = 200, cy = 160;
  const maxR = 120;
  const total = TRIO_DATA.totalReach;

  // Each account gets an arc sector
  // User: top, A: bottom-left, B: bottom-right
  const accounts = [
    { label: TRIO_DATA.user.displayName, size: TRIO_DATA.user.size, color: COLORS.user, colorLight: COLORS.userLight, startAngle: -30, endAngle: 90 },
    { label: TRIO_DATA.matchA.displayName, size: TRIO_DATA.matchA.size, color: COLORS.a, colorLight: COLORS.aLight, startAngle: 90, endAngle: 210 },
    { label: TRIO_DATA.matchB.displayName.replace(' 🔥', ''), size: TRIO_DATA.matchB.size, color: COLORS.b, colorLight: COLORS.bLight, startAngle: 210, endAngle: 330 },
  ];

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const arcPath = (innerR: number, outerR: number, startDeg: number, endDeg: number) => {
    const s1 = toRad(startDeg - 90), e1 = toRad(endDeg - 90);
    const x1 = cx + outerR * Math.cos(s1), y1 = cy + outerR * Math.sin(s1);
    const x2 = cx + outerR * Math.cos(e1), y2 = cy + outerR * Math.sin(e1);
    const x3 = cx + innerR * Math.cos(e1), y3 = cy + innerR * Math.sin(e1);
    const x4 = cx + innerR * Math.cos(s1), y4 = cy + innerR * Math.sin(s1);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M${x1},${y1} A${outerR},${outerR} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${innerR},${innerR} 0 ${largeArc} 0 ${x4},${y4} Z`;
  };

  // Overlap ring (inner)
  const overlapR = maxR * 0.35;
  // Unique ring (outer)
  const uniqueR = maxR;

  return (
    <div>
      <style>{`
        @keyframes ringGrow {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .ring-segment { transform-origin: ${cx}px ${cy}px; }
      `}</style>
      <svg viewBox="0 0 400 340" style={{ width: '100%', maxWidth: 500 }}>
        {/* Grid rings */}
        {[0.25, 0.5, 0.75, 1].map((pct) => (
          <circle key={pct} cx={cx} cy={cy} r={maxR * pct} fill="none" stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="3,3" />
        ))}

        {/* Account arcs — outer ring (unique followers) */}
        {accounts.map((acc, i) => {
          const ratio = acc.size / total;
          return (
            <path
              key={`outer-${i}`}
              d={arcPath(overlapR + 4, uniqueR * Math.sqrt(ratio) * 1.4, acc.startAngle + 2, acc.endAngle - 2)}
              fill={acc.colorLight}
              stroke={acc.color}
              strokeWidth={1.5}
              className="ring-segment"
              style={{ animation: `ringGrow 0.8s ease-out ${i * 0.15}s both` }}
            />
          );
        })}

        {/* Inner overlap ring */}
        <circle cx={cx} cy={cy} r={overlapR} fill={COLORS.overlapLight} stroke={COLORS.overlap} strokeWidth={1.5}
          className="ring-segment" style={{ animation: 'ringGrow 0.8s ease-out 0.5s both' }} />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={14} fontWeight={700} fill={COLORS.overlap} fontFamily="var(--font-mono)">
          {fmt(TRIO_DATA.overlaps.userA + TRIO_DATA.overlaps.userB + TRIO_DATA.overlaps.ab + TRIO_DATA.overlaps.threeWay)}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize={8} fill="var(--color-text-muted)" fontFamily="var(--font-sans)">
          shared followers
        </text>

        {/* Account labels */}
        {accounts.map((acc, i) => {
          const midAngle = toRad(((acc.startAngle + acc.endAngle) / 2) - 90);
          const labelR = maxR + 22;
          const lx = cx + labelR * Math.cos(midAngle);
          const ly = cy + labelR * Math.sin(midAngle);
          return (
            <g key={`label-${i}`}>
              <text x={lx} y={ly} textAnchor="middle" fontSize={10} fontWeight={600} fill={acc.color} fontFamily="var(--font-mono)">
                {acc.label}
              </text>
              <text x={lx} y={ly + 13} textAnchor="middle" fontSize={9} fill="var(--color-text-faint)" fontFamily="var(--font-mono)">
                {fmt(acc.size)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Visualization 3: Waffle Grid ─────────────────────────────────────────────

function WaffleGrid() {
  const total = TRIO_DATA.totalReach;
  const gridSize = 20; // 20x20 = 400 cells
  const cells = gridSize * gridSize;

  // Calculate proportions
  const uniqueUser = TRIO_DATA.user.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.threeWay;
  const uniqueA = TRIO_DATA.matchA.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;
  const uniqueB = TRIO_DATA.matchB.size - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;

  type CellType = 'user' | 'a' | 'b' | 'userA' | 'userB' | 'ab' | 'center';
  const segments: { type: CellType; count: number; color: string; label: string }[] = [
    { type: 'center', count: Math.max(1, Math.round((TRIO_DATA.overlaps.threeWay / total) * cells)), color: COLORS.center, label: 'All three' },
    { type: 'userA', count: Math.round((TRIO_DATA.overlaps.userA / total) * cells), color: '#7c3aed', label: 'Jon + Jim' },
    { type: 'userB', count: Math.round((TRIO_DATA.overlaps.userB / total) * cells), color: '#0d9488', label: 'Jon + talia' },
    { type: 'ab', count: Math.round((TRIO_DATA.overlaps.ab / total) * cells), color: '#0891b2', label: 'Jim + talia' },
    { type: 'user', count: Math.round((uniqueUser / total) * cells), color: COLORS.user, label: 'Only Jon' },
    { type: 'a', count: Math.round((uniqueA / total) * cells), color: COLORS.a, label: 'Only Jim' },
    { type: 'b', count: Math.round((uniqueB / total) * cells), color: COLORS.b, label: 'Only talia' },
  ];

  // Build flat array
  const grid: { type: CellType; color: string }[] = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.count && grid.length < cells; i++) {
      grid.push({ type: seg.type, color: seg.color });
    }
  }
  // Fill remaining
  while (grid.length < cells) grid.push({ type: 'b', color: COLORS.b });

  const cellSize = 16;
  const gap = 2;
  const totalW = gridSize * (cellSize + gap);

  const [hoveredType, setHoveredType] = useState<CellType | null>(null);

  return (
    <div>
      <style>{`
        @keyframes wafflePop {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <svg viewBox={`0 0 ${totalW} ${totalW}`} style={{ width: '100%', maxWidth: 380 }}>
          {grid.map((cell, i) => {
            const row = Math.floor(i / gridSize);
            const col = i % gridSize;
            const isHighlighted = hoveredType === null || hoveredType === cell.type;
            return (
              <rect
                key={i}
                x={col * (cellSize + gap)}
                y={row * (cellSize + gap)}
                width={cellSize}
                height={cellSize}
                rx={2}
                fill={cell.color}
                opacity={isHighlighted ? 0.85 : 0.15}
                style={{
                  animation: `wafflePop 0.3s ease-out ${(row * gridSize + col) * 0.003}s both`,
                  transition: 'opacity 0.2s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={() => setHoveredType(cell.type)}
                onMouseLeave={() => setHoveredType(null)}
              />
            );
          })}
        </svg>

        {/* Legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Each square ≈ {fmt(Math.round(total / cells))} followers
          </div>
          {segments.map((seg) => (
            <div
              key={seg.type}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                opacity: hoveredType === null || hoveredType === seg.type ? 1 : 0.4,
                transition: 'opacity 0.2s ease',
              }}
              onMouseEnter={() => setHoveredType(seg.type)}
              onMouseLeave={() => setHoveredType(null)}
            >
              <div style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: seg.color, flexShrink: 0 }} />
              <span style={{ color: 'var(--color-text-muted)' }}>{seg.label}</span>
              <span style={{ color: seg.color, fontWeight: 600 }}>{seg.count} ({Math.round((seg.count / cells) * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Visualization 4: Proportional Bar ────────────────────────────────────────

function ProportionalBar() {
  const total = TRIO_DATA.totalReach;

  const uniqueUser = TRIO_DATA.user.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.threeWay;
  const uniqueA = TRIO_DATA.matchA.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;
  const uniqueB = TRIO_DATA.matchB.size - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;

  const segments = [
    { label: 'Only Jon', count: uniqueUser, color: COLORS.user },
    { label: 'Jon + Jim', count: TRIO_DATA.overlaps.userA, color: '#7c3aed' },
    { label: 'All three', count: TRIO_DATA.overlaps.threeWay, color: COLORS.center },
    { label: 'Jon + talia', count: TRIO_DATA.overlaps.userB, color: '#0d9488' },
    { label: 'Jim + talia', count: TRIO_DATA.overlaps.ab, color: '#0891b2' },
    { label: 'Only Jim', count: uniqueA, color: COLORS.a },
    { label: 'Only talia', count: uniqueB, color: COLORS.b },
  ];

  const [hovered, setHovered] = useState<number | null>(null);
  const barHeight = 48;

  return (
    <div>
      <style>{`
        @keyframes barGrow {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
      `}</style>

      {/* Combined audience header */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-navy)' }}>
          {fmt(total)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>unique followers combined</div>
      </div>

      {/* Bar */}
      <div style={{
        display: 'flex', borderRadius: 8, overflow: 'hidden', height: barHeight,
        animation: 'barGrow 1s ease-out both', transformOrigin: 'left',
      }}>
        {segments.map((seg, i) => {
          const pct = (seg.count / total) * 100;
          if (pct < 0.3) return null; // skip tiny segments
          const isHovered = hovered === i;
          return (
            <div
              key={i}
              style={{
                width: `${pct}%`,
                backgroundColor: seg.color,
                opacity: hovered === null || isHovered ? 1 : 0.4,
                transition: 'opacity 0.2s, transform 0.2s',
                transform: isHovered ? 'scaleY(1.08)' : 'scaleY(1)',
                cursor: 'pointer',
                position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {pct > 5 && (
                <span style={{
                  fontSize: 11, fontWeight: 600, color: '#fff', fontFamily: 'var(--font-mono)',
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                }}>
                  {fmt(seg.count)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Tooltip */}
      {hovered !== null && (
        <div style={{
          textAlign: 'center', marginTop: 12, fontSize: 13,
          fontFamily: 'var(--font-mono)', color: segments[hovered].color, fontWeight: 600,
        }}>
          {segments[hovered].label}: {fmt(segments[hovered].count)} ({Math.round((segments[hovered].count / total) * 100)}%)
        </div>
      )}

      {/* Legend row */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16, justifyContent: 'center',
      }}>
        {segments.filter(s => (s.count / total) >= 0.003).map((seg, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
              fontFamily: 'var(--font-mono)', cursor: 'pointer',
              opacity: hovered === null || hovered === i ? 1 : 0.4,
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: seg.color }} />
            <span style={{ color: 'var(--color-text-muted)' }}>{seg.label}</span>
          </div>
        ))}
      </div>

      {/* Per-account breakdown */}
      <div style={{ display: 'flex', gap: 16, marginTop: 24, justifyContent: 'center' }}>
        {[
          { name: TRIO_DATA.user.displayName, newFor: TRIO_DATA.newForUser, color: COLORS.user },
          { name: TRIO_DATA.matchA.displayName, newFor: TRIO_DATA.newForA, color: COLORS.a },
          { name: TRIO_DATA.matchB.displayName.replace(' 🔥', ''), newFor: TRIO_DATA.newForB, color: COLORS.b },
        ].map((acc) => (
          <div key={acc.name} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 2 }}>New for {acc.name.split(' ')[0]}</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: acc.color }}>
              +{fmt(acc.newFor)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function VisualizationsPage() {
  return (
    <div style={{
      maxWidth: 700, margin: '0 auto', padding: '48px 24px',
      fontFamily: 'var(--font-sans)', color: 'var(--color-navy)',
    }}>
      <h1 style={{
        fontSize: 32, fontWeight: 700, marginBottom: 8,
        letterSpacing: '-0.02em',
      }}>
        Overlap Visualizations
      </h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 48 }}>
        Four ways to visualize the same data: Jon + Jim Waterson + talia jane
      </p>

      {/* Card wrapper */}
      {[
        { title: '1. Particle Dots', desc: 'Each dot = a cluster of followers. Shared followers drift to the center. Animated on load.', component: <ParticleDots /> },
        { title: '2. Concentric Rings', desc: 'Radar-like arcs per account. Inner ring = shared followers. Outer arcs = proportional reach.', component: <ConcentricRings /> },
        { title: '3. Waffle Grid', desc: 'Each square ≈ 318 followers. Hover to highlight segments. Very infographic-y and screenshot-friendly.', component: <WaffleGrid /> },
        { title: '4. Proportional Bar', desc: 'One bar, all segments. Clean, mobile-friendly, instantly readable. Hover for details.', component: <ProportionalBar /> },
      ].map((viz) => (
        <div key={viz.title} style={{
          marginBottom: 48, padding: 32,
          border: '1px solid var(--color-border)', borderRadius: 12,
          backgroundColor: '#fff',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{viz.title}</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>{viz.desc}</p>
          {viz.component}
        </div>
      ))}
    </div>
  );
}
