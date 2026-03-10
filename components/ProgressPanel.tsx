'use client';

import { useEffect, useRef, useState } from 'react';

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

interface Props {
  pct: number;
  message?: string;
  followerProgress?: Record<string, { fetched: number; max: number }>;
  postProgress?: Record<string, { analyzed: number; total: number }>;
}

export default function ProgressPanel({ pct, followerProgress, postProgress }: Props) {
  const [displayWord, setDisplayWord] = useState('Fetching');
  const [typedChars, setTypedChars] = useState(0);
  const [starIdx, setStarIdx] = useState(0);
  const deckRef = useRef<string[]>([]);
  const lastWordRef = useRef<string>('');
  // Monotonic clamps — bars can only advance, never regress
  const maxFolPctRef = useRef(0);
  const maxPostPctRef = useRef(0);

  // Verb wheel
  useEffect(() => {
    const nextWord = () => {
      if (!deckRef.current.length) {
        deckRef.current = shuffleDeck(lastWordRef.current);
      }
      const word = deckRef.current.shift()!;
      lastWordRef.current = word;
      setDisplayWord(word);
      setTypedChars(0);
      setStarIdx(0);
    };

    nextWord();
    const wordInterval = setInterval(nextWord, 1800);
    return () => clearInterval(wordInterval);
  }, []);

  // Typewriter effect
  useEffect(() => {
    if (typedChars >= displayWord.length + 3) return; // +3 for "..."
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
            fontSize: 11,
            color: 'var(--color-text-faint)',
            marginBottom: 4,
            fontFamily: 'var(--font-mono)',
          }}
        >
          Followers
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${folPct}%` }} />
        </div>
      </div>

      {/* Post progress bar */}
      <div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-faint)',
            marginBottom: 4,
            fontFamily: 'var(--font-mono)',
          }}
        >
          Posts
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${postPct}%` }} />
        </div>
      </div>
    </div>
  );
}
