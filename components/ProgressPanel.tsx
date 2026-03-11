'use client';

import { useEffect, useRef, useState } from 'react';
import type { SpeedTier, ChunkedFetchPhase } from '@/lib/types';

const PROGRESS_WORDS = [
  'Fetching', 'Indexing', 'Comparing', 'Scanning', 'Loading',
  'Processing', 'Computing', 'Connecting', 'Counting', 'Querying',
  'Crosschecking', 'Triangulating', 'Crunching', 'Mapping',
  'Perusing', 'Tallying', 'Calculating', 'Investigating',
  'Surveying', 'Decoding', 'Assembling', 'Checking', 'Finding',
  'Grinding', 'Sleuthing', 'Researching', 'Unraveling', 'Deliberating',
  'Hacking', 'Figuring', 'Spelunking', 'Networking', 'Ruminating',
  'Calibrating', 'Extrapolating', 'Correlating', 'Tabulating', 'Synthesizing',
  'Reconciling', 'Interpolating', 'Aggregating', 'Enumerating', 'Deduplicating',
  'Normalizing', 'Quantifying', 'Classifying', 'Disambiguating', 'Partitioning',
  'Scrutinizing', 'Unspooling', 'Verifying', 'Advancing',
];

const STAR_FRAMES = ['·', '*', '✶', '✺', '✶', '*', '·'];

// Phase announcement messages — shown at phase transitions, then verbs resume
const PHASE_MESSAGES: Record<ChunkedFetchPhase, string> = {
  profiles: 'Fetching profiles',
  followers: 'Fetching followers',
  engagement: 'Fetching likes and reposts',
  computing: 'Computing overlaps',
};

function shuffleDeck(exclude?: string): string[] {
  const deck = [...PROGRESS_WORDS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  if (exclude && deck[0] === exclude) {
    const swap = Math.floor(Math.random() * (deck.length - 1)) + 1;
    [deck[0], deck[swap]] = [deck[swap], deck[0]];
  }
  return deck;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface Props {
  pct: number;
  message?: string;
  followerProgress?: Record<string, { fetched: number; max: number }>;
  postProgress?: Record<string, { analyzed: number; total: number }>;
  speedTier?: SpeedTier;
  fetchPhase?: ChunkedFetchPhase;
  timeEstimate?: number | null;
  accountCount?: number;
}

export default function ProgressPanel({
  pct,
  followerProgress,
  postProgress,
  speedTier,
  fetchPhase,
}: Props) {
  const [displayWord, setDisplayWord] = useState('Fetching');
  const [typedChars, setTypedChars] = useState(0);
  const [starIdx, setStarIdx] = useState(0);
  const deckRef = useRef<string[]>([]);
  const lastWordRef = useRef<string>('');
  const lastPhaseRef = useRef<ChunkedFetchPhase | undefined>(undefined);
  const phaseHoldUntilRef = useRef(0);
  // Monotonic clamps — bars can only advance, never regress
  const maxFolPctRef = useRef(0);
  const maxPostPctRef = useRef(0);

  const isChunked = speedTier === 'complete' && fetchPhase !== undefined;
  const isPermanentPhase = fetchPhase === 'computing';

  // Phase transition: show announcement, then verbs resume after hold
  useEffect(() => {
    if (!fetchPhase || fetchPhase === lastPhaseRef.current) return;
    lastPhaseRef.current = fetchPhase;
    const msg = PHASE_MESSAGES[fetchPhase];
    setDisplayWord(msg);
    setTypedChars(0);
    // Hold the phase message for 4s before resuming verb cycling
    // computing stays permanent
    phaseHoldUntilRef.current = isPermanentPhase ? Infinity : Date.now() + 4000;
  }, [fetchPhase, isPermanentPhase]);

  // Verb wheel
  useEffect(() => {
    const nextWord = () => {
      // Skip verb cycling during phase hold or permanent phases
      if (Date.now() < phaseHoldUntilRef.current) return;

      if (!deckRef.current.length) {
        deckRef.current = shuffleDeck(lastWordRef.current);
      }
      const word = deckRef.current.shift()!;
      lastWordRef.current = word;
      setDisplayWord(word);
      setTypedChars(0);
      setStarIdx(0);
    };

    if (!isChunked) {
      // Non-chunked: start immediately with a random verb
      nextWord();
    }

    const wordInterval = setInterval(nextWord, 1800);
    return () => clearInterval(wordInterval);
  }, [isChunked]);

  // Typewriter effect
  useEffect(() => {
    const targetLen = displayWord.length + 3; // always append "..."
    if (typedChars >= targetLen) return;
    const timeout = setTimeout(
      () => setTypedChars((c) => c + 1),
      40
    );
    return () => clearTimeout(timeout);
  }, [typedChars, displayWord]);

  // Star spinner
  useEffect(() => {
    const interval = setInterval(
      () => setStarIdx((i) => (i + 1) % STAR_FRAMES.length),
      500
    );
    return () => clearInterval(interval);
  }, []);

  const visibleText = (displayWord + '...').slice(0, typedChars);

  // Aggregate progress — compute raw percentages then clamp monotonically
  const folEntries = Object.values(followerProgress ?? {});
  const folDone = folEntries.reduce((s, v) => s + Math.min(v.fetched, v.max), 0);
  const folTotal = folEntries.reduce((s, v) => s + v.max, 0);
  const rawFolPct = folTotal > 0 ? Math.min(100, (folDone / folTotal) * 100) : pct;

  const postEntries = Object.values(postProgress ?? {});
  const postDone = postEntries.reduce((s, v) => s + v.analyzed, 0);
  const postTotal = postEntries.reduce((s, v) => s + v.total, 0);
  const rawPostPct = postTotal > 0 ? Math.min(100, (postDone / postTotal) * 100) : pct;

  // Bars only ever advance — prevent visual regression from denominator fluctuations
  maxFolPctRef.current = Math.max(maxFolPctRef.current, rawFolPct);
  maxPostPctRef.current = Math.max(maxPostPctRef.current, rawPostPct);
  const folPct = maxFolPctRef.current;
  const postPct = maxPostPctRef.current;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {/* Verb wheel / phase announcement */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 15,
            color: 'var(--color-blue)',
            letterSpacing: '-0.01em',
          }}
        >
          {STAR_FRAMES[starIdx]}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 15,
            color: 'var(--color-navy)',
            minWidth: 200,
          }}
        >
          {visibleText}
        </span>
      </div>

      {/* Follower progress bar */}
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--color-text-faint)',
            marginBottom: 4,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span>Followers</span>
          {isChunked && folTotal > 0 && (
            <span>{formatNumber(folDone)} / {formatNumber(folTotal)}</span>
          )}
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${folPct}%` }} />
        </div>
      </div>

      {/* Post progress bar */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'var(--color-text-faint)',
            marginBottom: 4,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span>Posts</span>
          {isChunked && postTotal > 0 && (
            <span>{postDone} / {postTotal}</span>
          )}
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${postPct}%` }} />
        </div>
      </div>
    </div>
  );
}
