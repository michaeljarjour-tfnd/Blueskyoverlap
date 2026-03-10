'use client';

import { useEffect, useRef, useState } from 'react';
import type { SpeedTier } from '@/lib/types';

interface Props {
  onSubmit: (handles: string[], speedTier: SpeedTier) => void;
  loading: boolean;
}

const TIER_INFO: Record<SpeedTier, { label: string; desc: string; time: string; recommended?: boolean }> = {
  quick:    { label: 'Quick',    desc: '2K followers + 50 posts · ±2% accuracy',  time: '~60s',   recommended: true },
  balanced: { label: 'Balanced', desc: '5K followers + 100 posts · ±1% accuracy', time: '~2 min' },
  complete: { label: 'Complete', desc: 'All followers + 200 posts · exact',        time: '5+ min' },
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
    // Normalize any old URL-format entries to plain handles, then deduplicate
    const normalized = [...new Set(raw.map(extractHandle).filter(Boolean))];
    // Write back cleaned version so stale data doesn't persist
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
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (handles.length < 10) setHandles((prev) => [...prev, '']);
  };

  const removeHandle = (i: number) => {
    if (handles.length <= 2) return;
    setHandles((prev) => prev.filter((_, idx) => idx !== i));
    if (activeDropdown === i) setActiveDropdown(null);
  };

  const selectFromDropdown = (i: number, handle: string) => {
    updateHandle(i, handle);
    setActiveDropdown(null);
  };

  const handleFocus = (i: number) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setActiveDropdown(i);
  };

  const handleBlur = () => {
    // Delay close so click on dropdown item fires first
    closeTimerRef.current = setTimeout(() => setActiveDropdown(null), 150);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    // Extract handles (strip URLs, @-prefixes) before saving/submitting
    const valid = handles
      .map((h) => extractHandle(h))
      .filter(Boolean);
    if (valid.length < 2) return;
    // Check for duplicates
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

  // For each input, the suggestions are recents not already used in ANY other input
  const extractedHandles = handles.map((h) => extractHandle(h).toLowerCase());

  const getSuggestions = (i: number): string[] => {
    const othersSet = new Set(
      extractedHandles.filter((h, idx) => idx !== i && h.length > 0)
    );
    return recentHandles.filter((h) => !othersSet.has(h.toLowerCase()));
  };

  return (
    <form onSubmit={handleSubmit} className="card">
      <h2>Enter Bluesky Handles</h2>

      {/* Dynamic handle inputs */}
      <div style={{ marginBottom: 16 }}>
        {handles.map((handle, i) => {
          const suggestions = getSuggestions(i);
          const isOpen = activeDropdown === i && suggestions.length > 0;

          return (
            <div key={i} className="input-group" style={{ marginBottom: i < handles.length - 1 ? 12 : 0, position: 'relative' }}>
              <label>
                Account {i + 1}
                {i >= 2 && (
                  <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}> (optional)</span>
                )}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    className="handle-input"
                    type="text"
                    placeholder="e.g. someone.bsky.social"
                    value={handle}
                    onChange={(e) => updateHandle(i, e.target.value)}
                    onFocus={() => handleFocus(i)}
                    onBlur={handleBlur}
                    disabled={loading}
                    autoComplete="off"
                    spellCheck={false}
                    style={{ width: '100%' }}
                  />
                  {isOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: 2,
                        background: '#fff',
                        border: '1px solid var(--color-border)',
                        borderRadius: 4,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                        zIndex: 200,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          color: 'var(--color-text-faint)',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          padding: '6px 10px 4px',
                          borderBottom: '1px solid var(--color-border)',
                        }}
                      >
                        Recent
                      </div>
                      {suggestions.map((h) => (
                        <button
                          key={h}
                          type="button"
                          onMouseDown={(e) => {
                            // Use mousedown so it fires before blur
                            e.preventDefault();
                            selectFromDropdown(i, h);
                          }}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '7px 10px',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 13,
                            color: 'var(--color-navy)',
                            borderBottom: '1px solid var(--color-border)',
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = '#F4F8FC';
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = '#fff';
                          }}
                        >
                          {h}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
          );
        })}
      </div>

      {handles.length < 10 && (
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
          + Add account ({handles.length}/10)
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
          Complete mode fetches all followers. For accounts with 50K+ followers this may exceed the 60-second serverless timeout.
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
