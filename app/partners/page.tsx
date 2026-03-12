'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatFollowers } from '@/lib/analysis/interpret';

// ── Types ────────────────────────────────────────────────────────────────────

interface MatchInfo {
  did: string;
  handle: string;
  displayName: string;
  avatar?: string;
  geography?: string;
  followerCount: number;
}

interface TrioRecommendation {
  matchA: MatchInfo;
  matchB: MatchInfo;
  overlaps: {
    userA: number;
    userB: number;
    ab: number;
    threeWay: number;
  };
  sizes: {
    user: number;
    a: number;
    b: number;
  };
  totalReach: number;
  newAudienceForUser: number;
  newAudienceForA: number;
  newAudienceForB: number;
  trioScore: number;
  overlapLevel: 'high' | 'medium' | 'low';
  signals: {
    sizeMatch: boolean;
    topicMatch: boolean;
    geoMatch: boolean;
  };
}

interface PairRecommendation {
  match: MatchInfo;
  overlap: number;
  sizes: { user: number; match: number };
  totalReach: number;
  newAudienceForUser: number;
  newAudienceForMatch: number;
  pairScore: number;
  overlapLevel: 'high' | 'medium' | 'low';
  signals: {
    sizeMatch: boolean;
    topicMatch: boolean;
    geoMatch: boolean;
  };
}

type MatchMode = 'trio' | 'pair';

interface UserInfo {
  did: string;
  handle: string;
  followerCount: number;
  avatar?: string;
  sampleSize?: number;
}

interface APIResponse {
  mode: MatchMode;
  user: UserInfo;
  trios?: TrioRecommendation[];
  pairs?: PairRecommendation[];
  totalJournalists: number;
  comparedCount: number;
}

interface NoCacheResponse {
  error: 'no_cache';
  user: { did: string; handle: string; followerCount: number };
}

interface DirectoryStats {
  totalJournalists: number;
  topics: string[];
  geographies: string[];
}

type Phase = 'idle' | 'loading' | 'results' | 'error' | 'no-cache';

// ── Topic clustering ────────────────────────────────────────────────────────

const TOPIC_CLUSTERS: Record<string, string[]> = {
  'Politics & Government': ['Politics', 'Government Accountability', 'Policy', 'National Security', 'Foreign Policy', 'Immigration', 'Labor', 'Criminal Justice', 'Inequality'],
  'Tech & Science': ['Tech', 'Science', 'Internet Culture', 'Games/Gaming'],
  'Data Visualization': ['Data Visualization', 'Data', 'Charts', 'Infographics', 'Data Journalism'],
  'OSINT': ['OSINT', 'Open Source Intelligence', 'Verification', 'Fact-Checking', 'Disinformation', 'Geolocation'],
  'Business & Finance': ['Finance/Economics', 'Business', 'Personal Finance', 'Real Estate', 'Careers', 'Energy', 'Construction'],
  'Culture & Arts': ['Culture', 'Entertainment/Hollywood', 'Music', 'Film/Movies', 'Art', 'Books/Writing', 'Photography', 'Design', 'Fashion', 'Comedy', 'Gossip'],
  'Health & Lifestyle': ['Health/Wellness', 'Mental Health', 'Lifestyle', 'Fitness', 'Self Help', 'Parenting', 'Family', 'Dating/Romance', 'Running'],
  'Food & Travel': ['Food', 'Restaurants', 'Recipes', 'Bars', 'Travel', 'Things to do', 'Things to Do', 'Outdoors'],
  'Environment': ['Climate/Environment', 'Agriculture', 'Animals', 'Weather'],
  'Social Justice': ['Identity/Belonging', 'Gender', 'LGBTQIA', 'Activism', 'Human Rights', 'Faith/Religion'],
  'Investigative': ['Investigative', 'Law/Legal Issues', 'Crime'],
  'World & News': ['World', 'General News', 'Explanatory', 'History', 'Media/Power', 'Solutions Journalism', 'Positive News', 'Positive news'],
  'Local News': ['Local', 'Local News', 'Local news', 'Urban planning', 'Transit/Transportation'],
  'Sports': ['Sports'],
  'Education': ['Education'],
};

/** Map raw directory topics to consolidated cluster names. */
function consolidateTopics(rawTopics: string[]): string[] {
  const clusters = new Set<string>();
  for (const raw of rawTopics) {
    let matched = false;
    for (const [cluster, members] of Object.entries(TOPIC_CLUSTERS)) {
      if (members.some(m => m.toLowerCase() === raw.toLowerCase())) {
        clusters.add(cluster);
        matched = true;
        break;
      }
    }
    if (!matched) clusters.add(raw); // Keep unclustered topics as-is
  }
  return Array.from(clusters).sort();
}

// ── Geography consolidation (client-side, mirrors API logic) ────────────────

function consolidateGeographies(rawGeos: string[]): string[] {
  const regions = new Set<string>();
  for (const raw of rawGeos) {
    const region = consolidateGeo(raw);
    if (region) regions.add(region);
  }
  return Array.from(regions).sort();
}

const US_STATE_REGIONS: Record<string, string> = {
  'ny': 'USA — Northeast', 'nj': 'USA — Northeast', 'ct': 'USA — Northeast',
  'ma': 'USA — Northeast', 'pa': 'USA — Northeast', 'ri': 'USA — Northeast',
  'vt': 'USA — Northeast', 'nh': 'USA — Northeast', 'me': 'USA — Northeast',
  'fl': 'USA — Southeast', 'ga': 'USA — Southeast', 'nc': 'USA — Southeast',
  'sc': 'USA — Southeast', 'va': 'USA — Southeast', 'al': 'USA — Southeast',
  'ms': 'USA — Southeast', 'tn': 'USA — Southeast', 'la': 'USA — Southeast',
  'ar': 'USA — Southeast', 'ky': 'USA — Southeast', 'wv': 'USA — Southeast',
  'il': 'USA — Midwest', 'oh': 'USA — Midwest', 'mi': 'USA — Midwest',
  'in': 'USA — Midwest', 'wi': 'USA — Midwest', 'mn': 'USA — Midwest',
  'ia': 'USA — Midwest', 'mo': 'USA — Midwest', 'ks': 'USA — Midwest',
  'ne': 'USA — Midwest', 'nd': 'USA — Midwest', 'sd': 'USA — Midwest',
  'tx': 'USA — Southwest', 'ok': 'USA — Southwest', 'nm': 'USA — Southwest',
  'az': 'USA — Southwest',
  'ca': 'USA — West', 'or': 'USA — West', 'wa': 'USA — West',
  'co': 'USA — West', 'nv': 'USA — West', 'ut': 'USA — West',
  'id': 'USA — West', 'mt': 'USA — West', 'wy': 'USA — West',
  'hi': 'USA — West', 'ak': 'USA — West',
  'dc': 'USA — DC/National', 'd.c.': 'USA — DC/National',
};

function consolidateGeo(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower.includes('national') && lower.includes('us')) return 'USA — National';
  if (lower.includes('d.c.') || lower.includes('washington, dc')) return 'USA — DC/National';
  const cityState = lower.match(/,\s*([a-z]{2})$/);
  if (cityState) {
    const region = US_STATE_REGIONS[cityState[1]];
    if (region) return region;
  }
  const stateUS = lower.match(/^(.+?)\s*-\s*us$/);
  if (stateUS) {
    const stateAbbrs: Record<string, string> = {
      'california': 'ca', 'new york': 'ny', 'texas': 'tx', 'florida': 'fl',
      'illinois': 'il', 'pennsylvania': 'pa', 'ohio': 'oh', 'georgia': 'ga',
      'north carolina': 'nc', 'michigan': 'mi', 'new jersey': 'nj',
      'virginia': 'va', 'washington': 'wa', 'massachusetts': 'ma',
      'arizona': 'az', 'indiana': 'in', 'tennessee': 'tn', 'missouri': 'mo',
      'maryland': 'md', 'wisconsin': 'wi', 'colorado': 'co', 'minnesota': 'mn',
      'alabama': 'al', 'louisiana': 'la', 'kentucky': 'ky', 'oregon': 'or',
      'oklahoma': 'ok', 'connecticut': 'ct', 'iowa': 'ia', 'arkansas': 'ar',
      'nevada': 'nv', 'mississippi': 'ms', 'kansas': 'ks', 'new mexico': 'nm',
      'utah': 'ut', 'nebraska': 'ne', 'idaho': 'id', 'hawaii': 'hi',
      'maine': 'me', 'montana': 'mt', 'rhode island': 'ri', 'delaware': 'de',
      'south dakota': 'sd', 'north dakota': 'nd', 'alaska': 'ak',
      'vermont': 'vt', 'wyoming': 'wy', 'west virginia': 'wv',
      'south carolina': 'sc', 'new hampshire': 'nh',
    };
    const abbr = stateAbbrs[stateUS[1].trim()];
    if (abbr && US_STATE_REGIONS[abbr]) return US_STATE_REGIONS[abbr];
    return 'USA';
  }
  if (lower === 'international') return 'International';
  if (lower.includes('united kingdom') || lower.includes('uk')) return 'United Kingdom';
  if (lower.includes('canada')) return 'Canada';
  if (lower.includes('australia')) return 'Australia';
  if (lower.includes('france')) return 'France';
  if (lower.includes('germany')) return 'Germany';
  return raw;
}

/** Normalize user-typed geography to match our region format. */
function normalizeUserGeo(input: string): string {
  const lower = input.toLowerCase().trim();
  if (!lower) return '';

  // Common city/country synonyms → regions
  const cityMap: Record<string, string> = {
    'new york': 'USA — Northeast', 'nyc': 'USA — Northeast', 'manhattan': 'USA — Northeast',
    'brooklyn': 'USA — Northeast', 'boston': 'USA — Northeast', 'philly': 'USA — Northeast',
    'philadelphia': 'USA — Northeast', 'pittsburgh': 'USA — Northeast',
    'dc': 'USA — DC/National', 'washington dc': 'USA — DC/National',
    'washington d.c.': 'USA — DC/National', 'washington': 'USA — DC/National',
    'la': 'USA — West', 'los angeles': 'USA — West', 'san francisco': 'USA — West',
    'sf': 'USA — West', 'seattle': 'USA — West', 'portland': 'USA — West',
    'san diego': 'USA — West', 'denver': 'USA — West', 'las vegas': 'USA — West',
    'chicago': 'USA — Midwest', 'detroit': 'USA — Midwest', 'minneapolis': 'USA — Midwest',
    'miami': 'USA — Southeast', 'atlanta': 'USA — Southeast', 'charlotte': 'USA — Southeast',
    'nashville': 'USA — Southeast', 'raleigh': 'USA — Southeast',
    'dallas': 'USA — Southwest', 'houston': 'USA — Southwest', 'austin': 'USA — Southwest',
    'san antonio': 'USA — Southwest', 'phoenix': 'USA — Southwest',
    'london': 'United Kingdom', 'uk': 'United Kingdom', 'england': 'United Kingdom',
    'paris': 'France', 'berlin': 'Germany', 'munich': 'Germany',
    'toronto': 'Canada', 'vancouver': 'Canada', 'montreal': 'Canada',
    'sydney': 'Australia', 'melbourne': 'Australia',
    'us': 'USA — National', 'usa': 'USA — National', 'united states': 'USA — National',
    'america': 'USA — National',
  };

  if (cityMap[lower]) return cityMap[lower];

  // Try state names
  const stateAbbrs: Record<string, string> = {
    'california': 'ca', 'new york state': 'ny', 'texas': 'tx', 'florida': 'fl',
    'illinois': 'il', 'pennsylvania': 'pa', 'ohio': 'oh', 'georgia': 'ga',
    'north carolina': 'nc', 'michigan': 'mi', 'new jersey': 'nj',
    'virginia': 'va', 'massachusetts': 'ma', 'arizona': 'az',
    'tennessee': 'tn', 'colorado': 'co', 'minnesota': 'mn',
    'oregon': 'or', 'oklahoma': 'ok',
  };
  if (stateAbbrs[lower]) {
    const region = US_STATE_REGIONS[stateAbbrs[lower]];
    if (region) return region;
  }

  // Check if it's already a valid region
  if (input.startsWith('USA —') || input === 'International') return input;

  // Return as-is (the API will also try to normalize)
  return input;
}

// ── Loading animation (verb wheel — matches analysis page) ─────────────────

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

function VerbWheel({ active }: { active: boolean }) {
  const [displayWord, setDisplayWord] = useState('Scanning');
  const [typedChars, setTypedChars] = useState(0);
  const [starIdx, setStarIdx] = useState(0);
  const [pct, setPct] = useState(0);
  const deckRef = useRef<string[]>([]);
  const lastWordRef = useRef<string>('');

  // Verb cycling
  useEffect(() => {
    if (!active) return;
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
    const id = setInterval(nextWord, 1800);
    return () => clearInterval(id);
  }, [active]);

  // Typewriter
  useEffect(() => {
    const targetLen = displayWord.length + 3;
    if (typedChars >= targetLen) return;
    const timeout = setTimeout(() => setTypedChars(c => c + 1), 40);
    return () => clearTimeout(timeout);
  }, [typedChars, displayWord]);

  // Star spinner
  useEffect(() => {
    const id = setInterval(() => setStarIdx(i => (i + 1) % STAR_FRAMES.length), 500);
    return () => clearInterval(id);
  }, []);

  // Fake progress bar — moves quickly at first, slows down
  useEffect(() => {
    if (!active) { setPct(0); return; }
    const id = setInterval(() => {
      setPct(prev => {
        if (prev >= 90) return prev + 0.1;
        if (prev >= 70) return prev + 0.3;
        if (prev >= 40) return prev + 0.8;
        return prev + 2;
      });
    }, 200);
    return () => clearInterval(id);
  }, [active]);

  const visibleText = (displayWord + '...').slice(0, typedChars);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--color-blue)', letterSpacing: '-0.01em' }}>
          {STAR_FRAMES[starIdx]}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--color-navy)', minWidth: 200 }}>
          {visibleText}
        </span>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-faint)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
          <span>Finding trios</span>
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${Math.min(pct, 95)}%` }} />
        </div>
      </div>
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header() {
  return (
    <div style={{ marginBottom: 48, paddingBottom: 32, borderBottom: '1px solid var(--color-border)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/trustfnd-logo.svg" alt="Trustfnd" style={{ height: 22, width: 'auto', marginBottom: 20, display: 'block' }} />
      <h1 style={{
        fontFamily: 'var(--font-sans)', fontSize: 42, fontWeight: 700,
        color: 'var(--color-navy)', lineHeight: 1.15, letterSpacing: '-0.02em', margin: '0 0 10px',
      }}>
        Meet Your Match
      </h1>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 15, maxWidth: 540, lineHeight: 1.6, margin: 0 }}>
        Get matching recommendations based on your Bluesky followers.
      </p>
      <a
        href="/"
        style={{
          display: 'inline-block',
          marginTop: 14,
          fontSize: 13,
          color: 'var(--color-blue)',
          textDecoration: 'none',
          fontWeight: 500,
        }}
      >
        Select accounts to analyze →
      </a>
    </div>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer style={{
      marginTop: 64, paddingTop: 32, borderTop: '1px solid var(--color-border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/trustfnd-wordmark-red.svg" alt="Trustfnd" style={{ height: 28, width: 'auto' }} />
      <div style={{ display: 'flex', gap: 24 }}>
        <a href="https://trustfnd.com/terms-and-privacy" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, color: 'var(--color-text-muted)', textDecoration: 'none' }}>
          Terms of Service
        </a>
        <a href="https://trustfnd.com/terms-and-privacy" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, color: 'var(--color-text-muted)', textDecoration: 'none' }}>
          Privacy Policy
        </a>
      </div>
    </footer>
  );
}

// ── Signal badge ─────────────────────────────────────────────────────────────

function SignalBadge({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 3,
      fontSize: 10, fontWeight: 500, background: '#EBF2FD', color: 'var(--color-blue)', marginRight: 4,
    }}>
      {label}
    </span>
  );
}

// ── Venn Diagram ─────────────────────────────────────────────────────────────

const VENN_COLORS = {
  user: { fill: '#1a365d', stroke: '#1a365d' },
  a:    { fill: '#2563eb', stroke: '#2563eb' },
  b:    { fill: '#059669', stroke: '#059669' },
};

function VennDiagram({
  trio,
  userHandle,
  userAvatar,
}: {
  trio: TrioRecommendation;
  userHandle: string;
  userAvatar?: string;
}) {
  const { overlaps, sizes } = trio;

  // Circle positions — equilateral triangle arrangement
  const cx = { user: 150, a: 105, b: 195 };
  const cy = { user: 88, a: 162, b: 162 };
  const r = 68;

  // First letter for labels
  const initials = {
    user: userHandle.charAt(0).toUpperCase(),
    a: (trio.matchA.displayName || trio.matchA.handle).charAt(0).toUpperCase(),
    b: (trio.matchB.displayName || trio.matchB.handle).charAt(0).toUpperCase(),
  };

  const avatars = {
    user: userAvatar,
    a: trio.matchA.avatar,
    b: trio.matchB.avatar,
  };

  return (
    <svg viewBox="0 0 300 250" style={{ width: '100%', maxWidth: 320, margin: '0 auto', display: 'block' }}>
      <defs>
        {/* Clip paths for avatar images */}
        {(['user', 'a', 'b'] as const).map(key => (
          <clipPath key={key} id={`clip-${key}`}>
            <circle cx={cx[key]} cy={cy[key]} r={r - 1} />
          </clipPath>
        ))}
      </defs>

      {/* Circle fills with transparency */}
      {(['user', 'a', 'b'] as const).map(key => (
        <circle
          key={key}
          cx={cx[key]}
          cy={cy[key]}
          r={r}
          fill={VENN_COLORS[key].fill}
          fillOpacity={0.12}
          stroke={VENN_COLORS[key].stroke}
          strokeWidth={2}
          strokeOpacity={0.6}
        />
      ))}

      {/* Avatar images or initials */}
      {(['user', 'a', 'b'] as const).map(key => {
        const avatar = avatars[key];
        // Position labels outside the overlap areas
        const labelCx = key === 'user' ? cx.user : key === 'a' ? cx.a - 22 : cx.b + 22;
        const labelCy = key === 'user' ? cy.user - 26 : key === 'a' ? cy.a + 26 : cy.b + 26;

        return avatar ? (
          <g key={`avatar-${key}`}>
            <clipPath id={`avatar-clip-${key}`}>
              <circle cx={labelCx} cy={labelCy} r={16} />
            </clipPath>
            <image
              href={avatar}
              x={labelCx - 16} y={labelCy - 16}
              width={32} height={32}
              clipPath={`url(#avatar-clip-${key})`}
              style={{ imageRendering: 'auto' }}
            />
            <circle cx={labelCx} cy={labelCy} r={16}
              fill="none" stroke={VENN_COLORS[key].stroke} strokeWidth={2} />
          </g>
        ) : (
          <g key={`initial-${key}`}>
            <circle cx={labelCx} cy={labelCy} r={16}
              fill={VENN_COLORS[key].fill} fillOpacity={0.15}
              stroke={VENN_COLORS[key].stroke} strokeWidth={1.5} />
            <text x={labelCx} y={labelCy + 1} textAnchor="middle" dominantBaseline="central"
              fontSize={13} fontWeight={600} fill={VENN_COLORS[key].stroke}
              fontFamily="var(--font-sans)">
              {initials[key]}
            </text>
          </g>
        );
      })}

      {/* Overlap labels */}
      {/* User-A overlap (top-left intersection) */}
      <text x={(cx.user + cx.a) / 2} y={(cy.user + cy.a) / 2 - 2}
        textAnchor="middle" fontSize={11} fontWeight={600} fill="#1a365d"
        fontFamily="var(--font-mono)">
        {formatFollowers(overlaps.userA)}
      </text>

      {/* User-B overlap (top-right intersection) */}
      <text x={(cx.user + cx.b) / 2} y={(cy.user + cy.b) / 2 - 2}
        textAnchor="middle" fontSize={11} fontWeight={600} fill="#1a365d"
        fontFamily="var(--font-mono)">
        {formatFollowers(overlaps.userB)}
      </text>

      {/* A-B overlap (bottom intersection) */}
      <text x={(cx.a + cx.b) / 2} y={(cy.a + cy.b) / 2 + 12}
        textAnchor="middle" fontSize={11} fontWeight={600} fill="#1a365d"
        fontFamily="var(--font-mono)">
        {formatFollowers(overlaps.ab)}
      </text>

      {/* Three-way center */}
      {overlaps.threeWay > 0 && (
        <g>
          <circle cx={150} cy={137} r={18}
            fill="#fff" fillOpacity={0.85} stroke="var(--color-navy)" strokeWidth={1} />
          <text x={150} y={137} textAnchor="middle" dominantBaseline="central"
            fontSize={10} fontWeight={700} fill="var(--color-navy)"
            fontFamily="var(--font-mono)">
            {formatFollowers(overlaps.threeWay)}
          </text>
        </g>
      )}

      {/* Size labels under circles */}
      <text x={cx.user} y={cy.user - 50} textAnchor="middle"
        fontSize={10} fill="var(--color-text-faint)" fontFamily="var(--font-mono)">
        {formatFollowers(sizes.user)}
      </text>
      <text x={cx.a - 28} y={cy.a + 50} textAnchor="middle"
        fontSize={10} fill="var(--color-text-faint)" fontFamily="var(--font-mono)">
        {formatFollowers(sizes.a)}
      </text>
      <text x={cx.b + 28} y={cy.b + 50} textAnchor="middle"
        fontSize={10} fill="var(--color-text-faint)" fontFamily="var(--font-mono)">
        {formatFollowers(sizes.b)}
      </text>
    </svg>
  );
}

// ── Trio card ────────────────────────────────────────────────────────────────

function TrioCard({
  trio,
  rank,
  userHandle,
  userAvatar,
}: {
  trio: TrioRecommendation;
  rank: number;
  userHandle: string;
  userAvatar?: string;
}) {
  const handles = [userHandle, trio.matchA.handle, trio.matchB.handle];
  const analysisUrl = `/?handles=${handles.map(h => encodeURIComponent(h)).join(',')}&autostart=complete`;

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--color-border)',
      borderRadius: 8, padding: '24px', marginBottom: 20,
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-blue)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
            color: '#fff', background: 'var(--color-navy)',
            width: 26, height: 26, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {rank}
          </span>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            You + {trio.matchA.displayName || trio.matchA.handle} + {trio.matchB.displayName || trio.matchB.handle}
          </span>
        </div>
        {/* Signals */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {trio.signals.sizeMatch && <SignalBadge label="Similar size" />}
          {trio.signals.topicMatch && <SignalBadge label="Topic match" />}
          {trio.signals.geoMatch && <SignalBadge label="Same region" />}
        </div>
      </div>

      {/* Combined reach — hero */}
      <div style={{
        textAlign: 'center', padding: '20px 16px', marginBottom: 16,
        background: 'linear-gradient(135deg, #EBF2FD 0%, #f0f7ff 100%)',
        borderRadius: 6, border: '1px solid #d6e4f5',
      }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-blue)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Combined audience
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1.1 }}>
          {formatFollowers(trio.totalReach)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
          unique followers across all three
        </div>
      </div>

      {/* Venn diagram */}
      <VennDiagram trio={trio} userHandle={userHandle} userAvatar={userAvatar} />

      {/* Trio members */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12,
        margin: '16px 0', textAlign: 'center',
      }}>
        {/* User */}
        <div>
          <div style={{
            fontSize: 8, fontWeight: 600, textTransform: 'uppercase' as const,
            letterSpacing: '0.08em', color: VENN_COLORS.user.stroke, marginBottom: 4,
          }}>You</div>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--color-navy)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            @{userHandle}
          </div>
        </div>
        {/* Match A */}
        <div>
          <div style={{
            fontSize: 8, fontWeight: 600, textTransform: 'uppercase' as const,
            letterSpacing: '0.08em', color: VENN_COLORS.a.stroke, marginBottom: 4,
          }}>Collaborator 1</div>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--color-navy)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {trio.matchA.displayName || `@${trio.matchA.handle}`}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-faint)' }}>
            @{trio.matchA.handle}
          </div>
        </div>
        {/* Match B */}
        <div>
          <div style={{
            fontSize: 8, fontWeight: 600, textTransform: 'uppercase' as const,
            letterSpacing: '0.08em', color: VENN_COLORS.b.stroke, marginBottom: 4,
          }}>Collaborator 2</div>
          <div style={{
            fontSize: 13, fontWeight: 600, color: 'var(--color-navy)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {trio.matchB.displayName || `@${trio.matchB.handle}`}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-faint)' }}>
            @{trio.matchB.handle}
          </div>
        </div>
      </div>

      {/* New audience opportunity */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 10, padding: '12px 14px', background: '#f8fafc',
        borderRadius: 4, border: '1px solid #f1f5f9', marginBottom: 12,
      }}>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 3 }}>
            New people for you
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            +{formatFollowers(trio.newAudienceForUser ?? 0)}
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 3 }}>
            New for {(trio.matchA.displayName || trio.matchA.handle).split(' ')[0]}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            +{formatFollowers(trio.newAudienceForA ?? 0)}
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 3 }}>
            New for {(trio.matchB.displayName || trio.matchB.handle).split(' ')[0]}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            +{formatFollowers(trio.newAudienceForB ?? 0)}
          </div>
        </div>
      </div>

      {/* Deep dive */}
      <div style={{ textAlign: 'right' }}>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 4px' }}>
          Discover engagement overlaps and how many people you could convert together
        </p>
        <a href={analysisUrl} style={{
          fontSize: 13, color: 'var(--color-blue)', textDecoration: 'none', fontWeight: 500,
        }}>
          Run full analysis →
        </a>
      </div>
    </div>
  );
}

// ── No cache view ───────────────────────────────────────────────────────────

function NoCacheView({ user, onReset }: {
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
        {user ? <strong>@{user.handle}</strong> : 'your account'}
        {followerCount > 0 && ` (${formatFollowers(followerCount)} followers)`}
        , but we haven&apos;t analyzed your followers yet.
      </p>
      <p style={{ fontSize: 13, color: 'var(--color-text-faint)', maxWidth: 440, margin: '0 auto 24px', lineHeight: 1.5 }}>
        We need to fetch your followers first so we can find your best collaborations. This takes about <strong>{estimateMinutes} minutes</strong>.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        {user && (
          <a
            href={`/?handles=${encodeURIComponent(user.handle)}&autostart=complete`}
            style={{
              display: 'inline-block', padding: '12px 24px',
              background: 'var(--color-navy)', color: '#F8FFFF', borderRadius: 4,
              fontSize: 14, fontWeight: 500, textDecoration: 'none',
              fontFamily: 'var(--font-sans)', transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--color-blue)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'var(--color-navy)'; }}
          >
            Start Analysis (~{estimateMinutes} min)
          </a>
        )}
        <button onClick={onReset} className="btn-ghost">Try another handle</button>
      </div>
    </div>
  );
}

// ── Pair Venn (two circles) ──────────────────────────────────────────────────

function PairVennDiagram({
  pair,
  userHandle,
  userAvatar,
}: {
  pair: PairRecommendation;
  userHandle: string;
  userAvatar?: string;
}) {
  const cx = { user: 120, match: 200 };
  const cy = 100;
  const r = 68;

  const avatars = { user: userAvatar, match: pair.match.avatar };
  const initials = {
    user: userHandle.charAt(0).toUpperCase(),
    match: (pair.match.displayName || pair.match.handle).charAt(0).toUpperCase(),
  };
  const colors = { user: VENN_COLORS.user, match: VENN_COLORS.a };

  return (
    <svg viewBox="0 0 320 200" style={{ width: '100%', maxWidth: 300, margin: '0 auto', display: 'block' }}>
      {/* Circles */}
      {(['user', 'match'] as const).map(key => (
        <circle key={key} cx={cx[key]} cy={cy} r={r}
          fill={colors[key].fill} fillOpacity={0.12}
          stroke={colors[key].stroke} strokeWidth={2} strokeOpacity={0.6} />
      ))}

      {/* Avatars or initials */}
      {(['user', 'match'] as const).map(key => {
        const avatar = avatars[key];
        const lx = key === 'user' ? cx.user - 28 : cx.match + 28;
        return avatar ? (
          <g key={`avatar-${key}`}>
            <clipPath id={`pair-clip-${key}`}>
              <circle cx={lx} cy={cy} r={16} />
            </clipPath>
            <image href={avatar} x={lx - 16} y={cy - 16} width={32} height={32}
              clipPath={`url(#pair-clip-${key})`} style={{ imageRendering: 'auto' }} />
            <circle cx={lx} cy={cy} r={16} fill="none" stroke={colors[key].stroke} strokeWidth={2} />
          </g>
        ) : (
          <g key={`initial-${key}`}>
            <circle cx={lx} cy={cy} r={16}
              fill={colors[key].fill} fillOpacity={0.15} stroke={colors[key].stroke} strokeWidth={1.5} />
            <text x={lx} y={cy + 1} textAnchor="middle" dominantBaseline="central"
              fontSize={13} fontWeight={600} fill={colors[key].stroke} fontFamily="var(--font-sans)">
              {initials[key]}
            </text>
          </g>
        );
      })}

      {/* Overlap count in center */}
      <g>
        <circle cx={(cx.user + cx.match) / 2} cy={cy} r={20}
          fill="#fff" fillOpacity={0.85} stroke="var(--color-navy)" strokeWidth={1} />
        <text x={(cx.user + cx.match) / 2} y={cy} textAnchor="middle" dominantBaseline="central"
          fontSize={11} fontWeight={700} fill="var(--color-navy)" fontFamily="var(--font-mono)">
          {formatFollowers(pair.overlap)}
        </text>
      </g>

      {/* Size labels */}
      <text x={cx.user} y={cy - r - 10} textAnchor="middle"
        fontSize={10} fill="var(--color-text-faint)" fontFamily="var(--font-mono)">
        {formatFollowers(pair.sizes.user)}
      </text>
      <text x={cx.match} y={cy - r - 10} textAnchor="middle"
        fontSize={10} fill="var(--color-text-faint)" fontFamily="var(--font-mono)">
        {formatFollowers(pair.sizes.match)}
      </text>
    </svg>
  );
}

// ── Pair card ────────────────────────────────────────────────────────────────

function PairCard({
  pair,
  rank,
  userHandle,
  userAvatar,
}: {
  pair: PairRecommendation;
  rank: number;
  userHandle: string;
  userAvatar?: string;
}) {
  const handles = [userHandle, pair.match.handle];
  const analysisUrl = `/?handles=${handles.map(h => encodeURIComponent(h)).join(',')}&autostart=complete`;

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--color-border)',
      borderRadius: 8, padding: '24px', marginBottom: 20,
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-blue)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
            color: '#fff', background: 'var(--color-navy)',
            width: 26, height: 26, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {rank}
          </span>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            You + {pair.match.displayName || pair.match.handle}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {pair.signals.sizeMatch && <SignalBadge label="Similar size" />}
          {pair.signals.topicMatch && <SignalBadge label="Topic match" />}
          {pair.signals.geoMatch && <SignalBadge label="Same region" />}
        </div>
      </div>

      {/* Combined reach — hero */}
      <div style={{
        textAlign: 'center', padding: '20px 16px', marginBottom: 16,
        background: 'linear-gradient(135deg, #EBF2FD 0%, #f0f7ff 100%)',
        borderRadius: 6, border: '1px solid #d6e4f5',
      }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-blue)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Combined audience
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 32, fontWeight: 700, color: 'var(--color-navy)', lineHeight: 1.1 }}>
          {formatFollowers(pair.totalReach)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
          unique followers together
        </div>
      </div>

      {/* Venn diagram */}
      <PairVennDiagram pair={pair} userHandle={userHandle} userAvatar={userAvatar} />

      {/* Members */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '16px 0', textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 8, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: VENN_COLORS.user.stroke, marginBottom: 4 }}>You</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            @{userHandle}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 8, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: VENN_COLORS.a.stroke, marginBottom: 4 }}>Collaborator</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pair.match.displayName || `@${pair.match.handle}`}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-faint)' }}>
            @{pair.match.handle}
          </div>
        </div>
      </div>

      {/* New audience opportunity */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 10, padding: '12px 14px', background: '#f8fafc',
        borderRadius: 4, border: '1px solid #f1f5f9', marginBottom: 12,
      }}>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 3 }}>
            New people for you
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            +{formatFollowers(pair.newAudienceForUser ?? 0)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
            from {(pair.match.displayName || pair.match.handle).split(' ')[0]}
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginBottom: 3 }}>
            New for {(pair.match.displayName || pair.match.handle).split(' ')[0]}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, color: 'var(--color-navy)' }}>
            +{formatFollowers(pair.newAudienceForMatch ?? 0)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
            from you
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 4px' }}>
          Discover engagement overlaps and how many people you could convert together
        </p>
        <a href={analysisUrl} style={{ fontSize: 13, color: 'var(--color-blue)', textDecoration: 'none', fontWeight: 500 }}>
          Run full analysis →
        </a>
      </div>
    </div>
  );
}

// ── Results view ────────────────────────────────────────────────────────────

function ResultsView({ result, onReset }: {
  result: APIResponse;
  onReset: () => void;
}) {
  const { user, comparedCount } = result;
  const hasTrios = result.mode === 'trio' && result.trios && result.trios.length > 0;
  const hasPairs = result.mode === 'pair' && result.pairs && result.pairs.length > 0;
  const hasResults = hasTrios || hasPairs;

  return (
    <div>
      {/* Summary strip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '12px 16px', background: '#fff',
        border: '1px solid var(--color-border)', borderRadius: 6,
        marginBottom: 20, flexWrap: 'wrap',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-navy)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500 }}>@{user.handle}</span>
          <span style={{ padding: '2px 7px', borderRadius: 3, background: '#EBF2FD', color: 'var(--color-blue)', fontSize: 11, fontWeight: 600 }}>
            {formatFollowers(user.followerCount)} followers
          </span>
          <span style={{ color: 'var(--color-text-faint)', fontSize: 11 }}>
            · {comparedCount} journalists compared
          </span>
        </div>
        <button onClick={onReset} className="btn-ghost" style={{ marginTop: 0 }}>New Search</button>
      </div>

      {/* Results */}
      {hasResults ? (
        <>
          {hasTrios && result.trios!.map((trio, i) => (
            <TrioCard
              key={`${trio.matchA.did}-${trio.matchB.did}`}
              trio={trio}
              rank={i + 1}
              userHandle={user.handle}
              userAvatar={user.avatar}
            />
          ))}
          {hasPairs && result.pairs!.map((pair, i) => (
            <PairCard
              key={pair.match.did}
              pair={pair}
              rank={i + 1}
              userHandle={user.handle}
              userAvatar={user.avatar}
            />
          ))}
        </>
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: 6, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-navy)', marginBottom: 8 }}>
            No collaborations found yet
          </div>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            The directory is still growing — check back soon as more journalists are added.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Multi-select topic picker ────────────────────────────────────────────────

function TopicMultiSelect({ options, selected, onChange }: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [customValue, setCustomValue] = useState('');

  const toggleTopic = (topic: string) => {
    onChange(selected.includes(topic) ? selected.filter(t => t !== topic) : [...selected, topic]);
  };

  const addCustom = () => {
    const trimmed = customValue.trim();
    if (trimmed && !selected.includes(trimmed)) onChange([...selected, trimmed]);
    setCustomValue('');
    setIsAdding(false);
  };

  return (
    <div className="input-group" style={{ marginBottom: 0 }}>
      <label>Your topics</label>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6,
        padding: '10px 12px', border: '1px solid var(--color-border)',
        borderRadius: 4, background: '#fff', minHeight: 40,
      }}>
        {options.map((topic) => {
          const active = selected.includes(topic);
          return (
            <button key={topic} type="button" onClick={() => toggleTopic(topic)}
              style={{
                display: 'inline-block', padding: '4px 10px', borderRadius: 3,
                fontSize: 12, fontWeight: 500, border: '1px solid',
                borderColor: active ? 'var(--color-blue)' : 'var(--color-border)',
                background: active ? '#EBF2FD' : '#fff',
                color: active ? 'var(--color-blue)' : 'var(--color-text-muted)',
                cursor: 'pointer', transition: 'all 0.1s', fontFamily: 'var(--font-sans)',
              }}>
              {active && '✓ '}{topic}
            </button>
          );
        })}
        {selected.filter(t => !options.includes(t)).map(topic => (
          <button key={topic} type="button" onClick={() => toggleTopic(topic)}
            style={{
              display: 'inline-block', padding: '4px 10px', borderRadius: 3,
              fontSize: 12, fontWeight: 500, border: '1px solid var(--color-blue)',
              background: '#EBF2FD', color: 'var(--color-blue)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}>
            ✓ {topic}
          </button>
        ))}
        {!isAdding ? (
          <button type="button" onClick={() => setIsAdding(true)}
            style={{
              display: 'inline-block', padding: '4px 10px', borderRadius: 3,
              fontSize: 12, fontWeight: 500, border: '1px dashed var(--color-border)',
              background: 'transparent', color: 'var(--color-text-faint)',
              cursor: 'pointer', fontFamily: 'var(--font-sans)',
            }}>
            + Add new
          </button>
        ) : (
          <input type="text" value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
              if (e.key === 'Escape') { setIsAdding(false); setCustomValue(''); }
            }}
            onBlur={addCustom} autoFocus placeholder="Type topic…"
            style={{
              width: 110, padding: '4px 8px', borderRadius: 3, fontSize: 12,
              border: '1px solid var(--color-blue)', outline: 'none', fontFamily: 'var(--font-sans)',
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Single select with custom option ─────────────────────────────────────────

function ComboSelect({ label, options, value, onChange, placeholder }: {
  label: string; options: string[]; value: string;
  onChange: (v: string) => void; placeholder: string;
}) {
  const [isCustom, setIsCustom] = useState(false);
  return (
    <div className="input-group" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      {!isCustom ? (
        <select className="handle-input" value={value}
          onChange={(e) => {
            if (e.target.value === '__custom__') { setIsCustom(true); onChange(''); }
            else onChange(e.target.value);
          }}
          style={{ cursor: 'pointer' }}>
          <option value="">{placeholder}</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          <option value="__custom__">+ Add new…</option>
        </select>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="handle-input" type="text" placeholder="Type your own…"
            value={value} onChange={(e) => onChange(e.target.value)} autoFocus style={{ flex: 1 }} />
          <button type="button" onClick={() => { setIsCustom(false); onChange(''); }}
            className="btn-ghost" style={{ padding: '6px 10px', fontSize: 12, marginTop: 0 }}>✕</button>
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function PartnersPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [handle, setHandle] = useState('');
  const [matchMode, setMatchMode] = useState<MatchMode>('trio');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedGeo, setSelectedGeo] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [geographies, setGeographies] = useState<string[]>([]);
  const [apiResult, setApiResult] = useState<APIResponse | null>(null);
  const [noCacheUser, setNoCacheUser] = useState<NoCacheResponse['user'] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/directory?stats=true')
      .then(r => r.json())
      .then((data: DirectoryStats) => {
        // Consolidate topics into broad categories
        if (data.topics?.length) {
          const consolidated = consolidateTopics(data.topics);
          setTopics(consolidated);
        }
        // Consolidate geographies into regions
        if (data.geographies?.length) {
          const consolidated = consolidateGeographies(data.geographies);
          setGeographies(consolidated);
        }
      })
      .catch(() => {});
  }, []);

  const cleanHandle = (input: string): string => {
    const trimmed = input.trim().replace(/^@/, '');
    const m = trimmed.match(/bsky\.app\/profile\/([^/?#]+)/);
    return m ? m[1] : trimmed;
  };

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = cleanHandle(handle);
    if (!clean) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPhase('loading');
    setApiResult(null);
    setNoCacheUser(null);
    setErrorMsg(null);

    try {
      const params = new URLSearchParams({ handle: clean, limit: '3', mode: matchMode });
      if (selectedTopics.length > 0) params.set('topics', selectedTopics.join(','));
      if (selectedGeo) params.set('geography', selectedGeo);

      const res = await fetch(`/api/partners?${params}`, { signal: ctrl.signal });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if ((body as NoCacheResponse).error === 'no_cache') {
          setNoCacheUser((body as NoCacheResponse).user || null);
          setPhase('no-cache');
          return;
        }
        const msg = (body as { error?: string }).error || '';
        if (res.status === 504 || res.status === 502 || !msg) {
          throw new Error('The request timed out — try again or switch to Pair mode (faster).');
        }
        throw new Error(msg.toLowerCase().includes('not found') ? `Could not find Bluesky account: ${clean}` : msg);
      }

      setApiResult(await res.json() as APIResponse);
      setPhase('results');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setErrorMsg((err as Error).message || 'Something went wrong — please try again.');
      setPhase('error');
    }
  }, [handle, matchMode, selectedTopics, selectedGeo]);

  const handleReset = () => {
    abortRef.current?.abort();
    setPhase('idle');
    setApiResult(null);
    setNoCacheUser(null);
    setErrorMsg(null);
  };

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 64px' }}>
      <Header />

      {phase === 'idle' && (
        <form onSubmit={handleSubmit} className="card">
          {/* Match type toggle — prominent at top */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ display: 'flex', borderRadius: 6, border: '1px solid var(--color-border)', overflow: 'hidden', flex: 1 }}>
              {(['pair', 'trio'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMatchMode(m)}
                  style={{
                    flex: 1, padding: '10px 14px', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: matchMode === m ? 'var(--color-navy)' : '#fff',
                    color: matchMode === m ? '#fff' : 'var(--color-text-muted)',
                    transition: 'all 0.15s ease',
                  }}>
                  {m === 'trio' ? 'Trio' : 'Pair'}
                </button>
              ))}
            </div>
          </div>

          <div className="input-group">
            <label>Your Bluesky handle</label>
            <input className="handle-input" type="text" placeholder="e.g. yourname.bsky.social"
              value={handle} onChange={e => setHandle(e.target.value)}
              autoComplete="off" spellCheck={false} />
          </div>
          <p className="tip">Paste your handle or a full Bluesky profile URL.</p>

          {(topics.length > 0 || geographies.length > 0) && (
            <>
              <hr className="divider" />
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
                Add your topic and location to improve your matches.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {topics.length > 0 && (
                  <TopicMultiSelect options={topics} selected={selectedTopics} onChange={setSelectedTopics} />
                )}
                {geographies.length > 0 && (
                  <ComboSelect label="Your location" options={geographies}
                    value={selectedGeo}
                    onChange={(v) => setSelectedGeo(normalizeUserGeo(v))}
                    placeholder="Select location…" />
                )}
              </div>
            </>
          )}

          <button type="submit" className="btn" disabled={!handle.trim()} style={{ marginTop: 20 }}>
            Find Collaborations
          </button>
        </form>
      )}

      {phase === 'loading' && <VerbWheel active />}

      {phase === 'no-cache' && <NoCacheView user={noCacheUser} onReset={handleReset} />}

      {phase === 'error' && (
        <div className="alert alert-error">
          <strong>Error:</strong> {errorMsg}
          <div style={{ marginTop: 12 }}><button onClick={handleReset} className="btn-ghost">Try again</button></div>
        </div>
      )}

      {phase === 'results' && apiResult && (
        <ResultsView
          result={apiResult}
          onReset={handleReset}
        />
      )}

      <Footer />
    </main>
  );
}
