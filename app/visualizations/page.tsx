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

// ── Visualization 1b: Particle Dots (Structured) ─────────────────────────────
// Clearer version: dots arranged in distinct labeled zones with visible boundaries

function ParticleDotsStructured() {
  const total = TRIO_DATA.totalReach;

  const uniqueUser = TRIO_DATA.user.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.threeWay;
  const uniqueA = TRIO_DATA.matchA.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;
  const uniqueB = TRIO_DATA.matchB.size - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;

  // Zones: each has a center, radius, color, label, and dot count
  const dotScale = 500 / total;
  const zones = [
    { id: 'user', label: 'Jon only', count: Math.round(uniqueUser * dotScale), cx: 100, cy: 90, spread: 52, color: COLORS.user, value: uniqueUser },
    { id: 'a', label: 'Jim only', count: Math.round(uniqueA * dotScale), cx: 80, cy: 250, spread: 38, color: COLORS.a, value: uniqueA },
    { id: 'b', label: 'talia only', count: Math.round(uniqueB * dotScale), cx: 320, cy: 250, spread: 55, color: COLORS.b, value: uniqueB },
    { id: 'userA', label: 'Jon + Jim', count: Math.round(TRIO_DATA.overlaps.userA * dotScale), cx: 80, cy: 165, spread: 35, color: '#7c3aed', value: TRIO_DATA.overlaps.userA },
    { id: 'userB', label: 'Jon + talia', count: Math.round(TRIO_DATA.overlaps.userB * dotScale), cx: 250, cy: 135, spread: 16, color: '#0d9488', value: TRIO_DATA.overlaps.userB },
    { id: 'ab', label: 'Jim + talia', count: Math.round(TRIO_DATA.overlaps.ab * dotScale), cx: 210, cy: 260, spread: 15, color: '#0891b2', value: TRIO_DATA.overlaps.ab },
    { id: 'center', label: 'All three', count: Math.round(TRIO_DATA.overlaps.threeWay * dotScale), cx: 190, cy: 190, spread: 14, color: COLORS.center, value: TRIO_DATA.overlaps.threeWay },
  ];

  const [hoveredZone, setHoveredZone] = useState<string | null>(null);

  // Generate dots in a packed circle pattern (Sunflower/Fibonacci)
  const generateDots = (count: number, cx: number, cy: number, spread: number) => {
    const dots: { x: number; y: number }[] = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const r = spread * Math.sqrt(i / count);
      const theta = i * goldenAngle;
      dots.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
    }
    return dots;
  };

  return (
    <div>
      <style>{`
        @keyframes dotAppear {
          from { r: 0; opacity: 0; }
          to { r: 2.5; opacity: 0.85; }
        }
      `}</style>
      <svg viewBox="0 0 420 330" style={{ width: '100%', maxWidth: 540 }}>
        {/* Zone backgrounds (subtle) */}
        {zones.map((zone) => (
          <circle
            key={`bg-${zone.id}`}
            cx={zone.cx} cy={zone.cy} r={zone.spread + 8}
            fill={zone.color} fillOpacity={hoveredZone === zone.id ? 0.08 : 0.03}
            stroke={zone.color} strokeOpacity={hoveredZone === zone.id ? 0.3 : 0.1}
            strokeWidth={1} strokeDasharray={hoveredZone === zone.id ? 'none' : '3,3'}
            style={{ transition: 'all 0.3s ease', cursor: 'pointer' }}
            onMouseEnter={() => setHoveredZone(zone.id)}
            onMouseLeave={() => setHoveredZone(null)}
          />
        ))}

        {/* Dots */}
        {zones.map((zone) => {
          const dots = generateDots(zone.count, zone.cx, zone.cy, zone.spread);
          const isActive = hoveredZone === null || hoveredZone === zone.id;
          return dots.map((dot, i) => (
            <circle
              key={`${zone.id}-${i}`}
              cx={dot.x} cy={dot.y}
              r={2.5}
              fill={zone.color}
              opacity={isActive ? 0.85 : 0.12}
              style={{
                animation: `dotAppear 0.4s ease-out ${i * 0.004}s both`,
                transition: 'opacity 0.3s ease',
                cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredZone(zone.id)}
              onMouseLeave={() => setHoveredZone(null)}
            />
          ));
        })}

        {/* Zone labels */}
        {zones.map((zone) => {
          const isActive = hoveredZone === null || hoveredZone === zone.id;
          return (
            <g key={`label-${zone.id}`} style={{ opacity: isActive ? 1 : 0.3, transition: 'opacity 0.3s' }}>
              <text
                x={zone.cx} y={zone.cy - zone.spread - 14}
                textAnchor="middle" fontSize={9} fontWeight={600}
                fill={zone.color} fontFamily="var(--font-mono)"
              >
                {zone.label}
              </text>
              <text
                x={zone.cx} y={zone.cy - zone.spread - 4}
                textAnchor="middle" fontSize={8}
                fill="var(--color-text-faint)" fontFamily="var(--font-mono)"
              >
                {fmt(zone.value)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Hover info */}
      <div style={{ textAlign: 'center', minHeight: 24, marginTop: 8 }}>
        {hoveredZone && (() => {
          const z = zones.find(z => z.id === hoveredZone)!;
          return (
            <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: z.color, fontWeight: 600 }}>
              {z.label}: {fmt(z.value)} followers ({Math.round((z.value / total) * 100)}% of combined reach)
            </span>
          );
        })()}
      </div>

      {/* Account legend */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 12 }}>
        {[
          { name: 'Jon', color: COLORS.user, size: TRIO_DATA.user.size },
          { name: 'Jim', color: COLORS.a, size: TRIO_DATA.matchA.size },
          { name: 'talia', color: COLORS.b, size: TRIO_DATA.matchB.size },
        ].map(a => (
          <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: a.color }} />
            <span style={{ color: a.color, fontWeight: 600 }}>{a.name}</span>
            <span style={{ color: 'var(--color-text-faint)' }}>{fmt(a.size)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Visualization: Circle of Followers ────────────────────────────────────────
// Calm, circular arrangement. All blue palette. Hover a user to see their followers.

function CircleOfFollowers() {
  const total = TRIO_DATA.totalReach;

  const uniqueUser = TRIO_DATA.user.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.threeWay;
  const uniqueA = TRIO_DATA.matchA.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;
  const uniqueB = TRIO_DATA.matchB.size - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;

  // Segments arranged clockwise around the circle
  // Order: unique-user, user+A overlap, unique-A, A+B overlap, unique-B, user+B overlap
  // Three-way goes in the center
  const segments = [
    { id: 'user', label: 'Only Jon', value: uniqueUser, shade: '#93c5fd', owners: ['user'] },
    { id: 'userA', label: 'Jon & Jim', value: TRIO_DATA.overlaps.userA, shade: '#6366f1', owners: ['user', 'a'] },
    { id: 'a', label: 'Only Jim', value: uniqueA, shade: '#a5b4fc', owners: ['a'] },
    { id: 'ab', label: 'Jim & talia', value: TRIO_DATA.overlaps.ab, shade: '#818cf8', owners: ['a', 'b'] },
    { id: 'b', label: 'Only talia', value: uniqueB, shade: '#c7d2fe', owners: ['b'] },
    { id: 'userB', label: 'Jon & talia', value: TRIO_DATA.overlaps.userB, shade: '#7dd3fc', owners: ['user', 'b'] },
  ];

  const cx = 200, cy = 195;
  const ringRadius = 130;
  const dotR = 2.8;
  const totalRing = segments.reduce((s, seg) => s + seg.value, 0);

  // Build dots around the ring
  type Dot = { x: number; y: number; segment: string; owners: string[]; shade: string; angle: number };
  const dots: Dot[] = [];
  let angleOffset = -Math.PI / 2; // start at top

  for (const seg of segments) {
    const arcLength = (seg.value / totalRing) * Math.PI * 2;
    const dotCount = Math.max(1, Math.round((seg.value / totalRing) * 450));
    for (let i = 0; i < dotCount; i++) {
      const t = i / dotCount;
      const angle = angleOffset + t * arcLength;
      // Add slight radial jitter for organic feel
      const jitter = (Math.sin(i * 7.3) * 0.4 + Math.cos(i * 13.1) * 0.3) * 8;
      const r = ringRadius + jitter;
      dots.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        segment: seg.id,
        owners: seg.owners,
        shade: seg.shade,
        angle,
      });
    }
    angleOffset += arcLength;
  }

  // Center dots for three-way overlap
  const threeWayCount = Math.max(4, Math.round((TRIO_DATA.overlaps.threeWay / totalRing) * 450));
  const centerDots: Dot[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < threeWayCount; i++) {
    const r = 20 * Math.sqrt(i / threeWayCount);
    const theta = i * goldenAngle;
    centerDots.push({
      x: cx + r * Math.cos(theta),
      y: cy + r * Math.sin(theta),
      segment: 'center',
      owners: ['user', 'a', 'b'],
      shade: '#4f46e5',
      angle: theta,
    });
  }

  const [hovered, setHovered] = useState<string | null>('center'); // start with center highlighted

  const accounts = [
    { id: 'user', name: 'Jon', handle: TRIO_DATA.user.handle, size: TRIO_DATA.user.size, shade: '#3b82f6' },
    { id: 'a', name: 'Jim', handle: TRIO_DATA.matchA.handle, size: TRIO_DATA.matchA.size, shade: '#6366f1' },
    { id: 'b', name: 'talia', handle: TRIO_DATA.matchB.handle, size: TRIO_DATA.matchB.size, shade: '#a78bfa' },
  ];

  // Which dots are "active" based on hover?
  const isActive = (dot: Dot) => {
    if (hovered === null) return true;
    if (hovered === 'center') return dot.segment === 'center';
    return dot.owners.includes(hovered);
  };

  // Info text for current hover
  const getHoverInfo = () => {
    if (hovered === null) return { text: `${fmt(total)} unique followers across all three`, color: '#64748b' };
    if (hovered === 'center') return { text: `${fmt(TRIO_DATA.overlaps.threeWay)} follow all three`, color: '#4f46e5' };
    const acc = accounts.find(a => a.id === hovered)!;
    return { text: `${fmt(acc.size)} follow ${acc.name}`, color: acc.shade };
  };

  const info = getHoverInfo();

  return (
    <div>
      <style>{`
        @keyframes circFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes centerPulse {
          0%, 100% { opacity: 0.9; }
          50% { opacity: 0.6; }
        }
      `}</style>

      <svg viewBox="0 0 400 400" style={{ width: '100%', maxWidth: 440 }}>
        {/* Subtle ring guide */}
        <circle cx={cx} cy={cy} r={ringRadius} fill="none" stroke="#e2e8f0" strokeWidth={0.5} />

        {/* Ring dots */}
        {dots.map((dot, i) => {
          const active = isActive(dot);
          return (
            <circle
              key={`ring-${i}`}
              cx={dot.x} cy={dot.y} r={dotR}
              fill={active ? dot.shade : '#e2e8f0'}
              opacity={active ? 0.8 : 0.3}
              style={{
                animation: `circFadeIn 0.5s ease-out ${i * 0.002}s both`,
                transition: 'fill 0.4s ease, opacity 0.4s ease',
              }}
            />
          );
        })}

        {/* Center dots (three-way) */}
        {centerDots.map((dot, i) => {
          const active = isActive(dot);
          return (
            <circle
              key={`center-${i}`}
              cx={dot.x} cy={dot.y} r={dotR}
              fill={active ? dot.shade : '#e2e8f0'}
              opacity={active ? 0.9 : 0.3}
              style={{
                animation: hovered === 'center'
                  ? `centerPulse 2s ease-in-out ${i * 0.05}s infinite`
                  : `circFadeIn 0.4s ease-out ${0.8 + i * 0.01}s both`,
                transition: 'fill 0.4s ease, opacity 0.4s ease',
              }}
            />
          );
        })}

        {/* Center label */}
        <text x={cx} y={cy + 35} textAnchor="middle" fontSize={10} fill="#64748b" fontFamily="var(--font-mono)" style={{ transition: 'fill 0.3s' }}>
          {hovered === 'center' ? fmt(TRIO_DATA.overlaps.threeWay) : ''}
        </text>

        {/* Account buttons around outside */}
        {accounts.map((acc, i) => {
          const angle = -Math.PI / 2 + (i * Math.PI * 2) / 3 + Math.PI / 3;
          const labelR = ringRadius + 36;
          const lx = cx + labelR * Math.cos(angle);
          const ly = cy + labelR * Math.sin(angle);
          const isHov = hovered === acc.id;
          return (
            <g
              key={acc.id}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHovered(acc.id)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Hit area */}
              <circle cx={lx} cy={ly} r={24} fill="transparent" />
              {/* Label bg */}
              <rect
                x={lx - 28} y={ly - 12} width={56} height={24} rx={12}
                fill={isHov ? acc.shade : '#f1f5f9'}
                style={{ transition: 'fill 0.3s ease' }}
              />
              <text x={lx} y={ly + 1} textAnchor="middle" dominantBaseline="central"
                fontSize={11} fontWeight={600}
                fill={isHov ? '#fff' : '#64748b'}
                fontFamily="var(--font-mono)"
                style={{ transition: 'fill 0.3s ease', pointerEvents: 'none' }}
              >
                {acc.name}
              </text>
              {/* Follower count below */}
              <text x={lx} y={ly + 20} textAnchor="middle"
                fontSize={9} fill="#94a3b8" fontFamily="var(--font-mono)"
                style={{ pointerEvents: 'none' }}
              >
                {fmt(acc.size)}
              </text>
            </g>
          );
        })}

        {/* Center tap target */}
        <circle
          cx={cx} cy={cy} r={25} fill="transparent"
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHovered('center')}
          onMouseLeave={() => setHovered(null)}
        />
      </svg>

      {/* Info line */}
      <div style={{
        textAlign: 'center', marginTop: -8,
        fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 600,
        color: info.color,
        minHeight: 24,
        transition: 'color 0.3s ease',
      }}>
        {info.text}
      </div>

      {/* Combined reach */}
      <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
        {fmt(total)} unique combined reach
      </div>
    </div>
  );
}

// ── Visualization 5: Sankey / Flow Diagram ───────────────────────────────────

function SankeyFlow() {
  const uniqueUser = TRIO_DATA.user.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.threeWay;
  const uniqueA = TRIO_DATA.matchA.size - TRIO_DATA.overlaps.userA - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;
  const uniqueB = TRIO_DATA.matchB.size - TRIO_DATA.overlaps.userB - TRIO_DATA.overlaps.ab - TRIO_DATA.overlaps.threeWay;
  const total = TRIO_DATA.totalReach;

  // Left column: the three accounts (sources)
  // Right column: where their followers end up (unique, shared pairs, shared all)
  const leftHeight = 340;
  const rightHeight = 340;
  const leftX = 40;
  const rightX = 520;
  const gap = 6;

  // Left nodes (accounts)
  const leftNodes = [
    { id: 'user', label: 'Jon', sublabel: fmt(TRIO_DATA.user.size), color: COLORS.user, size: TRIO_DATA.user.size },
    { id: 'a', label: 'Jim', sublabel: fmt(TRIO_DATA.matchA.size), color: COLORS.a, size: TRIO_DATA.matchA.size },
    { id: 'b', label: 'talia', sublabel: fmt(TRIO_DATA.matchB.size), color: COLORS.b, size: TRIO_DATA.matchB.size },
  ];
  const leftTotal = leftNodes.reduce((s, n) => s + n.size, 0);

  // Compute left node positions
  const leftNodePositions: { y: number; h: number }[] = [];
  let leftCursor = 0;
  for (const node of leftNodes) {
    const h = (node.size / leftTotal) * (leftHeight - gap * (leftNodes.length - 1));
    leftNodePositions.push({ y: leftCursor, h });
    leftCursor += h + gap;
  }

  // Right nodes (destinations)
  const rightNodes = [
    { id: 'only-user', label: 'Only Jon', value: uniqueUser, color: COLORS.user },
    { id: 'user-a', label: 'Jon + Jim', value: TRIO_DATA.overlaps.userA, color: '#7c3aed' },
    { id: 'all', label: 'All three', value: TRIO_DATA.overlaps.threeWay, color: COLORS.center },
    { id: 'user-b', label: 'Jon + talia', value: TRIO_DATA.overlaps.userB, color: '#0d9488' },
    { id: 'a-b', label: 'Jim + talia', value: TRIO_DATA.overlaps.ab, color: '#0891b2' },
    { id: 'only-a', label: 'Only Jim', value: uniqueA, color: COLORS.a },
    { id: 'only-b', label: 'Only talia', value: uniqueB, color: COLORS.b },
  ];

  const rightNodePositions: { y: number; h: number }[] = [];
  let rightCursor = 0;
  for (const node of rightNodes) {
    const h = Math.max(3, (node.value / total) * (rightHeight - gap * (rightNodes.length - 1)));
    rightNodePositions.push({ y: rightCursor, h });
    rightCursor += h + gap;
  }
  // Scale to fit
  const rightScale = rightHeight / rightCursor;

  for (let i = 0; i < rightNodePositions.length; i++) {
    rightNodePositions[i].y *= rightScale;
    rightNodePositions[i].h *= rightScale;
  }

  // Flows: from left node → right node
  // Track cursor within each left and right node for stacking
  const leftInternalCursors = leftNodePositions.map(n => n.y);
  const rightInternalCursors = rightNodePositions.map(n => n.y);

  // Define flows
  const flowDefs: { leftIdx: number; rightIdx: number; value: number; color: string }[] = [
    // Jon flows
    { leftIdx: 0, rightIdx: 0, value: uniqueUser, color: COLORS.user },
    { leftIdx: 0, rightIdx: 1, value: TRIO_DATA.overlaps.userA, color: '#7c3aed' },
    { leftIdx: 0, rightIdx: 2, value: TRIO_DATA.overlaps.threeWay, color: COLORS.center },
    { leftIdx: 0, rightIdx: 3, value: TRIO_DATA.overlaps.userB, color: '#0d9488' },
    // Jim flows
    { leftIdx: 1, rightIdx: 1, value: TRIO_DATA.overlaps.userA, color: '#7c3aed' },
    { leftIdx: 1, rightIdx: 2, value: TRIO_DATA.overlaps.threeWay, color: COLORS.center },
    { leftIdx: 1, rightIdx: 4, value: TRIO_DATA.overlaps.ab, color: '#0891b2' },
    { leftIdx: 1, rightIdx: 5, value: uniqueA, color: COLORS.a },
    // talia flows
    { leftIdx: 2, rightIdx: 2, value: TRIO_DATA.overlaps.threeWay, color: COLORS.center },
    { leftIdx: 2, rightIdx: 3, value: TRIO_DATA.overlaps.userB, color: '#0d9488' },
    { leftIdx: 2, rightIdx: 4, value: TRIO_DATA.overlaps.ab, color: '#0891b2' },
    { leftIdx: 2, rightIdx: 6, value: uniqueB, color: COLORS.b },
  ];

  // Build flow paths
  const flows = flowDefs.map((f, i) => {
    const leftNode = leftNodePositions[f.leftIdx];
    const rightNode = rightNodePositions[f.rightIdx];
    const leftH = (f.value / leftNodes[f.leftIdx].size) * leftNode.h;
    const rightH = (f.value / rightNodes[f.rightIdx].value) * rightNode.h;

    const ly = leftInternalCursors[f.leftIdx];
    const ry = rightInternalCursors[f.rightIdx];

    leftInternalCursors[f.leftIdx] += leftH;
    rightInternalCursors[f.rightIdx] += rightH;

    const nodeW = 14;
    const x0 = leftX + nodeW;
    const x1 = rightX;
    const midX = (x0 + x1) / 2;

    const path = `M${x0},${ly} C${midX},${ly} ${midX},${ry} ${x1},${ry}
                  L${x1},${ry + rightH} C${midX},${ry + rightH} ${midX},${ly + leftH} ${x0},${ly + leftH} Z`;

    return { path, color: f.color, delay: i * 0.06 };
  });

  const [hoveredFlow, setHoveredFlow] = useState<number | null>(null);

  return (
    <div>
      <style>{`
        @keyframes flowReveal {
          from { opacity: 0; }
          to { opacity: 0.45; }
        }
      `}</style>
      <svg viewBox="0 0 620 360" style={{ width: '100%', maxWidth: 620 }}>
        {/* Flows */}
        {flows.map((flow, i) => (
          <path
            key={i}
            d={flow.path}
            fill={flow.color}
            opacity={hoveredFlow === null ? 0.35 : hoveredFlow === i ? 0.6 : 0.08}
            style={{
              animation: `flowReveal 0.6s ease-out ${flow.delay}s both`,
              transition: 'opacity 0.25s ease',
              cursor: 'pointer',
            }}
            onMouseEnter={() => setHoveredFlow(i)}
            onMouseLeave={() => setHoveredFlow(null)}
          />
        ))}

        {/* Left nodes */}
        {leftNodes.map((node, i) => {
          const pos = leftNodePositions[i];
          return (
            <g key={`left-${i}`}>
              <rect x={leftX} y={pos.y} width={14} height={pos.h} rx={3} fill={node.color} />
              <text x={leftX - 8} y={pos.y + pos.h / 2 - 6} textAnchor="end"
                fontSize={12} fontWeight={700} fill={node.color} fontFamily="var(--font-mono)">
                {node.label}
              </text>
              <text x={leftX - 8} y={pos.y + pos.h / 2 + 8} textAnchor="end"
                fontSize={10} fill="var(--color-text-faint)" fontFamily="var(--font-mono)">
                {node.sublabel}
              </text>
            </g>
          );
        })}

        {/* Right nodes */}
        {rightNodes.map((node, i) => {
          const pos = rightNodePositions[i];
          if (pos.h < 2) return null;
          return (
            <g key={`right-${i}`}>
              <rect x={rightX} y={pos.y} width={14} height={pos.h} rx={3} fill={node.color} />
              <text x={rightX + 22} y={pos.y + pos.h / 2 + 1} dominantBaseline="central"
                fontSize={10} fontWeight={600} fill={node.color} fontFamily="var(--font-mono)">
                {node.label}
              </text>
              <text x={rightX + 22 + (node.label.length * 6.5) + 6} y={pos.y + pos.h / 2 + 1} dominantBaseline="central"
                fontSize={9} fill="var(--color-text-faint)" fontFamily="var(--font-mono)">
                {fmt(node.value)}
              </text>
            </g>
          );
        })}

        {/* Column headers */}
        <text x={leftX + 7} y={-8} textAnchor="middle" fontSize={10} fill="var(--color-text-faint)" fontFamily="var(--font-sans)" fontWeight={500}>
          Accounts
        </text>
        <text x={rightX + 7} y={-8} textAnchor="middle" fontSize={10} fill="var(--color-text-faint)" fontFamily="var(--font-sans)" fontWeight={500}>
          Audience Segments
        </text>
      </svg>

      {/* Hover info */}
      <div style={{ textAlign: 'center', minHeight: 20, marginTop: 8 }}>
        {hoveredFlow !== null && (() => {
          const f = flowDefs[hoveredFlow];
          const leftName = leftNodes[f.leftIdx].label;
          const rightName = rightNodes[f.rightIdx].label;
          return (
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: f.color, fontWeight: 600 }}>
              {fmt(f.value)} of {leftName}&apos;s followers → {rightName}
            </span>
          );
        })()}
      </div>
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
        Six ways to visualize the same data: Jon + Jim Waterson + talia jane
      </p>

      {/* Card wrapper */}
      {[
        { title: '⭐ Circle of Followers', desc: 'Calm, circular ring of dots in blue tones. "All three" glows on load. Hover each name to see their followers light up around the ring.', component: <CircleOfFollowers /> },
        { title: '1a. Particle Dots (Organic)', desc: 'Each dot = a cluster of followers. Shared followers drift to the center. Animated on load.', component: <ParticleDots /> },
        { title: '1b. Particle Dots (Structured)', desc: 'Same concept but with clear zones, Fibonacci dot packing, hover to highlight each segment. More readable.', component: <ParticleDotsStructured /> },
        { title: '2. Sankey Flow', desc: 'Accounts on the left, audience segments on the right. Hover flows to see where each account\'s followers end up.', component: <SankeyFlow /> },
        { title: '3. Concentric Rings', desc: 'Radar-like arcs per account. Inner ring = shared followers. Outer arcs = proportional reach.', component: <ConcentricRings /> },
        { title: '4. Waffle Grid', desc: 'Each square ≈ 318 followers. Hover to highlight segments. Very infographic-y and screenshot-friendly.', component: <WaffleGrid /> },
        { title: '5. Proportional Bar', desc: 'One bar, all segments. Clean, mobile-friendly, instantly readable. Hover for details.', component: <ProportionalBar /> },
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
