'use client';

import { useEffect, useState } from 'react';
import type { SpeedTier } from '@/lib/types';
import HandleTypeahead from './HandleTypeahead';

interface Props {
  onSubmit: (handles: string[], speedTier: SpeedTier) => void;
  loading: boolean;
}

const TIER_INFO: Record<SpeedTier, { label: string; desc: string; time: string; recommended?: boolean }> = {
  quick:    { label: 'Quick',    desc: 'Great for a fast snapshot',               time: '~60s',   recommended: true },
  balanced: { label: 'Balanced', desc: 'More accurate, still fast',               time: '~2 min' },
  complete: { label: 'Complete', desc: 'Exact results — best for deep dives',     time: '5+ min' },
};

const STORAGE_KEY = 'bsky-recent-handles';
const MAX_RECENT = 10;

// Inline handle extraction (mirrors server-side extractHandle)
function extractHandle(input: string): string {
  const trimmed = input.trim().replace(/^@/, '');
  const profileMatch = trimmed.match(/bsky\.app\/profile\/([^/?#]+)/);
  if (profileMatch) return profileMatch[1];
  return trimmed;
}

function loadRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    const normalized = [...new Set(raw.map(extractHandle).filter(Boolean))];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return [];
  }
}

function saveRecent(handles: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(handles));
  } catch {
    // Storage full or unavailable — non-fatal
  }
}

function addToRecent(newHandles: string[]) {
  const existing = loadRecent();
  const merged = [
    ...newHandles,
    ...existing.filter((h) => !newHandles.includes(h)),
  ].slice(0, MAX_RECENT);
  saveRecent(merged);
  return merged;
}

export default function AnalysisForm({ onSubmit, loading }: Props) {
  const [handles, setHandles] = useState<string[]>(['', '']);
  const [speedTier, setSpeedTier] = useState<SpeedTier>('quick');
  const [recentHandles, setRecentHandles] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setRecentHandles(loadRecent());
  }, []);

  const updateHandle = (i: number, value: string) => {
    setFormError(null);
    setHandles((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  };

  const addHandle = () => {
    if (handles.length < 5) setHandles((prev) => [...prev, '']);
  };

  const removeHandle = (i: number) => {
    if (handles.length <= 2) return;
    setHandles((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const valid = handles
      .map((h) => extractHandle(h))
      .filter(Boolean);
    if (valid.length < 2) return;
    const unique = new Set(valid.map((h) => h.toLowerCase()));
    if (unique.size < valid.length) {
      setFormError('Please enter different handles — duplicates will not produce useful results.');
      return;
    }
    const updated = addToRecent(valid);
    setRecentHandles(updated);
    onSubmit(valid, speedTier);
  };

  const validCount = handles.filter((h) => h.trim()).length;

  // Build exclude set: handles already entered in other inputs
  const extractedHandles = handles.map((h) => extractHandle(h).toLowerCase());

  const getExcludeSet = (i: number): Set<string> => {
    return new Set(
      extractedHandles.filter((h, idx) => idx !== i && h.length > 0)
    );
  };

  const getRecentForInput = (i: number): string[] => {
    const excludes = getExcludeSet(i);
    return recentHandles.filter((h) => !excludes.has(h.toLowerCase()));
  };

  return (
    <form onSubmit={handleSubmit} className="card">
      <h2>Enter Bluesky Handles</h2>

      {/* Dynamic handle inputs */}
      <div style={{ marginBottom: 16 }}>
        {handles.map((handle, i) => (
          <div key={i} className="input-group" style={{ marginBottom: i < handles.length - 1 ? 12 : 0, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <HandleTypeahead
                value={handle}
                onChange={(val) => updateHandle(i, val)}
                onSelect={(h) => updateHandle(i, h)}
                disabled={loading}
                recentHandles={getRecentForInput(i)}
                excludeHandles={getExcludeSet(i)}
                label={`Account ${i + 1}`}
                optional={i >= 2}
              />
              {handles.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeHandle(i)}
                  disabled={loading}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-faint)',
                    fontSize: 20,
                    lineHeight: 1,
                    padding: '0 4px',
                    flexShrink: 0,
                  }}
                  aria-label="Remove"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {handles.length < 5 && (
        <button
          type="button"
          onClick={addHandle}
          disabled={loading}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-blue)',
            fontSize: 13,
            fontWeight: 500,
            padding: 0,
            marginBottom: 16,
            fontFamily: 'var(--font-sans)',
          }}
        >
          + Add account ({handles.length}/5)
        </button>
      )}

      <p className="tip">Paste a handle (e.g. username.bsky.social) or a full profile URL.</p>

      <hr className="divider" />

      {/* Speed tier */}
      <div className="section-label">Analysis depth</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {(Object.keys(TIER_INFO) as SpeedTier[]).map((tier) => {
          const selected = speedTier === tier;
          return (
            <div
              key={tier}
              onClick={() => !loading && setSpeedTier(tier)}
              style={{
                border: `1px solid ${selected ? 'var(--color-blue)' : 'var(--color-border)'}`,
                borderRadius: 4,
                padding: '12px 14px',
                cursor: loading ? 'not-allowed' : 'pointer',
                background: selected ? '#EBF2FD' : 'var(--color-bg-light)',
                transition: 'border-color 0.15s, background 0.15s',
                position: 'relative',
              }}
            >
              {TIER_INFO[tier].recommended && (
                <div
                  style={{
                    position: 'absolute',
                    top: -8,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    background: 'var(--color-blue)',
                    color: '#F8FFFF',
                    padding: '1px 6px',
                    borderRadius: 3,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Recommended
                </div>
              )}
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-navy)' }}>
                {TIER_INFO[tier].label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--color-blue)',
                  fontFamily: 'var(--font-mono)',
                  marginTop: 1,
                }}
              >
                {TIER_INFO[tier].time}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 3 }}>
                {TIER_INFO[tier].desc}
              </div>
            </div>
          );
        })}
      </div>

      {speedTier === 'complete' && (
        <div className="alert alert-info" style={{ marginTop: 8 }}>
          Complete mode analyzes every follower. For very large accounts (50K+) this can take a while — if it times out, just run it again. It picks up where it left off.
        </div>
      )}

      {formError && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          {formError}
        </div>
      )}

      <button
        type="submit"
        className="btn"
        disabled={loading || validCount < 2}
      >
        {loading ? 'Analyzing…' : 'Analyze Overlap'}
      </button>
    </form>
  );
}
