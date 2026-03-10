import type { Interpretation } from '@/lib/types';

/** Ported verbatim from index.html. Thresholds are Jaccard % (0–100). */
export function getInterpretation(jaccard: number): Interpretation {
  if (jaccard > 40) return { label: 'Very High', color: '#034EAD', emoji: '' };
  if (jaccard > 20) return { label: 'High', color: '#034EAD', emoji: '' };
  if (jaccard > 10) return { label: 'Moderate', color: '#5a6a7a', emoji: '' };
  if (jaccard > 3) return { label: 'Low', color: '#5a6a7a', emoji: '' };
  return { label: 'Minimal', color: '#8a9ab0', emoji: '' };
}

/** Round numbers for display — ported verbatim from index.html. */
export function smartRound(n: number): number {
  if (n < 10) return Math.round(n);
  if (n < 100) return Math.round(n / 5) * 5;
  if (n < 1000) return Math.round(n / 10) * 10;
  if (n < 10000) return Math.round(n / 100) * 100;
  return Math.round(n / 1000) * 1000;
}

/** Human-readable follower count (e.g. 12.3K, 1.1M). */
export function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
