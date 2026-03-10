'use client';

import { useState } from 'react';
import type { BskyProfile, PairwiseOverlap } from '@/lib/types';
import { getInterpretation } from '@/lib/analysis/interpret';

interface Props {
  profiles: BskyProfile[];
  pairwiseOverlaps: PairwiseOverlap[];
}

function jaccardColor(jaccard: number): { bg: string; text: string } {
  if (jaccard > 40) return { bg: '#1a3a6e', text: '#fff' };
  if (jaccard > 20) return { bg: '#034EAD', text: '#fff' };
  if (jaccard > 10) return { bg: '#5b8fd9', text: '#fff' };
  if (jaccard > 3) return { bg: '#B8D0F0', text: '#04182B' };
  return { bg: '#E3EBF3', text: '#5a6a7a' };
}

export default function HeatmapMatrix({ profiles, pairwiseOverlaps }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const overlapMap = new Map<string, PairwiseOverlap>();
  for (const o of pairwiseOverlaps) {
    overlapMap.set(`${o.account1.did}-${o.account2.did}`, o);
    overlapMap.set(`${o.account2.did}-${o.account1.did}`, o);
  }

  const n = profiles.length;
  const cellSize = Math.min(64, Math.floor((Math.min(600, window?.innerWidth ?? 600) - 80) / n));

  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{
          display: 'inline-grid',
          gridTemplateColumns: `80px repeat(${n}, ${cellSize}px)`,
          gap: 4,
          fontSize: 11,
        }}
      >
        {/* Top header row */}
        <div />
        {profiles.map((p, j) => (
          <div
            key={j}
            style={{
              width: cellSize,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-muted)',
              fontSize: 10,
              textAlign: 'center',
              paddingBottom: 4,
            }}
            title={`@${p.handle}`}
          >
            @{p.handle.split('.')[0]}
          </div>
        ))}

        {/* Data rows */}
        {profiles.map((rowProfile, i) => (
          <>
            {/* Row label */}
            <div
              key={`label-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`@${rowProfile.handle}`}
            >
              @{rowProfile.handle.split('.')[0]}
            </div>

            {/* Cells */}
            {profiles.map((colProfile, j) => {
              if (i === j) {
                // Diagonal — self
                return (
                  <div
                    key={`cell-${i}-${j}`}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: 6,
                      background: 'var(--color-bg-light)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      color: 'var(--color-text-faint)',
                    }}
                  >
                    —
                  </div>
                );
              }

              const overlap = overlapMap.get(`${rowProfile.did}-${colProfile.did}`);
              if (!overlap) {
                return (
                  <div
                    key={`cell-${i}-${j}`}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: 6,
                      background: 'var(--color-bg-light)',
                    }}
                  />
                );
              }

              const jaccard = overlap.followerJaccard;
              const { bg, text } = jaccardColor(jaccard);
              const cellId = overlap.id;
              const isHovered = hovered === cellId;
              const interp = getInterpretation(jaccard);

              return (
                <div
                  key={`cell-${i}-${j}`}
                  className="heatmap-cell"
                  style={{
                    width: cellSize,
                    height: cellSize,
                    background: bg,
                    color: text,
                    transform: isHovered ? 'scale(1.08)' : 'scale(1)',
                    boxShadow: isHovered ? '0 2px 12px rgba(3,78,173,0.25)' : 'none',
                    position: 'relative',
                  }}
                  onMouseEnter={() => setHovered(cellId)}
                  onMouseLeave={() => setHovered(null)}
                  title={`@${overlap.account1.handle} × @${overlap.account2.handle}: ${jaccard.toFixed(1)}% (${interp.label})`}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {jaccard < 1
                      ? jaccard.toFixed(1)
                      : Math.round(jaccard)}%
                  </span>
                </div>
              );
            })}
          </>
        ))}
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginTop: 12,
          flexWrap: 'wrap',
          fontSize: 11,
          color: 'var(--color-text-faint)',
        }}
      >
        {[
          { color: '#1a3a6e', label: 'Very High (>40%)', text: '#fff' },
          { color: '#034EAD', label: 'High (20-40%)', text: '#fff' },
          { color: '#5b8fd9', label: 'Moderate (10-20%)', text: '#fff' },
          { color: '#B8D0F0', label: 'Low (3-10%)', text: '#04182B' },
          { color: '#E3EBF3', label: 'Minimal (<3%)', text: '#5a6a7a' },
        ].map(({ color, label, text }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: color,
                flexShrink: 0,
              }}
            />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
