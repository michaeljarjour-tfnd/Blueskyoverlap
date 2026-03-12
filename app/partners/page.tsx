'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatFollowers } from '@/lib/analysis/interpret';

// ── Types ────────────────────────────────────────────────────────────────────

interface PartnerMatch {
  did: string;
  handle: string;
  displayName: string;
  geography?: string;
  overlapCount: number;
  jaccard: number;
  overlapLevel: 'high' | 'medium' | 'low';
  newForYou: number;
  newForThem: number;
  theirFollowerCount: number;
  compositeScore: number;
  signals: {
    sizeMatch: boolean;
    topicMatch: boolean;
    geoMatch: boolean;
  };
}

interface APIResponse {
  user: {
    did: string;
    handle: string;
    followerCount: number;
    sampleSize?: number;
  };
  matches: PartnerMatch[];
  totalJournalists: number;
  comparedCount: number;
}

interface NoCacheResponse {
  error: 'no_cache';
  user: {
    did: string;
    handle: string;
    followerCount: number;
  };
}

interface PartnerResults {
  user: APIResponse['user'];
  matches: PartnerMatch[];
  comparedAgainst: number;
}

interface DirectoryStats {
  totalJournalists: number;
  topics: string[];
  geographies: string[];
}

type Phase = 'idle' | 'loading' | 'results' | 'error' | 'no-cache';

// ── Overlap level styling ──────────────────────────────────────────────────

const LEVEL_STYLES = {
  high:   { label: 'High overlap',   color: 'var(--color-navy)', barColor: 'var(--color-navy)' },
  medium: { label: 'Medium overlap', color: 'var(--color-blue)',  barColor: 'var(--color-blue)' },
  low:    { label: 'Low overlap',    color: 'var(--color-text-faint)', barColor: '#cbd5e1' },
} as const;

// ── Loading messages ────────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  'Cross-referencing audiences...',
  'Checking the rolodex...',
  'Finding your best matches...',
  'Scanning the directory...',
  'Crunching the numbers...',
];

function useRotatingMessage(active: boolean, interval = 2500): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, interval);
    return () => clearInterval(id);
  }, [active, interval]);
  return LOADING_MESSAGES[index];
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header() {
  return (
    <div
      style={{
        marginBottom: 48,
        paddingBottom: 32,
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/trustfnd-logo.svg"
        alt="Trustfnd"
        style={{ height: 22, width: 'auto', marginBottom: 20, display: 'block' }}
      />
      <h1
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 42,
          fontWeight: 700,
          color: 'var(--color-navy)',
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          margin: '0 0 10px',
        }}
      >
        Find Your Match
      </h1>
      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 15,
          maxWidth: 540,
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        See which journalists share your audience — and where the
        biggest growth opportunities are.
      </p>
    </div>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer
      style={{
        marginTop: 64,
        paddingTop: 24,
        borderTop: '1px solid var(--color-border)',
        textAlign: 'left',
      }}
    >
      <p
        style={{
          fontSize: 12,
          color: 'var(--color-text-faint)',
          margin: 0,
          lineHeight: 1.6,
        }}
      >
        Created by Trustfnd. Collaborative growth for independent journalism.
      </p>
    </footer>
  );
}

// ── Signal badge ─────────────────────────────────────────────────────────────

function SignalBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 500,
        background: '#EBF2FD',
        color: 'var(--color-blue)',
        marginRight: 4,
      }}
    >
      {label}
    </span>
  );
}

// ── Match card ──────────────────────────────────────────────────────────────

function MatchCard({ match, rank, userHandle }: {
  match: PartnerMatch;
  rank: number;
  userHandle: string;
}) {
  const level = LEVEL_STYLES[match.overlapLevel];
  const jaccardPct = (match.jaccard * 100).toFixed(1);
  // Scale bar: 20% Jaccard = full bar (most overlaps are small)
  const barWidth = Math.min((match.jaccard / 0.20) * 100, 100);

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: '20px 22px',
        marginBottom: 12,
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-blue)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
    >
      {/* Name + level */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-faint)', fontWeight: 500, flexShrink: 0 }}>
              #{rank}
            </span>
            <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--color-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {match.displayName || match.handle}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-text-faint)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            @{match.handle}
            {match.geography && (
              <span style={{ marginLeft: 8, fontSize: 11 }}>· {match.geography}</span>
            )}
          </div>
          {/* Match signals */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {match.signals.sizeMatch && <SignalBadge label="Similar size" />}
            {match.signals.topicMatch && <SignalBadge label="Topic match" />}
            {match.signals.geoMatch && <SignalBadge label="Same region" />}
          </div>
        </div>

        {/* Level badge */}
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: level.color,
          padding: '4px 10px',
          borderRadius: 3,
          background: match.overlapLevel === 'high' ? '#EBF2FD' : match.overlapLevel === 'medium' ? '#f0f4ff' : '#f8f9fa',
          flexShrink: 0,
          letterSpacing: '0.02em',
        }}>
          {level.label}
        </span>
      </div>

      {/* Similarity bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Audience overlap
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: level.color }}>
            {jaccardPct}%
          </span>
        </div>
        <div style={{ background: '#f1f5f9', borderRadius: 999, height: 5, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${barWidth}%`, background: level.barColor, borderRadius: 999, transition: 'width 0.4s ease' }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 4 }}>
          {match.overlapCount.toLocaleString()} shared followers
        </div>
      </div>

      {/* New audience potential */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
        padding: '12px 14px',
        background: '#f8fafc',
        borderRadius: 4,
        border: '1px solid #f1f5f9',
      }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginBottom: 3, lineHeight: 1.3 }}>
            New audience for you
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            {formatFollowers(match.newForYou)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
            of their {formatFollowers(match.theirFollowerCount)} followers
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginBottom: 3, lineHeight: 1.3 }}>
            New audience for them
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            {formatFollowers(match.newForThem)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
            of your followers
          </div>
        </div>
      </div>

      {/* Deep dive link */}
      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <a
          href={`/?handles=${encodeURIComponent(userHandle)},${encodeURIComponent(match.handle)}`}
          style={{
            fontSize: 12,
            color: 'var(--color-blue)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Run full analysis →
        </a>
      </div>
    </div>
  );
}

// ── Results view ────────────────────────────────────────────────────────────

function ResultsView({
  results,
  onReset,
}: {
  results: PartnerResults;
  onReset: () => void;
}) {
  return (
    <div>
      {/* Summary strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 16px',
          background: '#fff',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-navy)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500 }}>@{results.user.handle}</span>
          <span style={{ padding: '2px 7px', borderRadius: 3, background: '#EBF2FD', color: 'var(--color-blue)', fontSize: 11, fontWeight: 600 }}>
            {formatFollowers(results.user.followerCount)} followers
          </span>
          <span style={{ color: 'var(--color-text-faint)', fontSize: 11 }}>
            · {results.comparedAgainst} journalists compared
          </span>
        </div>
        <button onClick={onReset} className="btn-ghost" style={{ marginTop: 0 }}>
          New Search
        </button>
      </div>

      {/* Match list */}
      {results.matches.length > 0 ? (
        results.matches.map((match, i) => (
          <MatchCard
            key={match.did}
            match={match}
            rank={i + 1}
            userHandle={results.user.handle}
          />
        ))
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-navy)', marginBottom: 8 }}>
            No matches found yet
          </div>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            The directory is still growing — check back soon as more journalists are added.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Inline analysis trigger ─────────────────────────────────────────────────

function NoCacheView({
  user,
  onReset,
}: {
  user: NoCacheResponse['user'] | null;
  onReset: () => void;
}) {
  const followerCount = user?.followerCount ?? 0;
  const estimateMinutes = followerCount > 50000 ? '5-10' : followerCount > 10000 ? '2-3' : '1-2';

  return (
    <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, padding: '40px 28px', textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-navy)', marginBottom: 10 }}>
        Almost there!
      </div>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', maxWidth: 440, margin: '0 auto 8px', lineHeight: 1.6 }}>
        We found{' '}
        {user ? (
          <strong>@{user.handle}</strong>
        ) : (
          'your account'
        )}
        {followerCount > 0 && ` (${formatFollowers(followerCount)} followers)`}
        , but we haven&apos;t analyzed your followers yet.
      </p>
      <p style={{ fontSize: 13, color: 'var(--color-text-faint)', maxWidth: 440, margin: '0 auto 24px', lineHeight: 1.5 }}>
        We need to fetch your followers first so we can compare them against our journalist directory. This takes about <strong>{estimateMinutes} minutes</strong>.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        {user && (
          <a
            href={`/?handles=${encodeURIComponent(user.handle)}&autostart=quick`}
            style={{
              display: 'inline-block',
              padding: '12px 24px',
              background: 'var(--color-navy)',
              color: '#F8FFFF',
              borderRadius: 4,
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              fontFamily: 'var(--font-sans)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--color-blue)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'var(--color-navy)'; }}
          >
            Start Analysis (~{estimateMinutes} min)
          </a>
        )}
        <button onClick={onReset} className="btn-ghost">
          Try another handle
        </button>
      </div>
    </div>
  );
}

// ── Single select with custom option ─────────────────────────────────────────

function ComboSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [isCustom, setIsCustom] = useState(false);

  return (
    <div className="input-group" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      {!isCustom ? (
        <select
          className="handle-input"
          value={value}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setIsCustom(true);
              onChange('');
            } else {
              onChange(e.target.value);
            }
          }}
          style={{ cursor: 'pointer' }}
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
          <option value="__custom__">+ Add new…</option>
        </select>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="handle-input"
            type="text"
            placeholder="Type your own…"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoFocus
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => { setIsCustom(false); onChange(''); }}
            className="btn-ghost"
            style={{ padding: '6px 10px', fontSize: 12, marginTop: 0 }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ── Multi-select topic picker ────────────────────────────────────────────────

function TopicMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [customValue, setCustomValue] = useState('');

  const toggleTopic = (topic: string) => {
    if (selected.includes(topic)) {
      onChange(selected.filter((t) => t !== topic));
    } else {
      onChange([...selected, topic]);
    }
  };

  const addCustom = () => {
    const trimmed = customValue.trim();
    if (trimmed && !selected.includes(trimmed)) {
      onChange([...selected, trimmed]);
    }
    setCustomValue('');
    setIsAdding(false);
  };

  return (
    <div className="input-group" style={{ marginBottom: 0 }}>
      <label>Your topics</label>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '10px 12px',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        background: '#fff',
        minHeight: 40,
      }}>
        {options.map((topic) => {
          const active = selected.includes(topic);
          return (
            <button
              key={topic}
              type="button"
              onClick={() => toggleTopic(topic)}
              style={{
                display: 'inline-block',
                padding: '4px 10px',
                borderRadius: 3,
                fontSize: 12,
                fontWeight: 500,
                border: '1px solid',
                borderColor: active ? 'var(--color-blue)' : 'var(--color-border)',
                background: active ? '#EBF2FD' : '#fff',
                color: active ? 'var(--color-blue)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                transition: 'all 0.1s',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {active && '✓ '}{topic}
            </button>
          );
        })}
        {/* Custom topics that aren't in the predefined list */}
        {selected.filter((t) => !options.includes(t)).map((topic) => (
          <button
            key={topic}
            type="button"
            onClick={() => toggleTopic(topic)}
            style={{
              display: 'inline-block',
              padding: '4px 10px',
              borderRadius: 3,
              fontSize: 12,
              fontWeight: 500,
              border: '1px solid var(--color-blue)',
              background: '#EBF2FD',
              color: 'var(--color-blue)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            ✓ {topic}
          </button>
        ))}
        {/* Add custom button / input */}
        {!isAdding ? (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            style={{
              display: 'inline-block',
              padding: '4px 10px',
              borderRadius: 3,
              fontSize: 12,
              fontWeight: 500,
              border: '1px dashed var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-faint)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            + Add new
          </button>
        ) : (
          <input
            type="text"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
              if (e.key === 'Escape') { setIsAdding(false); setCustomValue(''); }
            }}
            onBlur={addCustom}
            autoFocus
            placeholder="Type topic…"
            style={{
              width: 110,
              padding: '4px 8px',
              borderRadius: 3,
              fontSize: 12,
              border: '1px solid var(--color-blue)',
              outline: 'none',
              fontFamily: 'var(--font-sans)',
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function PartnersPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [handle, setHandle] = useState('');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedGeo, setSelectedGeo] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [geographies, setGeographies] = useState<string[]>([]);
  const [results, setResults] = useState<PartnerResults | null>(null);
  const [noCacheUser, setNoCacheUser] = useState<NoCacheResponse['user'] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadingMessage = useRotatingMessage(phase === 'loading');

  // Fetch directory stats for dropdowns
  useEffect(() => {
    fetch('/api/directory?stats=true')
      .then((r) => r.json())
      .then((data: DirectoryStats) => {
        if (data.topics?.length) setTopics(data.topics.sort());
        if (data.geographies?.length) setGeographies(data.geographies.sort());
      })
      .catch(() => {});
  }, []);

  const cleanHandle = (input: string): string => {
    const trimmed = input.trim().replace(/^@/, '');
    const profileMatch = trimmed.match(/bsky\.app\/profile\/([^/?#]+)/);
    if (profileMatch) return profileMatch[1];
    return trimmed;
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const clean = cleanHandle(handle);
      if (!clean) return;

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setPhase('loading');
      setResults(null);
      setNoCacheUser(null);
      setErrorMsg(null);

      try {
        const params = new URLSearchParams({ handle: clean, limit: '30' });
        if (selectedTopics.length > 0) params.set('topics', selectedTopics.join(','));
        if (selectedGeo) params.set('geography', selectedGeo);

        const res = await fetch(`/api/partners?${params.toString()}`, {
          signal: ctrl.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));

          if ((body as NoCacheResponse).error === 'no_cache') {
            setNoCacheUser((body as NoCacheResponse).user || null);
            setPhase('no-cache');
            return;
          }

          const msg = (body as { error?: string }).error ?? res.statusText;
          if (msg.toLowerCase().includes('not found')) {
            throw new Error(`Could not find Bluesky account: ${clean}`);
          }
          throw new Error(msg);
        }

        const data = (await res.json()) as APIResponse;
        setResults({
          user: data.user,
          matches: data.matches,
          comparedAgainst: data.comparedCount,
        });
        setPhase('results');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setErrorMsg((err as Error).message ?? 'Something went wrong');
        setPhase('error');
      }
    },
    [handle, selectedTopics, selectedGeo]
  );

  const handleReset = () => {
    abortRef.current?.abort();
    setPhase('idle');
    setResults(null);
    setNoCacheUser(null);
    setErrorMsg(null);
  };

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 64px' }}>
      <Header />

      {/* ── Input form ─────────────────────────────────────────────────────── */}
      {phase === 'idle' && (
        <form onSubmit={handleSubmit} className="card">
          <h2>Who are you?</h2>

          <div className="input-group">
            <label>Your Bluesky handle</label>
            <input
              className="handle-input"
              type="text"
              placeholder="e.g. yourname.bsky.social"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <p className="tip">
            Paste your handle or a full Bluesky profile URL.
          </p>

          {(topics.length > 0 || geographies.length > 0) && (
            <>
              <hr className="divider" />
              <p style={{
                fontSize: 13,
                color: 'var(--color-text-muted)',
                margin: '0 0 14px',
                lineHeight: 1.5,
              }}>
                Add your topic and location to improve your matches.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {topics.length > 0 && (
                  <TopicMultiSelect
                    options={topics}
                    selected={selectedTopics}
                    onChange={setSelectedTopics}
                  />
                )}
                {geographies.length > 0 && (
                  <ComboSelect
                    label="Your location"
                    options={geographies}
                    value={selectedGeo}
                    onChange={setSelectedGeo}
                    placeholder="Select location…"
                  />
                )}
              </div>
            </>
          )}

          <button type="submit" className="btn" disabled={!handle.trim()} style={{ marginTop: 20 }}>
            Find Matches
          </button>
        </form>
      )}

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {phase === 'loading' && (
        <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, padding: '48px 32px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 20 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--color-blue)',
                  animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-navy)', marginBottom: 6 }}>
            {loadingMessage}
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-faint)', margin: 0 }}>
            This usually takes a few seconds
          </p>
          <style>{`
            @keyframes pulse-dot {
              0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
              40% { transform: scale(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {/* ── No cached followers ────────────────────────────────────────────── */}
      {phase === 'no-cache' && (
        <NoCacheView user={noCacheUser} onReset={handleReset} />
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {phase === 'error' && (
        <div className="alert alert-error">
          <strong>Error:</strong> {errorMsg}
          <div style={{ marginTop: 12 }}>
            <button onClick={handleReset} className="btn-ghost">Try again</button>
          </div>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {phase === 'results' && results && (
        <ResultsView results={results} onReset={handleReset} />
      )}

      <Footer />
    </main>
  );
}
