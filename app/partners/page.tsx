'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatFollowers } from '@/lib/analysis/interpret';

// ── Types ────────────────────────────────────────────────────────────────────

interface PartnerMatch {
  did: string;
  handle: string;
  displayName: string;
  topics: string[];
  geography?: string;
  overlapCount: number;
  overlapPercent: number;
  matchType: string;
  matchConfidence: number;
}

interface APIResponse {
  user: {
    did: string;
    handle: string;
    followerCount: number;
  };
  matches: PartnerMatch[];
  totalJournalists: number;
  comparedCount: number;
}

interface PartnerResults {
  user: APIResponse['user'];
  matches: PartnerMatch[];
  comparedAgainst: number;
}

interface DirectoryStats {
  totalJournalists: number;
  topics: string[];
}

type Phase = 'idle' | 'loading' | 'results' | 'error' | 'no-cache';

// ── Match tier logic ────────────────────────────────────────────────────────

interface MatchTier {
  name: string;
  color: string;
  bg: string;
  border: string;
  barColor: string;
  description: string;
}

function getMatchTier(overlapPct: number): MatchTier {
  if (overlapPct > 25) {
    return {
      name: 'Woodward & Bernstein',
      color: '#92400e',
      bg: '#fffbeb',
      border: '#fbbf24',
      barColor: '#f59e0b',
      description:
        "You're basically sharing a newsroom. Your audiences overlap so much, a collab would be unstoppable.",
    };
  }
  if (overlapPct > 10) {
    return {
      name: 'Kara & Scott',
      color: '#1e40af',
      bg: '#eff6ff',
      border: '#3b82f6',
      barColor: '#3b82f6',
      description:
        'Strong crossover energy. Your readers already know each other — time to make it official.',
    };
  }
  if (overlapPct > 3) {
    return {
      name: 'Thompson & Wolfe',
      color: '#065f46',
      bg: '#ecfdf5',
      border: '#34d399',
      barColor: '#10b981',
      description:
        "An interesting overlap. Different beats, shared readers. There's a story here.",
    };
  }
  return {
    name: 'Buried lede',
    color: '#6b7280',
    bg: '#f9fafb',
    border: '#d1d5db',
    barColor: '#9ca3af',
    description:
      "Small overlap, but don't sleep on it. Sometimes the best partnerships come from unexpected places.",
  };
}

// ── Loading messages ────────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  'Cross-referencing audiences...',
  'Checking the newsroom rolodex...',
  'Finding your journalism soulmates...',
  'Scanning the press corps...',
  'Matching bylines to followers...',
  'Consulting the editorial gods...',
  'Running the numbers on the beat...',
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
        Enter your Bluesky handle and we'll show you which journalists share your
        audience. Think of it as a matchmaking service for your next collaboration.
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

// ── Topic tag ───────────────────────────────────────────────────────────────

function TopicTag({ topic }: { topic: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.03em',
        background: '#EBF2FD',
        color: 'var(--color-blue)',
        marginRight: 4,
        marginBottom: 4,
      }}
    >
      {topic}
    </span>
  );
}

// ── Match card ──────────────────────────────────────────────────────────────

function MatchCard({ match, rank }: { match: PartnerMatch; rank: number }) {
  const tier = getMatchTier(match.overlapPercent);
  const barWidth = Math.min(match.overlapPercent * 2, 100); // scale up for visual impact

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: '20px 22px',
        marginBottom: 12,
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = tier.border;
        e.currentTarget.style.boxShadow = `0 2px 12px ${tier.border}30`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Top row: rank + name + tier badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--color-text-faint)',
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              #{rank}
            </span>
            <span
              style={{
                fontWeight: 600,
                fontSize: 16,
                color: 'var(--color-navy)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {match.displayName || match.handle}
            </span>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              color: 'var(--color-text-faint)',
              marginBottom: 8,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            @{match.handle}
          </div>
          {/* Topics */}
          {match.topics.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
              {match.topics.map((t) => (
                <TopicTag key={t} topic={t} />
              ))}
            </div>
          )}
        </div>

        {/* Tier badge */}
        <div
          style={{
            background: tier.bg,
            border: `1px solid ${tier.border}`,
            borderRadius: 4,
            padding: '6px 10px',
            flexShrink: 0,
            textAlign: 'center',
            minWidth: 130,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: tier.color,
              letterSpacing: '0.03em',
              lineHeight: 1.2,
              marginBottom: 2,
            }}
          >
            {tier.name}
          </div>
          <div
            style={{
              fontSize: 10,
              color: tier.color,
              opacity: 0.7,
              lineHeight: 1.4,
            }}
          >
            {tier.description.split('.')[0]}.
          </div>
        </div>
      </div>

      {/* Overlap bar */}
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>
            Audience overlap
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 14,
              fontWeight: 600,
              color: tier.color,
            }}
          >
            {match.overlapPercent.toFixed(1)}%
          </span>
        </div>
        <div
          style={{
            background: 'var(--color-bg-light)',
            borderRadius: 999,
            height: 6,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${barWidth}%`,
              background: tier.barColor,
              borderRadius: 999,
              transition: 'width 0.4s ease',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 6,
            fontSize: 11,
            color: 'var(--color-text-faint)',
          }}
        >
          <span>
            {match.overlapCount.toLocaleString()} shared followers
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Your profile card ───────────────────────────────────────────────────────

function YourProfileCard({ user }: { user: APIResponse['user'] }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: '20px 22px',
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 16,
            color: 'var(--color-navy)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          @{user.handle}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div
          style={{
            fontSize: 24,
            fontWeight: 400,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-blue)',
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}
        >
          {formatFollowers(user.followerCount)}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginTop: 2,
          }}
        >
          Followers
        </div>
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
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--color-navy)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 500 }}>@{results.user.handle}</span>
          <span
            style={{
              padding: '2px 7px',
              borderRadius: 3,
              background: '#EBF2FD',
              color: 'var(--color-blue)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {results.matches.length} matches
          </span>
        </div>
        <button onClick={onReset} className="btn-ghost" style={{ marginTop: 0 }}>
          New Search
        </button>
      </div>

      {/* Your profile */}
      <YourProfileCard user={results.user} />

      {/* Match list */}
      {results.matches.length > 0 ? (
        <>
          <div className="section-label" style={{ marginBottom: 12 }}>
            Your Matches
          </div>
          {results.matches.map((match, i) => (
            <MatchCard key={match.did} match={match} rank={i + 1} />
          ))}
        </>
      ) : (
        <div
          style={{
            background: '#fff',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--color-navy)',
              marginBottom: 8,
            }}
          >
            No matches found yet
          </div>
          <p
            style={{
              fontSize: 14,
              color: 'var(--color-text-muted)',
              maxWidth: 400,
              margin: '0 auto',
              lineHeight: 1.6,
            }}
          >
            No overlap found yet — but the directory is growing! Check back soon
            as more journalists are added.
          </p>
        </div>
      )}

      {/* Footer stat */}
      {results.comparedAgainst > 0 && (
        <div
          style={{
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--color-text-faint)',
            marginTop: 20,
            padding: '12px 0',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          Compared against {results.comparedAgainst} journalists in the directory
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function PartnersPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [handle, setHandle] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [results, setResults] = useState<PartnerResults | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadingMessage = useRotatingMessage(phase === 'loading');

  // Fetch directory stats for topic dropdown
  useEffect(() => {
    fetch('/api/directory?stats=true')
      .then((r) => r.json())
      .then((data: DirectoryStats) => {
        if (data.topics?.length) {
          setTopics(data.topics.sort());
        }
      })
      .catch(() => {
        // Non-fatal — topic filter just won't appear
      });
  }, []);

  const extractHandle = (input: string): string => {
    const trimmed = input.trim().replace(/^@/, '');
    const profileMatch = trimmed.match(/bsky\.app\/profile\/([^/?#]+)/);
    if (profileMatch) return profileMatch[1];
    return trimmed;
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const clean = extractHandle(handle);
      if (!clean) return;

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setPhase('loading');
      setResults(null);
      setErrorMsg(null);

      try {
        const params = new URLSearchParams({ handle: clean, limit: '30' });
        if (selectedTopic) params.set('topic', selectedTopic);

        const res = await fetch(`/api/partners?${params.toString()}`, {
          signal: ctrl.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg = (body as { error?: string }).error ?? res.statusText;
          // Detect the "no cached followers" scenario
          if (res.status === 404 || msg.toLowerCase().includes('no cached') || msg.toLowerCase().includes('not found')) {
            setPhase('no-cache');
            return;
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
    [handle, selectedTopic]
  );

  const handleReset = () => {
    abortRef.current?.abort();
    setPhase('idle');
    setResults(null);
    setErrorMsg(null);
  };

  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '32px 20px 64px',
      }}
    >
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
            Paste your handle or a full Bluesky profile URL. We'll compare your
            followers against our journalist directory.
          </p>

          {topics.length > 0 && (
            <>
              <hr className="divider" />
              <div className="input-group">
                <label>Filter by topic (optional)</label>
                <select
                  className="handle-input"
                  value={selectedTopic}
                  onChange={(e) => setSelectedTopic(e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="">All topics</option>
                  {topics.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <button
            type="submit"
            className="btn"
            disabled={!handle.trim()}
          >
            Find Matches
          </button>
        </form>
      )}

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {phase === 'loading' && (
        <div
          style={{
            background: '#fff',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '48px 32px',
            textAlign: 'center',
          }}
        >
          {/* Pulsing dot animation */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 6,
              marginBottom: 20,
            }}
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--color-blue)',
                  animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--color-navy)',
              marginBottom: 6,
            }}
          >
            {loadingMessage}
          </div>
          <p
            style={{
              fontSize: 13,
              color: 'var(--color-text-faint)',
              margin: 0,
            }}
          >
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
        <div
          style={{
            background: '#fff',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '40px 28px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: 'var(--color-navy)',
              marginBottom: 10,
            }}
          >
            We need to see your followers first!
          </div>
          <p
            style={{
              fontSize: 14,
              color: 'var(--color-text-muted)',
              maxWidth: 440,
              margin: '0 auto 20px',
              lineHeight: 1.6,
            }}
          >
            Run an analysis on the{' '}
            <a
              href="/"
              style={{ color: 'var(--color-blue)', fontWeight: 500, textDecoration: 'none' }}
            >
              main page
            </a>{' '}
            with your handle first. Once your followers are cached, come back here
            and we'll match you with journalists in the directory.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <a
              href="/"
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
                letterSpacing: '0.01em',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.background = 'var(--color-blue)';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.background = 'var(--color-navy)';
              }}
            >
              Go to Analysis
            </a>
            <button onClick={handleReset} className="btn-ghost">
              Try another handle
            </button>
          </div>
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {phase === 'error' && (
        <div className="alert alert-error">
          <strong>Error:</strong> {errorMsg}
          <div style={{ marginTop: 12 }}>
            <button onClick={handleReset} className="btn-ghost">
              Try again
            </button>
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
